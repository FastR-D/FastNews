package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/FastR-D/FastNews/internal/config"
	"github.com/FastR-D/FastNews/internal/store"
)

type harness struct {
	app    *Server
	http   *httptest.Server
	cookie *http.Cookie
	csrf   string
}

func TestSourceDirectoryHonorsReportAccess(t *testing.T) {
	h := fixture(t)
	h.app.Config.RequireLogin = true
	status, _, _ := h.request(t, "GET", "/api/sources", nil, "", false)
	if status != 401 {
		t.Fatal(status)
	}
	h.login(t, "sources@example.com")
	status, body, _ := h.request(t, "GET", "/api/sources", nil, "", true)
	if status != 200 || len(body["sources"].([]any)) == 0 {
		t.Fatal(status, body)
	}
	status, _, _ = h.request(t, "POST", "/api/sources", nil, h.csrf, true)
	if status != 405 {
		t.Fatal(status)
	}
}

func fixture(t *testing.T) *harness {
	t.Helper()
	root := t.TempDir()
	for _, dir := range []string{"web/dist", "web/dist/reports", "top-conf/data/conferences", "top-conf/data/summary", "top-conf/data/report", "secnews/data/articles"} {
		if e := os.MkdirAll(filepath.Join(root, dir), 0700); e != nil {
			t.Fatal(e)
		}
	}
	os.WriteFile(filepath.Join(root, "web/dist/index.html"), []byte(`<div id="root">React</div>`), 0600)
	os.WriteFile(filepath.Join(root, "top-conf/data/conferences/usenix_2026.jsonl"), []byte(`{"_id":"paper-a","title":"Prompt Injection in LLM Agents","author":"Alice Researcher","link":"https://example.com/a"}`), 0600)
	os.WriteFile(filepath.Join(root, "top-conf/data/summary/usenix_2026_summary.jsonl"), []byte(`{"category":"ML/AI Security","paper":{"_id":"paper-a","title":"Prompt Injection in LLM Agents","author":"Alice Researcher","summary_zh":"研究智能体工具调用中的提示注入风险"}}`), 0600)
	os.WriteFile(filepath.Join(root, "top-conf/data/report/USENIX_2026_Report.json"), []byte(`[{"tag":"h2","children":[{"text":"Report"}]}]`), 0600)
	s, e := store.Open(filepath.Join(root, "private"))
	if e != nil {
		t.Fatal(e)
	}
	app, e := New(config.Config{Root: root, WebDir: filepath.Join(root, "web/dist"), ResearchURL: "http://127.0.0.1:1", FastReadURL: "http://127.0.0.1:3015"}, s)
	if e != nil {
		t.Fatal(e)
	}
	server := httptest.NewServer(app.Handler())
	h := &harness{app: app, http: server}
	t.Cleanup(func() { server.Close(); app.Close(); s.Close() })
	return h
}
func (h *harness) request(t *testing.T, method, path string, body any, csrf string, auth bool) (int, map[string]any, http.Header) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reader = bytes.NewReader(b)
	}
	req, e := http.NewRequest(method, h.http.URL+path, reader)
	if e != nil {
		t.Fatal(e)
	}
	if auth {
		req.AddCookie(h.cookie)
	}
	if csrf != "" {
		req.Header.Set("X-CSRF-Token", csrf)
	}
	req.Header.Set("Origin", h.http.URL)
	resp, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer resp.Body.Close()
	var v map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&v)
	return resp.StatusCode, v, resp.Header
}
func (h *harness) login(t *testing.T, email string) {
	t.Helper()
	if _, e := h.app.Store.Create(email, "test-password-12345", email); e != nil {
		t.Fatal(e)
	}
	resp, e := http.Get(h.http.URL + "/api/auth/session-init")
	if e != nil {
		t.Fatal(e)
	}
	var init map[string]string
	json.NewDecoder(resp.Body).Decode(&init)
	resp.Body.Close()
	b, _ := json.Marshal(map[string]string{"email": email, "password": "test-password-12345"})
	req, _ := http.NewRequest("POST", h.http.URL+"/api/auth/login", bytes.NewReader(b))
	for _, c := range resp.Cookies() {
		req.AddCookie(c)
	}
	req.Header.Set("Origin", h.http.URL)
	req.Header.Set("X-CSRF-Token", init["csrf"])
	res, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	var v map[string]string
	json.NewDecoder(res.Body).Decode(&v)
	if res.StatusCode != 200 {
		t.Fatal(v)
	}
	h.csrf = v["csrf"]
	for _, c := range res.Cookies() {
		if c.Name == "fastnews_session" {
			h.cookie = c
		}
	}
	if h.cookie == nil {
		t.Fatal("missing session cookie")
	}
}
func TestLocalContentIsolationCSRFAndInbox(t *testing.T) {
	h := fixture(t)
	h.login(t, "alice@example.com")
	status, _, _ := h.request(t, "PUT", "/api/content/impression", map[string]string{"text": "LLM agents"}, "", true)
	if status != 403 {
		t.Fatal("CSRF missing", status)
	}
	status, _, _ = h.request(t, "PUT", "/api/content/impression", map[string]string{"text": "LLM agents"}, h.csrf, true)
	if status != 200 {
		t.Fatal(status)
	}
	aliceCookie, aliceCSRF := h.cookie, h.csrf
	h.login(t, "bob@example.com")
	status, v, _ := h.request(t, "GET", "/api/content/impression", nil, "", true)
	if status != 200 || v["impression"].(map[string]any)["text"] != "" {
		t.Fatal("content leaked", v)
	}
	h.cookie, h.csrf = aliceCookie, aliceCSRF
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			status, v, _ := h.request(t, "GET", "/api/content/inbox", nil, "", true)
			if status != 200 || len(v["items"].([]any)) != 1 {
				t.Error(status, v)
			}
		}()
	}
	wg.Wait()
	status, v, _ = h.request(t, "GET", "/api/content/inbox", nil, "", true)
	item := v["items"].([]any)[0].(map[string]any)
	if item["date"] != today() {
		t.Fatal("wrong timezone", item)
	}
	status, _, _ = h.request(t, "PUT", "/api/content/inbox", map[string]any{"items": []any{}}, h.csrf, true)
	if status != 400 {
		t.Fatal("browser could forge inbox", status)
	}
	status, v, _ = h.request(t, "PUT", "/api/content/inbox", map[string]any{"readIds": []string{item["id"].(string)}}, h.csrf, true)
	if status != 200 || v["unread"] != float64(0) {
		t.Fatal("mark read failed", status, v)
	}
	status, _, _ = h.request(t, "POST", "/api/fastread", map[string]string{"title": "Paper"}, h.csrf, true)
	if status != 200 {
		t.Fatal("local account metadata handoff failed", status)
	}
}
func TestCatalogOldRoutesAndPrivateFiles(t *testing.T) {
	h := fixture(t)
	for _, p := range []string{"/", "/sources/", "/top-conf/", "/coverage/", "/field-briefing/", "/summary-brief/", "/inbox/", "/impression/", "/secnews/", "/arxiv/", "/trend/", "/login", "/report/", "/top-conf/data/report/USENIX_2026_Report.json?download=1"} {
		resp, e := http.Get(h.http.URL + p)
		if e != nil {
			t.Fatal(e)
		}
		resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatal(p, resp.StatusCode)
		}
	}
	for _, p := range []string{"/index.html", "/top-conf/index.html", "/reports/handoff.js", "/reports/report.css", "/auth/login", "/.env", "/private/accounts.sqlite", "/serve.py", "/top-conf/data/report/../../../private/accounts.sqlite", "/missing.html"} {
		resp, e := http.Get(h.http.URL + p)
		if e != nil {
			t.Fatal(e)
		}
		resp.Body.Close()
		if resp.StatusCode != 404 {
			t.Fatal("private file accessible", p, resp.StatusCode)
		}
	}
	status, v, _ := h.request(t, "GET", "/api/papers?source=top-conf&conference=usenix&year=2026&category=ML%2FAI%20Security", nil, "", false)
	if status != 200 || v["total"] != float64(1) {
		t.Fatal(v)
	}
	status, _, _ = h.request(t, "GET", "/api/news?date=../../.env", nil, "", false)
	if status != 400 {
		t.Fatal(status)
	}
	h.app.Config.PublicPath = "/news"
	status, _, _ = h.request(t, "GET", "/news/api/catalog", nil, "", false)
	if status != 200 {
		t.Fatal("base path failed", status)
	}
}

