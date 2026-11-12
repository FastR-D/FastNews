package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/identity"
	"github.com/FastR-D/FastNews/internal/store"
)

func (s *Server) auth(w http.ResponseWriter, r *http.Request, p string) error {
	if r.Method == "GET" {
		switch p {
		case "/api/auth/info":
			reply(w, r, 200, map[string]any{"local": true, "registration": "invite", "fastcas": s.Config.CASEnabled})
			return nil
		case "/api/auth/session-init":
			csrf := store.Random()
			s.setCookie(w, "fastnews_preauth", csrf, 1800)
			reply(w, r, 200, map[string]string{"csrf": csrf})
			return nil
		case "/api/auth/me":
			v, e := s.require(r)
			if e != nil {
				return e
			}
			reply(w, r, 200, v)
			return nil
		case "/api/auth/research/status":
			v, e := s.require(r)
			if e != nil {
				return e
			}
			c, e := s.Store.Connection(v.UserID)
			if e != nil {
				return e
			}
			reply(w, r, 200, map[string]any{"connection": c, "casLive": v.Source == "fastcas" && s.Config.ResearchConnect})
			return nil
		case "/api/auth/research/live":
			v, e := s.require(r)
			if e != nil {
				return e
			}
			profile, e := s.researchProfile(r, v)
			if e != nil {
				return e
			}
			reply(w, r, 200, profile)
			return nil
		}
		return store.Fail(404, "接口不存在")
	}
	if r.Method != "POST" {
		return store.Fail(405, "Method not allowed")
	}
	if strings.HasPrefix(p, "/api/auth/research/") {
		v, e := s.require(r)
		if e != nil {
			return e
		}
		if e = s.csrf(r, v.CSRF); e != nil {
			return e
		}
		var body struct {
			Key     string `json:"key"`
			Replace bool   `json:"replace"`
		}
		if e = decode(w, r, &body, 8192); e != nil {
			return e
		}
		var id, key string
		var sections map[string]any
		switch p {
		case "/api/auth/research/import":
			id, key, sections, e = identity.Snapshot(r.Context(), s.Config.ResearchURL, body.Key)
		case "/api/auth/research/sync":
			var profile map[string]any
			profile, e = s.researchProfile(r, v)
			if e == nil {
				id, _ = profile["researchAccountId"].(string)
				sections = map[string]any{"authors": map[string]any{"authors": profile["authors"], "customTags": profile["customTags"]}, "impression": profile["impression"], "inbox": profile["inbox"]}
			}
		default:
			return store.Fail(404, "接口不存在")
		}
		if e != nil {
			return e
		}
		connection, e := s.Store.Import(v.UserID, id, key, sections, body.Replace)
		if e != nil {
			return e
		}
		reply(w, r, 200, map[string]any{"connection": connection})
		return nil
	}
	token := cookie(r, "fastnews_preauth")
	if p == "/api/auth/logout" {
		v, e := s.require(r)
		if e != nil {
			return e
		}
		token = v.CSRF
	}
	if e := s.csrf(r, token); e != nil {
		return e
	}
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Token    string `json:"token"`
	}
	if e := decode(w, r, &body, 8192); e != nil {
		return e
	}
	switch p {
	case "/api/auth/login":
		raw, csrf, e := s.Store.Login(body.Email, body.Password, peer(r))
		if e != nil {
			return e
		}
		s.setCookie(w, "fastnews_session", raw, 7*86400)
		s.setCookie(w, "fastnews_preauth", "", -1)
		reply(w, r, 200, map[string]string{"csrf": csrf})
	case "/api/auth/register", "/api/auth/recover":
		kind := "invite"
		if strings.HasSuffix(p, "recover") {
			kind = "recovery"
		}
		if e := s.Store.Redeem(kind, body.Token, body.Password, peer(r)); e != nil {
			return e
		}
		reply(w, r, 200, map[string]bool{"ok": true})
	case "/api/auth/logout":
		if e := s.Store.Logout(cookie(r, "fastnews_session")); e != nil {
			return e
		}
		s.setCookie(w, "fastnews_session", "", -1)
		reply(w, r, 200, map[string]bool{"ok": true})
	default:
		return store.Fail(404, "接口不存在")
	}
	return nil
}
func (s *Server) researchProfile(r *http.Request, v *store.Session) (map[string]any, error) {
	token, _, e := s.CAS.Access(r.Context(), v)
	if e != nil {
		return nil, e
	}
	profile, _, e := identity.Research(r.Context(), s.Config.ResearchURL, "GET", "/api/connectors/news/profile", token, nil)
	if e != nil {
		return nil, e
	}
	if id, _ := profile["researchAccountId"].(string); id == "" {
		return nil, store.Fail(502, "Research 身份无效")
	}
	return profile, nil
}
func (s *Server) content(w http.ResponseWriter, r *http.Request, p string) error {
	local := cookie(r, "fastnews_session") != ""
	v, e := s.require(r)
	if e != nil {
		if local {
			return e
		}
		token := cookie(r, s.researchCookie())
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			token = strings.TrimPrefix(auth, "Bearer ")
		}
		if token == "" {
			return e
		}
		return s.legacyContent(w, r, p, token)
	}
	name := strings.TrimPrefix(p, "/api/content/")
	if name == "me" && r.Method == "GET" {
		var authors map[string]any
		var impression map[string]any
		var items []map[string]any
		if e = s.Store.Personal(v.UserID, "authors", &authors); e != nil {
			return e
		}
		if e = s.Store.Personal(v.UserID, "impression", &impression); e != nil {
			return e
		}
		if e = s.Store.Personal(v.UserID, "inbox", &items); e != nil {
			return e
		}
		if authors == nil {
			authors = map[string]any{"authors": []any{}, "customTags": []any{}}
		}
		if impression == nil {
			impression = map[string]any{"text": "", "updatedAt": ""}
		}
		reply(w, r, 200, map[string]any{"userId": v.UserID, "person": v.Name, "email": v.Email, "source": v.Source, "csrf": v.CSRF, "authors": authors["authors"], "customTags": authors["customTags"], "impression": impression, "inboxUnread": unread(items)})
		return nil
	}
	if name != "authors" && name != "impression" && name != "inbox" && name != "settings" {
		return store.Fail(404, "本地账号不支持此接口")
	}
	if r.Method != "GET" && r.Method != "HEAD" && r.Method != "PUT" {
		return store.Fail(405, "Method not allowed")
	}
	generated := false
	if r.Method == "PUT" {
		if e = s.csrf(r, v.CSRF); e != nil {
			return e
		}
		var body map[string]json.RawMessage
		if e = decode(w, r, &body, 256<<10); e != nil {
			return e
		}
		switch name {
		case "authors":
			var authors []map[string]any
			var tags []string
			if json.Unmarshal(body["authors"], &authors) != nil || json.Unmarshal(body["customTags"], &tags) != nil || len(authors) > 500 || len(tags) > 200 {
				return store.Fail(400, "作者列表格式无效")
			}
			for _, a := range authors {
				if utf8.RuneCountInString(catalog.Str(a, "name")) > 200 || strings.TrimSpace(catalog.Str(a, "name")) == "" {
					return store.Fail(400, "作者姓名无效")
				}
				if raw := catalog.First(catalog.Str(a, "homepage"), catalog.Str(a, "url")); raw != "" {
					u, e := url.Parse(raw)
					if e != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil {
						return store.Fail(400, "作者主页地址无效")
					}
				}
			}
			e = s.Store.Set(v.UserID, name, map[string]any{"authors": authors, "customTags": tags})
		case "impression":
			var text string
			if json.Unmarshal(body["text"], &text) != nil || utf8.RuneCountInString(text) > 4000 {
				return store.Fail(400, "研究印象最长 4000 字")
			}
			e = s.Store.Set(v.UserID, name, map[string]string{"text": strings.TrimSpace(text), "updatedAt": time.Now().UTC().Format(time.RFC3339)})
		case "settings":
			var settings map[string]any
			if json.Unmarshal(body["settings"], &settings) != nil || settings == nil {
				return store.Fail(400, "设置格式无效")
			}
			e = s.Store.Set(v.UserID, name, settings)
		case "inbox":
			var ids []string
			if len(body) != 1 || json.Unmarshal(body["readIds"], &ids) != nil || len(ids) > 1000 {
				return store.Fail(400, "只允许标记已读")
			}
			set := map[string]bool{}
			for _, id := range ids {
				set[id] = true
			}
			e = s.Store.Update(v.UserID, name, func(raw json.RawMessage) (any, error) {
				items := []map[string]any{}
				if len(raw) > 0 {
					if e := json.Unmarshal(raw, &items); e != nil {
						return nil, e
					}
				}
				for _, item := range items {
					if set[catalog.Str(item, "id")] {
						item["read"] = true
					}
				}
				return items, nil
			})
		}
		if e != nil {
			return e
		}
	}
	if name == "inbox" && r.Method == "GET" {
		generated, e = s.daily(r, v.UserID)
		if e != nil {
			return e
		}
	}
	var value any
	if e = s.Store.Personal(v.UserID, name, &value); e != nil {
		return e
	}
	switch name {
	case "authors":
		if value == nil {
			value = map[string]any{"authors": []any{}, "customTags": []any{}}
		}
		reply(w, r, 200, value)
	case "impression":
		if value == nil {
			value = map[string]string{"text": "", "updatedAt": ""}
		}
		reply(w, r, 200, map[string]any{"impression": value})
	case "inbox":
		var items []map[string]any
		if e = s.Store.Personal(v.UserID, name, &items); e != nil {
			return e
		}
		if items == nil {
			items = []map[string]any{}
		}
		reply(w, r, 200, map[string]any{"items": items, "unread": unread(items), "generatedToday": generated})
	case "settings":
		if value == nil {
			value = map[string]any{}
		}
		reply(w, r, 200, map[string]any{"settings": value})
	}
	return nil
}
func unread(items []map[string]any) int {
	n := 0
	for _, item := range items {
		if item["read"] != true {
			n++
		}
	}
	return n
}
func (s *Server) legacyContent(w http.ResponseWriter, r *http.Request, p, token string) error {
	if p == "/api/content/inbox" && r.Method == "GET" {
		lock := &s.locks[int(store.Digest(token)[0])%len(s.locks)]
		lock.Lock()
		defer lock.Unlock()
	}

	if r.Method != "GET" && r.Method != "PUT" && r.Method != "POST" {
		return store.Fail(405, "Method not allowed")
	}
	allowed := map[string]bool{"/api/content/me": true, "/api/content/authors": true, "/api/content/impression": true, "/api/content/inbox": true, "/api/content/settings": true, "/api/content/logout": true}
	if !allowed[p] {
		return store.Fail(404, "接口不存在")
	}
	if r.Method != "GET" && !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		if e := s.csrf(r, store.Digest("research-csrf:"+token)); e != nil {
			return e
		}
	}
	var body any
	if r.Method != "GET" {
		if e := decode(w, r, &body, 256<<10); e != nil {
			return e
		}
	}
	result, _, e := identity.Research(r.Context(), s.Config.ResearchURL, r.Method, p, token, body)
	if e != nil {
		return e
	}
	if p == "/api/content/me" {
		result["userId"] = catalog.First(catalog.Str(result, "userId"), catalog.Str(result, "accountId"), catalog.Str(result, "keyId"))
		result["source"] = "research"
		result["csrf"] = store.Digest("research-csrf:" + token)
		delete(result, "session")
	}
	if p == "/api/content/logout" {
		s.setCookie(w, s.researchCookie(), "", -1)
	}
	if p == "/api/content/inbox" && r.Method == "GET" {
		var items []map[string]any
		b, _ := json.Marshal(result["items"])
		_ = json.Unmarshal(b, &items)
		if !todayPresent(items) {
			im, _, e := identity.Research(r.Context(), s.Config.ResearchURL, "GET", "/api/content/impression", token, nil)
			if e != nil {
				return e
			}
			a, _, e := identity.Research(r.Context(), s.Config.ResearchURL, "GET", "/api/content/authors", token, nil)
			if e != nil {
				return e
			}
			var impression map[string]any
			if v, ok := im["impression"].(map[string]any); ok {
				impression = v
			}
			item, e := s.pick(r, catalog.Str(impression, "text"), a, items)
			if e != nil {
				return e
			}
			if item != nil {
				items = append([]map[string]any{item}, items...)
				if len(items) > 180 {
					items = items[:180]
				}
				result, _, e = identity.Research(r.Context(), s.Config.ResearchURL, "PUT", p, token, map[string]any{"items": items})
				if e != nil {
					return e
				}
				result["generatedToday"] = true
			}
		}
	}
	reply(w, r, 200, result)
	return nil
}

