package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/FastR-D/FastNews/internal/config"
	"github.com/FastR-D/FastNews/internal/store"
)

type harness struct {
	app    *Server
	http   *httptest.Server
	cookie *http.Cookie
	csrf   string
}

func fixture(t *testing.T) *harness {
	t.Helper()
	root := t.TempDir()
	for _, dir := range []string{"web/dist", "web/dist/reports", "top-conf/data/conferences", "top-conf/data/summary", "top-conf/data/report", "secnews/data/articles"} {
		if e := os.MkdirAll(filepath.Join(root, dir), 0700); e != nil {
			t.Fatal(e)
		}
	}
	for _, name := range []string{"handoff.js", "report.css"} {
		data, e := os.ReadFile(filepath.Join("..", "..", "web/public/reports", name))
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(filepath.Join(root, "web/dist/reports", name), data, 0600); e != nil {
			t.Fatal(e)
		}
	}
	os.WriteFile(filepath.Join(root, "web/dist/index.html"), []byte(`<div id="root">React</div>`), 0600)
	os.WriteFile(filepath.Join(root, "top-conf/data/conferences/usenix_2026.jsonl"), []byte(`{"_id":"paper-a","title":"Prompt Injection in LLM Agents","author":"Alice Researcher","link":"https://example.com/a"}`), 0600)
	os.WriteFile(filepath.Join(root, "top-conf/data/summary/usenix_2026_summary.jsonl"), []byte(`{"category":"ML/AI Security","paper":{"_id":"paper-a","title":"Prompt Injection in LLM Agents","author":"Alice Researcher","summary_zh":"研究智能体工具调用中的提示注入风险"}}`), 0600)
	os.WriteFile(filepath.Join(root, "top-conf/data/report/USENIX_2026_Report.html"), []byte(`<h1>Report</h1>`), 0600)
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
	t.Cleanup(func() { server.Close(); s.Close() })
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
	if status != 409 {
		t.Fatal("local account forwarded to Research", status)
	}
}
func TestCatalogOldRoutesAndPrivateFiles(t *testing.T) {
	h := fixture(t)
	for _, p := range []string{"/", "/index.html", "/top-conf/index.html", "/field-briefing/index.html", "/summary-brief/index.html", "/inbox/index.html", "/impression/index.html", "/secnews/index.html", "/login", "/top-conf/data/report/USENIX_2026_Report.html?download=1"} {
		resp, e := http.Get(h.http.URL + p)
		if e != nil {
			t.Fatal(e)
		}
		resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatal(p, resp.StatusCode)
		}
	}
	for _, p := range []string{"/.env", "/private/accounts.sqlite", "/serve.py", "/top-conf/data/report/../../../private/accounts.sqlite", "/missing.html"} {
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
			body["query"] = "四大顶会全景"
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
	resp, e = http.Get(h.http.URL + "/news/top-conf/data/report/USENIX_2026_Report.html")
	if e != nil {
		t.Fatal(e)
	}
	defer resp.Body.Close()
	b, e := io.ReadAll(resp.Body)
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Contains(b, []byte("<h1>Report</h1>")) {
		t.Fatal("report data changed")
	}
	for _, suffix := range []string{"/assets/fastread.js", "/reports/handoff.js", "/assets/fastread.css", "/reports/report.css"} {
		response, e := http.Get(h.http.URL + "/news" + suffix)
		if e != nil {
			t.Fatal(e)
		}
		response.Body.Close()
		if response.StatusCode != 200 {
			t.Fatal("report resource unavailable", suffix, response.StatusCode)
		}
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
	res, e := client.Get(h.http.URL + "/top-conf/data/report/USENIX_2026_Report.html")
	if e != nil {
		t.Fatal(e)
	}
	res.Body.Close()
	if res.StatusCode != 302 || res.Header.Get("Location") != "/login" {
		t.Fatal("private report exposed", res.StatusCode)
	}
	h.login(t, "private@example.com")
	status, _, _ = h.request(t, "GET", "/api/catalog", nil, "", true)
	if status != 200 {
		t.Fatal("local reader blocked", status)
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