func TestTrendAPI(t *testing.T) {
	h := fixture(t)
	day := time.Now().UTC().Format(time.DateOnly)
	var corpus bytes.Buffer
	for index := range 3 {
		err := json.NewEncoder(&corpus).Encode(map[string]any{
			"source": "arxiv_cs_ai", "title": fmt.Sprintf("Study %d of LLM agents", index),
			"link": fmt.Sprintf("https://arxiv.org/abs/2601.%05d", index),
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(h.app.Config.Root, "secnews/data/articles", day+".jsonl"), corpus.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	h.app.Config.PublicPath = "/news"
	status, body, _ := h.request(t, "GET", "/news/api/trend?days=7&scope=ai", nil, "", false)
	if status != 200 || body["current"].(map[string]any)["end"] != day || body["comparable"] != false {
		t.Fatal(status, body)
	}
	topics := body["topics"].([]any)
	if len(topics) != 1 || topics[0].(map[string]any)["count"] != float64(3) || topics[0].(map[string]any)["change"] != nil {
		t.Fatal(topics)
	}
	for _, invalid := range []string{"?days=9", "?days=abc", "?scope=other"} {
		status, _, _ = h.request(t, "GET", "/api/trend"+invalid, nil, "", false)
		if status != 400 {
			t.Fatal(invalid, status)
		}
	}
	h.app.Config.RequireLogin = true
	status, _, _ = h.request(t, "GET", "/api/trend", nil, "", false)
	if status != 401 {
		t.Fatal(status)
	}
}
func TestGeneratedEvidenceOnly(t *testing.T) {
	h := fixture(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"content": `{"items":[{"id":"invented","score":1},{"id":"paper-a","score":5,"reason":"研究智能体提示注入"}]}`}}}})
	}))
	defer upstream.Close()
	h.app.AI.Config.LLMKey = "test"
	h.app.AI.Config.LLMURL = upstream.URL
	status, v, _ := h.request(t, "POST", "/api/related-work", map[string]any{"topic": "LLM agents", "candidates": []map[string]any{{"id": "paper-a", "title": "Prompt Injection in LLM Agents", "year": "2026"}}}, "", false)
	if status != 200 {
		t.Fatal(status, v)
	}
	items := v["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["id"] != "paper-a" || items[0].(map[string]any)["score"] != float64(1) {
		t.Fatal("invented evidence or unbounded score", items)
	}
}