var shanghai = time.FixedZone("Asia/Shanghai", 8*3600)

func today() string { return time.Now().In(shanghai).Format("2006-01-02") }
func todayPresent(items []map[string]any) bool {
	for _, v := range items {
		if v["date"] == today() {
			return true
		}
	}
	return false
}
func (s *Server) daily(r *http.Request, user string) (bool, error) {
	lock := &s.locks[int(user[0])%len(s.locks)]
	lock.Lock()
	defer lock.Unlock()
	var items []map[string]any
	if e := s.Store.Personal(user, "inbox", &items); e != nil {
		return false, e
	}
	if todayPresent(items) {
		return false, nil
	}
	var im map[string]any
	var a map[string]any
	if e := s.Store.Personal(user, "impression", &im); e != nil {
		return false, e
	}
	if e := s.Store.Personal(user, "authors", &a); e != nil {
		return false, e
	}
	item, e := s.pick(r, catalog.Str(im, "text"), a, items)
	if e != nil {
		return false, e
	}
	if item == nil {
		return false, nil
	}
	inserted := false
	e = s.Store.Update(user, "inbox", func(raw json.RawMessage) (any, error) {
		current := []map[string]any{}
		if len(raw) > 0 {
			if e := json.Unmarshal(raw, &current); e != nil {
				return nil, e
			}
		}
		if todayPresent(current) {
			return current, nil
		}
		inserted = true
		current = append([]map[string]any{item}, current...)
		return current[:min(180, len(current))], nil
	})
	return inserted, e
}
func (s *Server) pick(r *http.Request, im string, a map[string]any, items []map[string]any) (map[string]any, error) {
	pool, e := s.Catalog.Papers()
	if e != nil {
		return nil, e
	}
	seen := map[string]bool{}
	for _, item := range items {
		seen[catalog.First(catalog.Str(item, "paperId"), catalog.Str(item, "url"))] = true
	}
	eligible := []catalog.Paper{}
	followed := []catalog.Paper{}
	var authors []map[string]any
	b, _ := json.Marshal(a["authors"])
	_ = json.Unmarshal(b, &authors)
	tags := []string{}
	if rawTags, ok := a["customTags"].([]any); ok {
		for _, t := range rawTags {
			if v, ok := t.(string); ok {
				tags = append(tags, v)
			}
		}
	}
	for _, author := range authors {
		if list, ok := author["tags"].([]any); ok {
			for _, tag := range list {
				if v, ok := tag.(string); ok {
					tags = append(tags, v)
				}
			}
		}
		if v := catalog.First(catalog.Str(author, "research"), catalog.Str(author, "bio")); v != "" {
			tags = append(tags, v)
		}
	}
	for _, p := range pool {
		if seen[p.ID] || seen[p.Link] {
			continue
		}
		eligible = append(eligible, p)
		for _, author := range authors {
			name := strings.ToLower(catalog.Str(author, "name"))
			if name != "" && strings.Contains(strings.ToLower(p.Author), name) {
				p.Reason = "关注作者 " + catalog.Str(author, "name") + " 的论文"
				followed = append(followed, p)
				break
			}
		}
	}
	if len(followed) > 0 {
		eligible = followed
	}
	query := catalog.First(im, strings.Join(tags, " "), "computer security 系统安全 网络安全")
	hits, _, e := s.AI.RAG.Search(r.Context(), eligible, query, 8)
	if e != nil {
		return nil, e
	}
	if len(hits) == 0 {
		return nil, nil
	}
	p := hits[0]
	reason := catalog.First(p.Reason, "根据研究印象与关注方向，从本地语料向量召回。")
	if s.Config.LLMKey != "" {
		var pick struct {
			ID      string `json:"id"`
			TitleZH string `json:"title_zh"`
			Summary string `json:"summary"`
			Reason  string `json:"reason"`
		}
		evidence, _ := json.Marshal(hits)
		if e = s.AI.Complete(r.Context(), `根据研究方向选择一篇论文，只能使用候选 id。返回 JSON {"id":"候选id","title_zh":"中文标题","summary":"中文摘要","reason":"具体推荐理由"}。`, query+"\n"+string(evidence), &pick); e == nil {
			for _, candidate := range hits {
				if candidate.ID == pick.ID {
					p = candidate
					p.TitleZH = catalog.First(pick.TitleZH, p.TitleZH)
					p.Summary = catalog.First(pick.Summary, p.Summary)
					reason = catalog.First(pick.Reason, reason)
					break
				}
			}
		}
	}
	v := map[string]any{"id": catalog.Clip("daily-"+today()+"-"+store.Digest(p.ID), 120), "date": today(), "kind": "daily-paper", "paperId": p.ID, "title": p.Title, "title_zh": p.TitleZH, "summary": p.Summary, "reason": reason, "url": p.Link, "venue": p.Venue, "year": fmt.Sprint(p.Year), "authors": p.Author, "category": p.Category, "source": p.Source, "read": false, "receivedAt": time.Now().In(shanghai).Format(time.RFC3339)}
	if p.Award != "" {
		v["award"] = p.Award
	}
	if p.CitedBy != nil {
		v["cited_by"] = *p.CitedBy
	}
	return v, nil
}
