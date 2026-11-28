package httpapi

import (
	"encoding/json"
	"github.com/FastR-D/FastNews/internal/modelconfig"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAdminModelsPermissionsSecretsAndConnection(t *testing.T) {
	h := fixture(t)
	if status, _, _ := h.request(t, "GET", "/api/admin/models", nil, "", false); status != 401 {
		t.Fatal(status)
	}
	h.login(t, "models@example.com")
	if status, _, _ := h.request(t, "GET", "/api/admin/models", nil, "", true); status != 403 {
		t.Fatal(status)
	}
	current, _ := h.app.Store.Session(h.cookie.Value)
	if _, err := h.app.Store.DB.Exec(`UPDATE users SET role='admin' WHERE id=?`, current.UserID); err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer admin-secret" {
			t.Error("stored key not used")
		}
		w.Write([]byte(`{"choices":[{"finish_reason":"stop","message":{"content":"{\"ok\":true}"}}]}`))
	}))
	defer upstream.Close()
	p := modelconfig.Profile{ID: "a", Name: "Test", Kind: "chat", BaseURL: upstream.URL, Model: "test", APIKey: "admin-secret", MaxTokens: 1000, TimeoutSeconds: 10}
	s := modelconfig.Settings{Default: "a", Profiles: []modelconfig.Profile{p}}
	if status, _, _ := h.request(t, "PUT", "/api/admin/models", s, "", true); status != 403 {
		t.Fatal("csrf", status)
	}
	status, result, _ := h.request(t, "PUT", "/api/admin/models", s, h.csrf, true)
	if status != 200 {
		t.Fatal(status, result)
	}
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), "admin-secret") || strings.Contains(string(raw), "apiKey") {
		t.Fatal("secret leaked")
	}
	if status, _, _ := h.request(t, "PUT", "/api/admin/models", s, h.csrf, true); status != 409 {
		t.Fatal("conflict", status)
	}
	p.APIKey = ""
	if status, _, _ := h.request(t, "POST", "/api/admin/models/test", p, "", true); status != 403 {
		t.Fatal("test csrf", status)
	}
	if status, res, _ := h.request(t, "POST", "/api/admin/models/test", p, h.csrf, true); status != 200 {
		t.Fatal(status, res)
	}
	status, result, _ = h.request(t, "GET", "/api/admin/models", nil, "", true)
	raw, _ = json.Marshal(result)
	if status != 200 || strings.Contains(string(raw), "admin-secret") {
		t.Fatal("read secret leak")
	}
	s.Revision = 1
	s.Profiles[0].APIKey = ""
	if status, _, _ := h.request(t, "PUT", "/api/admin/models", s, h.csrf, true); status != 200 {
		t.Fatal(status)
	}
	stored, err := modelconfig.Load(h.app.Config)
	if err != nil || stored.Profiles[0].APIKey != "admin-secret" {
		t.Fatal("key not preserved")
	}
	s.Revision = 2
	s.Profiles[0].ClearKey = true
	if status, res, _ := h.request(t, "PUT", "/api/admin/models", s, h.csrf, true); status != 200 {
		t.Fatal(status, res)
	}
	stored, _ = modelconfig.Load(h.app.Config)
	if stored.Profiles[0].APIKey != "" {
		t.Fatal("key not cleared")
	}
	s.Revision = 3
	s.Assignments = map[string]string{"embedding": "a"}
	if status, _, _ := h.request(t, "PUT", "/api/admin/models", s, h.csrf, true); status != 400 {
		t.Fatal("kind mismatch", status)
	}
	upstream.Close()
	if status, result, _ := h.request(t, "POST", "/api/admin/models/test", p, h.csrf, true); status != 502 {
		t.Fatal(status, result)
	}
}