func TestOfflineBriefingAndStatisticsRemainAvailable(t *testing.T) {
	h := fixture(t)
	for _, kind := range []string{"field-briefing", "summary-brief"} {
		body := map[string]any{"query": "LLM prompt injection", "source": "top-conf"}
		if kind == "summary-brief" {
			body["query"] = ""
		}
		status, v, _ := h.request(t, "POST", "/api/"+kind, body, "", false)
		if status != 200 || v["fallback"] != true || len(v["papers"].([]any)) != 1 {
			t.Fatal("offline feature unavailable", kind, status, v)
		}
		if kind == "summary-brief" && v["stats"].(map[string]any)["sample_size"] != float64(1) {
			t.Fatal("fabricated statistics", v)
		}
	}
}

func TestGenerationPreservesExplicitImpressionWhileDefaultingOmittedField(t *testing.T) {
	h := fixture(t)
	h.login(t, "generation@example.com")
	status, _, _ := h.request(t, "PUT", "/api/content/impression", map[string]string{"text": "LLM agents"}, h.csrf, true)
	if status != 200 {
		t.Fatal(status)
	}
	for _, kind := range []string{"field-briefing", "summary-brief"} {
		body := map[string]any{"query": "", "source": "top-conf"}
		status, result, _ := h.request(t, "POST", "/api/"+kind, body, h.csrf, true)
		if status != 200 || result["query"] != "LLM agents" {
			t.Fatal("omitted impression did not use saved context", kind, status, result)
		}
		body["impression"] = "Privacy"
		status, result, _ = h.request(t, "POST", "/api/"+kind, body, h.csrf, true)
		if status != 200 || result["query"] != "Privacy" {
			t.Fatal("explicit context was replaced", kind, status, result)
		}
		body["impression"] = ""
		status, result, _ = h.request(t, "POST", "/api/"+kind, body, h.csrf, true)
		if kind == "field-briefing" && status != 400 {
			t.Fatal("explicit empty context inherited saved topic", status, result)
		}
		if kind == "summary-brief" && (status != 200 || result["query"] == "LLM agents") {
			t.Fatal("panorama inherited personal topic", status, result)
		}
	}
}

