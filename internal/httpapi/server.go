// Package httpapi exposes the independent JSON API and optional built SPA.
package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/FastR-D/FastNews/internal/ai"
	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/config"
	"github.com/FastR-D/FastNews/internal/identity"
	"github.com/FastR-D/FastNews/internal/rag"
	"github.com/FastR-D/FastNews/internal/store"
	"github.com/FastR-D/FastNews/internal/trend"
)

type Server struct {
	Config       config.Config
	Store        *store.Store
	Catalog      *catalog.Catalog
	AI           *ai.Service
	CAS          *identity.CAS
	trends       trend.Service
	locks        [64]sync.Mutex
	workspaceCAS workspaceProvider
	collection   *collectionManager
}

func New(c config.Config, s *store.Store) (*Server, error) {
	cat := &catalog.Catalog{Root: c.Root}
	cas, e := identity.New(c, s)
	if e != nil {
		return nil, e
	}
	dir := c.DataDir
	if dir == "" {
		dir = filepath.Join(c.Root, ".fastnews-data")
	}
	collection, e := newCollectionManager(dir)
	if e != nil {
		return nil, e
	}
	return &Server{collection: collection, Config: c, Store: s, Catalog: cat, AI: &ai.Service{Config: c, Catalog: cat, RAG: &rag.Retriever{Config: c}}, CAS: cas, trends: trend.Service{Catalog: cat}}, nil
}
func (w *Server) Handler() http.Handler { return http.HandlerFunc(w.serve) }
func reply(w http.ResponseWriter, r *http.Request, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if r.Method != "HEAD" {
		_ = json.NewEncoder(w).Encode(v)
	}
}
func problem(w http.ResponseWriter, r *http.Request, e error) {
	status := 500
	message := "服务暂时不可用"
	var app *store.Error
	if errors.As(e, &app) {
		status = app.Status
		message = app.Message
	} else {
		slog.Error("request failed", "path", r.URL.Path, "error", e)
	}
	reply(w, r, status, map[string]string{"error": message})
}
func decode(w http.ResponseWriter, r *http.Request, out any, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	d := json.NewDecoder(r.Body)
	if e := d.Decode(out); e != nil {
		var size *http.MaxBytesError
		if errors.As(e, &size) {
			return store.Fail(413, "请求过大")
		}
		return store.Fail(400, "请求格式无效")
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return store.Fail(400, "请求格式无效")
	}
	return nil
}
func cookie(r *http.Request, name string) string {
	v, e := r.Cookie(name)
	if e != nil {
		return ""
	}
	return v.Value
}
func (s *Server) setCookie(w http.ResponseWriter, name, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", MaxAge: age, HttpOnly: true, Secure: s.Config.CookieSecure, SameSite: http.SameSiteLaxMode})
}
func (s *Server) session(r *http.Request) (*store.Session, error) {
	v, e := s.Store.Session(cookie(r, "fastnews_session"))
	if e != nil {
		return nil, e
	}
	if e = s.CAS.Validate(r.Context(), v); e != nil {
		return nil, e
	}
	return v, nil
}
func (s *Server) require(r *http.Request) (*store.Session, error) {
	v, e := s.session(r)
	if e != nil {
		return nil, e
	}
	if v == nil {
		return nil, store.Fail(401, "请先登录")
	}
	return v, nil
}
func (s *Server) csrf(r *http.Request, token string) error {
	origin := s.Config.PublicOrigin
	if origin == "" {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		origin = scheme + "://" + r.Host
	}
	if actual := r.Header.Get("Origin"); actual != "" && actual != origin {
		return store.Fail(403, "不允许跨站请求")
	}
	if len(token) < 32 || subtle.ConstantTimeCompare([]byte(token), []byte(r.Header.Get("X-CSRF-Token"))) != 1 {
		return store.Fail(403, "请求校验失败，请刷新页面")
	}
	return nil
}
func peer(r *http.Request) string {
	p, _, e := net.SplitHostPort(r.RemoteAddr)
	if e != nil {
		return r.RemoteAddr
	}
	return p
}
func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	w.Header().Set("Referrer-Policy", "same-origin")
	defer func() {
		if e := recover(); e != nil {
			slog.Error("handler panic", "path", r.URL.Path)
			problem(w, r, fmt.Errorf("handler panic"))
		}
	}()
	// Accept both nginx strip-prefix and direct prefixed requests.
	p := r.URL.Path
	if s.Config.PublicPath != "" && (p == s.Config.PublicPath || strings.HasPrefix(p, s.Config.PublicPath+"/")) {
		p = strings.TrimPrefix(p, s.Config.PublicPath)
		if p == "" {
			p = "/"
		}
	}
	if p == "/api/health" && (r.Method == "GET" || r.Method == "HEAD") {
		var n int
		e := s.Store.DB.QueryRowContext(r.Context(), `SELECT count(*) FROM users`).Scan(&n)
		if e != nil {
			problem(w, r, e)
			return
		}
		reply(w, r, 200, map[string]any{"ok": true, "service": "fastnews", "runtime": "go"})
		return
	}
	var e error
	switch {
	case strings.HasPrefix(p, "/api/integrations/fastread/"):
		e = s.fastreadIntegration(w, r, p)
	case p == "/api/integrations/fastresearch/workspace":
		e = s.workspaceHTTP(w, r)
	case p == "/api/admin/collection" || strings.HasPrefix(p, "/api/admin/collection/"):
		e = s.adminCollection(w, r, p)
	case p == "/api/admin/users" || strings.HasPrefix(p, "/api/admin/users/"):
		e = s.adminUsers(w, r, p)
	case strings.HasPrefix(p, "/api/auth/fastcas/"):
		e = s.casHTTP(w, r, p)
	case strings.HasPrefix(p, "/api/auth/"):
		e = s.auth(w, r, p)
	case strings.HasPrefix(p, "/api/content/"):
		e = s.content(w, r, p)
	case p == "/api/entities" || p == "/api/catalog" || p == "/api/papers" || p == "/api/news" || p == "/api/report" || p == "/api/reports" || p == "/api/trend" || p == "/api/coverage" || p == "/api/sources":
		if e = s.viewer(r); e == nil {
			e = s.catalogHTTP(w, r, p)
		}
	case p == "/api/field-briefing" || p == "/api/summary-brief" || p == "/api/related-work":
		if e = s.viewer(r); e != nil {
			break
		}
		if r.Method != "POST" {
			e = store.Fail(405, "Method not allowed")
			break
		}
		var input struct {
			ai.Request
			Impression *string `json:"impression"`
		}
		if e = decode(w, r, &input, 1<<20); e != nil {
			break
		}
		req := input.Request
		if input.Impression != nil {
			req.Impression = *input.Impression
		}
		if v, _ := s.session(r); v != nil {
			if e = s.csrf(r, v.CSRF); e != nil {
				break
			}
			if input.Impression == nil {
				var im struct {
					Text string `json:"text"`
				}
				if e = s.Store.Personal(v.UserID, "impression", &im); e != nil {
					break
				}
				req.Impression = im.Text
			}
		}
		var result map[string]any
		result, e = s.AI.Run(r.Context(), strings.TrimPrefix(p, "/api/"), req)
		if e == nil {
			reply(w, r, 200, result)
		}
	case p == "/api/fastread":
		e = s.fastread(w, r)
	case p == "/api/authors/preview":
		e = s.authorPreview(w, r)
	case strings.HasPrefix(p, "/api/"):
		e = store.Fail(404, "接口不存在")
	default:
		e = s.static(w, r, p)
	}
	if e != nil {
		problem(w, r, e)
	}
}
func (s *Server) catalogHTTP(w http.ResponseWriter, r *http.Request, p string) error {
	if r.Method != "GET" && r.Method != "HEAD" {
		return store.Fail(405, "Method not allowed")
	}
	switch p {
	case "/api/sources":
		directory, err := s.Catalog.SourceDirectory()
		if err != nil {
			return err
		}
		reply(w, r, 200, directory)
	case "/api/coverage":
		coverage, err := s.Catalog.Coverage()
		if err != nil {
			return err
		}
		reply(w, r, 200, map[string]any{"conferences": coverage})
	case "/api/trend":
		query := r.URL.Query()
		scope := catalog.First(query.Get("scope"), "ai")
		days, err := strconv.Atoi(catalog.First(query.Get("days"), "30"))
		if err != nil || !trend.Supported(scope, days) {
			return store.Fail(400, "研究领域或统计窗口无效")
		}
		report, err := s.trends.Report(scope, days, time.Now())
		if err != nil {
			return err
		}
		reply(w, r, 200, report)
	case "/api/entities":
		return s.entity(w, r)
	case "/api/report":
		path := r.URL.Query().Get("path")
		if route := r.URL.Query().Get("route"); route != "" {
			var err error
			path, err = s.Catalog.ReportPath(route)
			if err != nil {
				return store.Fail(404, "报告不存在")
			}
		}
		v, err := s.Catalog.ReadReport(path)
		if err != nil {
			return store.Fail(404, "报告不存在")
		}
		reply(w, r, 200, v)
	case "/api/reports":
		v, e := s.Catalog.Reports()
		if e != nil {
			return e
		}
		reply(w, r, 200, map[string]any{"reports": v})
	case "/api/news":
		source := r.URL.Query().Get("source")
		if source != "" && source != "all" && source != "articles" && !catalog.ValidNewsChannel(source) {
			return store.Fail(400, "资讯来源范围无效")
		}
		selectRows := func(rows []map[string]any) []map[string]any {
			if source == "" || source == "all" {
				return rows
			}
			selected := []map[string]any{}
			for _, row := range rows {
				channel := catalog.NewsChannel(row)
				if channel == source || (source == "articles" && channel != "arxiv") {
					selected = append(selected, row)
				}
			}
			return selected
		}
		day := r.URL.Query().Get("date")
		if day == "" {
			days, e := s.Catalog.Dates()
			if e != nil {
				return e
			}
			for _, candidate := range days {
				rows, err := s.Catalog.News(candidate)
				if err != nil {
					return err
				}
				rows = selectRows(rows)
				if source == "" || source == "all" || len(rows) > 0 {
					return s.replyNews(w, r, candidate, rows)
				}
			}
		}
		if day == "" {
			return s.replyNews(w, r, "", []map[string]any{})
		}
		if _, e := time.Parse("2006-01-02", day); e != nil {
			return store.Fail(400, "日期格式无效")
		}
		v, e := s.Catalog.News(day)
		if e != nil {
			return e
		}
		return s.replyNews(w, r, day, selectRows(v))
	default:
		papers, e := s.Catalog.Papers()
		if e != nil {
			return e
		}
		if p == "/api/catalog" {
			reports, e := s.Catalog.Reports()
			if e != nil {
				return e
			}
			dates, e := s.Catalog.Dates()
			if e != nil {
				return e
			}
			cats := map[string]bool{}
			years := map[int]bool{}
			top := 0
			for _, p := range papers {
				if p.Source == "top-conf" {
					top++
					cats[p.Category] = true
					years[p.Year] = true
				}
			}
			categories := []string{}
			for k := range cats {
				categories = append(categories, k)
			}
			sort.Strings(categories)
			ys := []int{}
			for y := range years {
				ys = append(ys, y)
			}
			sort.Sort(sort.Reverse(sort.IntSlice(ys)))
			reply(w, r, 200, map[string]any{"papers": len(papers), "topPapers": top, "reports": reports, "dates": dates, "categories": categories, "years": ys, "conferences": catalog.Labels, "topics": catalog.TopicLabels(), "publicReports": !s.Config.RequireLogin})
			return nil
		}
		q := r.URL.Query()
		pool := []catalog.Paper{}
		for _, v := range papers {
			if topic := q.Get("topic"); topic != "" && !catalog.HasTopic(v, topic) {
				continue
			}
			if domain := q.Get("domain"); domain != "" && catalog.Conferences[v.Conference].Domain != domain {
				continue
			}
			if track := q.Get("track"); track != "" && v.Track != track {
				continue
			}
			if q.Get("source") != "" && q.Get("source") != "all" && q.Get("source") != v.Source {
				continue
			}
			if q.Get("conference") != "" && q.Get("conference") != v.Conference {
				continue
			}
			if q.Get("category") != "" && q.Get("category") != v.Category {
				continue
			}
			if q.Get("year") != "" && q.Get("year") != strconv.Itoa(v.Year) {
				continue
			}
			pool = append(pool, v)
		}
		provider := ""
		if query := q.Get("q"); query != "" {
			pool, provider, e = s.AI.RAG.Search(r.Context(), pool, query, len(pool))
			if e != nil {
				return e
			}
		}
		page, _ := strconv.Atoi(q.Get("page"))
		page = max(1, page)
		size, _ := strconv.Atoi(q.Get("pageSize"))
		if size <= 0 {
			size = 12
		}
		size = min(size, 100)
		start := min((page-1)*size, len(pool))
		reply(w, r, 200, map[string]any{"papers": pool[start:min(start+size, len(pool))], "total": len(pool), "page": page, "pageSize": size, "embedding_provider": provider})
	}
	return nil
}
func safeFile(root, rel string) (string, error) {
	clean := path.Clean("/" + rel)
	if strings.Contains(rel, "\\") {
		return "", store.Fail(404, "Not found")
	}
	for _, segment := range strings.Split(clean, "/") {
		if strings.HasPrefix(segment, ".") {
			return "", store.Fail(404, "Not found")
		}
	}
	f := filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(clean, "/")))
	resolved, e := filepath.EvalSymlinks(f)
	if e != nil {
		return "", store.Fail(404, "Not found")
	}
	base, e := filepath.EvalSymlinks(root)
	if e != nil {
		return "", e
	}
	if !strings.HasPrefix(resolved, base+string(os.PathSeparator)) {
		return "", store.Fail(404, "Not found")
	}
	return resolved, nil
}
func (s *Server) static(w http.ResponseWriter, r *http.Request, p string) error {
	if r.Method != "GET" && r.Method != "HEAD" {
		return store.Fail(405, "Method not allowed")
	}
	if ticket := r.URL.Query().Get("sso"); ticket != "" {
		if len(ticket) > 256 {
			return store.Fail(400, "票据无效")
		}
		proof, _, e := identity.Research(r.Context(), s.Config.ResearchURL, "POST", "/api/sso/consume", "", map[string]string{"ticket": ticket, "audience": "fast-news"})
		if e != nil {
			http.Redirect(w, r, s.Config.PublicPath+"/login", 302)
			return nil
		}
		token, _ := proof["session"].(string)
		if key, _ := proof["keyId"].(string); token == "" || key == "" {
			return store.Fail(502, "未返回有效会话")
		}
		s.setCookie(w, s.researchCookie(), token, 7*86400)
		http.Redirect(w, r, s.Config.PublicPath+p, 302)
		return nil
	}
	public := p == "/login" || (strings.HasPrefix(p, "/assets/") || p == "/favicon.svg")
	if s.Config.RequireLogin && !public {
		v, _ := s.session(r)
		if v == nil {
			legacy := cookie(r, s.researchCookie())
			var err error
			if legacy != "" {
				_, _, err = identity.Research(r.Context(), s.Config.ResearchURL, "GET", "/api/content/me", legacy, nil)
			}
			if legacy == "" || err != nil {
				http.Redirect(w, r, s.Config.PublicPath+"/login?next="+url.QueryEscape(p+func() string {
					if r.URL.RawQuery != "" {
						return "?" + r.URL.RawQuery
					}
					return ""
				}()), 302)
				return nil
			}
		}
	}
	report := strings.HasPrefix(p, "/top-conf/data/report/") || strings.HasPrefix(p, "/secnews/data/report/")
	// Only data and generated report trees are public, never source or account DBs.
	allowedData := strings.HasPrefix(p, "/top-conf/data/conferences/") || strings.HasPrefix(p, "/top-conf/data/summary/") || strings.HasPrefix(p, "/secnews/data/articles/") || strings.HasPrefix(p, "/secnews/data/daily_summaries/")
	root := s.Config.WebDir
	rel := strings.TrimPrefix(p, "/")
	if report && (strings.HasSuffix(p, ".json") || strings.HasSuffix(p, ".pdf")) || allowedData {
		root = s.Config.Root
	} else if strings.HasPrefix(p, "/assets/") || p == "/favicon.svg" {
		// These files belong to the built frontend; never fall back to source.

	} else {
		switch strings.TrimSuffix(p, "/") {
		case "", "/entity", "/report", "/admin/users", "/admin/processes", "/sources", "/top-conf", "/coverage", "/field-briefing", "/summary-brief", "/inbox", "/impression", "/secnews", "/arxiv", "/trend", "/authors", "/login", "/account":
			rel = "index.html"
		default:
			if _, err := s.Catalog.ReportPath(p); err != nil {
				return store.Fail(404, "Not found")
			}
			rel = "index.html"
		}
	}
	ext := strings.ToLower(filepath.Ext(rel))
	switch ext {
	case ".html", ".htm", ".pdf", ".css", ".js", ".map", ".svg", ".png", ".ico", ".jpg", ".jpeg", ".webp", ".woff", ".woff2", ".json", ".jsonl":
	default:
		return store.Fail(404, "Not found")
	}
	f, e := safeFile(root, rel)
	if e != nil {
		return e
	}
	if r.URL.Query().Get("download") == "1" || r.URL.Query().Get("download") == "true" {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filepath.Base(f)}))
	}
	w.Header().Set("Cache-Control", "no-cache")
	if rel == "index.html" {
		w.Header().Set("Cache-Control", "no-store")
	}

	http.ServeFile(w, r, f)
	return nil
}
func (s *Server) fastread(w http.ResponseWriter, r *http.Request) error {
	if r.Method != "POST" {
		return store.Fail(405, "Method not allowed")
	}
	var body map[string]any
	if e := decode(w, r, &body, 32<<10); e != nil {
		return e
	}
	title := catalog.Clip(catalog.Str(body, "title"), 300)
	if title == "" {
		return store.Fail(400, "title required")
	}
	query := ""
	if cookie(r, "fastnews_session") != "" {
		session, err := s.require(r)
		if err != nil {
			return err
		}
		if err = s.csrf(r, session.CSRF); err != nil {
			return err
		}
		var linked int
		if err = s.Store.DB.QueryRowContext(r.Context(), "SELECT count(*) FROM cas_links WHERE issuer=? AND client_id=? AND user_id=? AND state='active'", s.Config.CASIssuer, s.Config.CASClientID, session.UserID).Scan(&linked); err != nil {
			return err
		}
		if linked > 0 {
			query = "auth=cas"
		}
	} else {
		token := cookie(r, s.researchCookie())
		if token == "" {
			return store.Fail(401, "请先登录 FastNews")
		}
		proof, _, err := identity.Research(r.Context(), s.Config.ResearchURL, "POST", "/api/sso/ticket", token, map[string]string{"audience": "fast-read"})
		if err != nil {
			return err
		}
		ticket, _ := proof["ticket"].(string)
		if ticket == "" || len(ticket) > 256 {
			return store.Fail(502, "FastRead 登录票据申请失败")
		}
		query = "sso=" + url.QueryEscape(ticket)
	}
	paper := map[string]string{"title": title, "source": "fastnews"}
	for key, keys := range map[string][]string{"authors": {"authors", "author"}, "abstract": {"abstract", "summary"}, "venue": {"venue", "conference_label", "conference"}, "year": {"year"}, "id": {"id", "paperId"}, "doi": {"doi", "identifier"}} {
		for _, k := range keys {
			if v := catalog.Str(body, k); v != "" {
				limits := map[string]int{"authors": 400, "abstract": 800, "venue": 80, "year": 8, "id": 180, "doi": 200}
				paper[key] = catalog.Clip(v, limits[key])
				break
			}
		}
	}
	raw := catalog.Clip(catalog.First(catalog.Str(body, "url"), catalog.Str(body, "link")), 2048)
	if u, e := url.Parse(raw); e == nil && u.Host != "" && u.User == nil && (u.Scheme == "http" || u.Scheme == "https") {
		paper["url"] = raw
	}
	redirect := ""
	for _, n := range []int{800, 240, 0} {
		if n == 0 {
			delete(paper, "abstract")
		} else if paper["abstract"] != "" {
			paper["abstract"] = catalog.Clip(paper["abstract"], n)
		}
		b, _ := json.Marshal(paper)
		redirect = s.Config.FastReadURL + "/?" + query + "#fastnews=" + url.PathEscape(string(b))
		if len(redirect) <= 7000 {
			break
		}
	}
	if len(redirect) > 7000 {
		return store.Fail(400, "论文元数据过长，请缩短后重试")
	}
	reply(w, r, 200, map[string]any{"ok": true, "redirect": redirect, "paper": paper})
	return nil
}

func (s *Server) researchCookie() string {
	if s.Config.ResearchCookie != "" {
		return s.Config.ResearchCookie
	}
	return "fr_session"
}

func (s *Server) viewer(r *http.Request) error {
	if !s.Config.RequireLogin {
		return nil
	}
	current, e := s.session(r)
	if current != nil && e == nil {
		return nil
	}
	if cookie(r, "fastnews_session") != "" {
		if e != nil {
			return e
		}
		return store.Fail(401, "请重新登录")
	}
	token := cookie(r, s.researchCookie())
	if token == "" {
		return store.Fail(401, "请先登录")
	}
	_, _, e = identity.Research(r.Context(), s.Config.ResearchURL, "GET", "/api/content/me", token, nil)
	return e
}