func TestNewsScopeSelectsLatestPopulatedArchiveDate(t *testing.T) {
	h := fixture(t)
	directory := filepath.Join(h.app.Config.Root, "secnews/data/articles")
	files := map[string]string{
		"2026-11-22": `{"_id":"general","title":"World news","source":"research_digest"}`,
		"2026-11-21": `{"_id":"ai","title":"AI release","source":"openai"}`,
		"2026-11-20": `{"_id":"news","title":"Security news","source":"bleepingcomputer"}`,
		"2026-11-18": `{"_id":"paper","title":"Research paper","source":"arxiv_cs_se"}`,
	}
	for day, content := range files {
		if err := os.WriteFile(filepath.Join(directory, day+".jsonl"), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, test := range []struct {
		query, date, id string
		count           int
	}{
		{"", "2026-11-22", "general", 1},
		{"?source=news", "2026-11-22", "general", 1},
		{"?source=articles", "2026-11-22", "general", 1},
		{"?source=ai", "2026-11-21", "ai", 1},
		{"?source=security&date=2026-11-21", "2026-11-21", "", 0},
		{"?source=articles&date=2026-11-18", "2026-11-18", "", 0},
		{"?source=arxiv", "2026-11-18", "paper", 1},
		{"?source=security", "2026-11-20", "news", 1},
		{"?source=arxiv&date=2026-11-20", "2026-11-20", "", 0},
		{"?source=security&date=2026-11-18", "2026-11-18", "", 0},
	} {
		status, result, _ := h.request(t, "GET", "/api/news"+test.query, nil, "", false)
		if status != 200 || result["date"] != test.date {
			t.Fatal(test.query, status, result)
		}
		articles := result["articles"].([]any)
		if len(articles) != test.count {
			t.Fatal(test.query, articles)
		}
		if test.count > 0 && articles[0].(map[string]any)["_id"] != test.id {
			t.Fatal(test.query, articles)
		}
	}
	status, _, _ := h.request(t, "GET", "/api/news?source=unknown", nil, "", false)
	if status != 400 {
		t.Fatal("unknown archive scope accepted", status)
	}
}

func TestCoverageFollowsReportVisibility(t *testing.T) {
	h := fixture(t)
	h.app.Config.RequireLogin = true
	status, _, _ := h.request(t, "GET", "/api/coverage", nil, "", false)
	if status != 401 {
		t.Fatal("private coverage exposed", status)
	}
	h.login(t, "coverage@example.com")
	status, result, _ := h.request(t, "GET", "/api/coverage", nil, "", true)
	if status != 200 || len(result["conferences"].([]any)) != 1 {
		t.Fatal("authenticated coverage unavailable", status, result)
	}
}

func TestReleaseSymlinkAndReportAssets(t *testing.T) {
	h := fixture(t)
	link := filepath.Join(t.TempDir(), "current")
	if e := os.Symlink(h.app.Config.WebDir, link); e != nil {
		t.Fatal(e)
	}
	h.app.Config.WebDir = link
	resp, e := http.Get(h.http.URL + "/")
	if e != nil {
		t.Fatal(e)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatal("release symlink failed", resp.StatusCode)
	}
	h.app.Config.PublicPath = "/news"
	resp, e = http.Get(h.http.URL + "/news/top-conf/data/report/USENIX_2026_Report.json?download=1")
	if e != nil {
		t.Fatal(e)
	}
	defer resp.Body.Close()
	b, e := io.ReadAll(resp.Body)
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Contains(b, []byte(`"text":"Report"`)) {
		t.Fatal("report data changed")
	}

	response, e := http.Get(h.http.URL + "/assets/gate.js")
	if e != nil {
		t.Fatal(e)
	}
	response.Body.Close()
	if response.StatusCode != 404 {
		t.Fatal("deleted asset is still served")
	}

}

func TestRequireLoginProtectsCatalogAndReport(t *testing.T) {
	h := fixture(t)
	h.app.Config.RequireLogin = true
	status, _, _ := h.request(t, "GET", "/api/catalog", nil, "", false)
	if status != 401 {
		t.Fatal("private catalog exposed", status)
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, e := client.Get(h.http.URL + "/top-conf/data/report/USENIX_2026_Report.json")
	if e != nil {
		t.Fatal(e)
	}
	res.Body.Close()
	if res.StatusCode != 302 || !strings.HasPrefix(res.Header.Get("Location"), "/login?next=") {
		t.Fatal("private report exposed", res.StatusCode)
	}
	h.login(t, "private@example.com")
	status, _, _ = h.request(t, "GET", "/api/catalog", nil, "", true)
	if status != 200 {
		t.Fatal("local reader blocked", status)
	}
}

func TestPrivateGenerationRejectsBeforeModelCalls(t *testing.T) {
	h := fixture(t)
	var calls atomic.Int32
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		content := `{"scope":"Fixture corpus","title":"Fixture report","findings":[{"title":"Observed","body":"Fixture evidence"}],"items":[{"id":"paper-a","score":0.9,"reason":"Relevant fixture"}]}`
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"content": content}}}})
	}))
	defer model.Close()
	research := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/content/me" || r.Header.Get("Authorization") != "Bearer valid-legacy" {
			w.WriteHeader(401)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid legacy session"})
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"accountId": "legacy-reader"})
	}))
	defer research.Close()
	h.app.Config.RequireLogin = true
	h.app.Config.ResearchURL = research.URL
	h.app.AI.Config.LLMURL = model.URL
	h.app.AI.Config.LLMKey = "fixture-key"
	h.app.AI.Config.LLMModel = "fixture-model"
	payload := map[string]any{"query": "LLM", "topic": "LLM", "candidates": []any{map[string]string{"id": "paper-a", "title": "Prompt Injection in LLM Agents"}}}
	paths := []string{"/api/field-briefing", "/api/summary-brief", "/api/related-work"}
	for _, path := range paths {
		for _, cookie := range []*http.Cookie{nil, {Name: "fastnews_session", Value: "invalid-local"}, {Name: "fr_session", Value: "invalid-legacy"}} {
			h.cookie = cookie
			status, _, _ := h.request(t, "POST", path, payload, "", cookie != nil)
			if status != 401 || calls.Load() != 0 {
				t.Fatalf("unauthorized %s status=%d model calls=%d", path, status, calls.Load())
			}
		}
	}
	h.login(t, "generation-reader@example.test")
	for _, path := range paths {
		status, _, _ := h.request(t, "POST", path, payload, h.csrf, true)
		if status != 200 {
			t.Fatalf("authenticated generation %s: %d", path, status)
		}
	}
	if calls.Load() != 3 {
		t.Fatal("authenticated requests did not exercise the actual model transport", calls.Load())
	}
	h.cookie = &http.Cookie{Name: "fr_session", Value: "valid-legacy"}
	for _, path := range paths {
		status, _, _ := h.request(t, "POST", path, payload, "", true)
		if status != 200 {
			t.Fatalf("valid legacy generation %s: %d", path, status)
		}
	}
	if calls.Load() != 6 {
		t.Fatal("valid legacy model calls", calls.Load())
	}
	h.app.Config.RequireLogin = false
	for _, path := range paths {
		status, _, _ := h.request(t, "POST", path, payload, "", false)
		if status != 200 {
			t.Fatalf("public generation %s: %d", path, status)
		}
	}
	if calls.Load() != 9 {
		t.Fatal("public mode behavior changed", calls.Load())
	}
}

func TestLegacyResearchSSOProfileWritesHandoffAndLogout(t *testing.T) {
	h := fixture(t)
	wrote := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/sso/consume" && r.Header.Get("Authorization") != "Bearer legacy-session" {
			t.Error("wrong Research token")
		}
		if r.Header.Get("Cookie") != "" {
			t.Error("local cookie forwarded")
		}
		var v any
		switch r.URL.Path {
		case "/api/sso/consume":
			v = map[string]string{"session": "legacy-session", "keyId": "key-one"}
		case "/api/content/me":
			v = map[string]any{"session": "legacy-session", "accountId": "research-one", "keyId": "key-one", "person": "Legacy Reader", "authors": []any{}, "customTags": []any{}, "impression": map[string]string{"text": "LLM"}, "inboxUnread": 0}
		case "/api/content/impression":
			wrote = true
			v = map[string]any{"impression": map[string]string{"text": "updated"}}
		case "/api/sso/ticket":
			v = map[string]string{"ticket": "read-ticket"}
		case "/api/content/logout":
			v = map[string]bool{"ok": true}
		default:
			t.Error("unexpected Research endpoint", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		json.NewEncoder(w).Encode(v)
	}))
	defer upstream.Close()
	h.app.Config.ResearchURL = upstream.URL
	h.app.Config.PublicPath = "/news"
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, e := client.Get(h.http.URL + "/news/?sso=one-time-ticket")
	if e != nil {
		t.Fatal(e)
	}
	res.Body.Close()
	if res.StatusCode != 302 || res.Header.Get("Location") != "/news/" {
		t.Fatal(res.StatusCode, res.Header)
	}
	for _, c := range res.Cookies() {
		if c.Name == "fr_session" {
			h.cookie = c
		}
	}
	if h.cookie == nil || !h.cookie.HttpOnly {
		t.Fatal("SSO session missing")
	}
	status, v, _ := h.request(t, "GET", "/api/content/me", nil, "", true)
	if status != 200 || v["userId"] != "research-one" || v["source"] != "research" || v["session"] != nil {
		t.Fatal("legacy profile incompatible", status, v)
	}
	csrf := v["csrf"].(string)
	status, _, _ = h.request(t, "PUT", "/api/content/impression", map[string]string{"text": "updated"}, csrf, true)
	if status != 200 || !wrote {
		t.Fatal("legacy write failed", status)
	}
	status, v, _ = h.request(t, "POST", "/api/fastread", map[string]string{"title": "A paper", "authors": "Alice"}, "", true)
	if status != 200 || !strings.Contains(v["redirect"].(string), "sso=read-ticket") {
		t.Fatal("legacy handoff failed", status, v)
	}
	status, _, headers := h.request(t, "POST", "/api/content/logout", map[string]any{}, csrf, true)
	if status != 200 || !strings.Contains(headers.Get("Set-Cookie"), "Max-Age=0") {
		t.Fatal("legacy logout cookie not cleared", status, headers)
	}
}

func TestPrivateWorkspaceProtectsNativeReportAndRawData(t *testing.T) {
	h := fixture(t)
	h.app.Config.RequireLogin = true
	for _, path := range []string{"/api/report?path=top-conf/data/report/USENIX_2026_Report.json", "/api/papers", "/api/sources", "/api/reports", "/api/trend"} {
		status, _, _ := h.request(t, "GET", path, nil, "", false)
		if status != 401 {
			t.Fatal(path, status)
		}
	}
	status, info, _ := h.request(t, "GET", "/api/auth/info", nil, "", false)
	if status != 200 || info["requireLogin"] != true {
		t.Fatal(info)
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for _, path := range []string{"/", "/sources/", "/report/?path=top-conf/data/report/USENIX_2026_Report.json", "/top-conf/data/report/USENIX_2026_Report.json", "/top-conf/data/conferences/usenix_2026.jsonl"} {
		res, err := client.Get(h.http.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 302 || !strings.HasPrefix(res.Header.Get("Location"), "/login?next=") {
			t.Fatal(path, res.StatusCode)
		}
	}
	h.login(t, "reader@example.com")
	status, body, _ := h.request(t, "GET", "/api/report?path=top-conf/data/report/USENIX_2026_Report.json", nil, "", true)
	if status != 200 || len(body["content"].([]any)) != 1 {
		t.Fatal(status, body)
	}
	status, _, _ = h.request(t, "GET", "/api/report?path=../../private/accounts.sqlite", nil, "", true)
	if status != 404 {
		t.Fatal(status)
	}
}
