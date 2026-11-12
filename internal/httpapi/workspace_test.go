package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	fastcas "github.com/FastR-D/FastCAS/sdk/go"
)

type summaryFixture struct {
	link    *fastcas.Link
	active  bool
	service bool
	fail    bool
}

func (f *summaryFixture) VerifyAccessToken(_ context.Context, raw, aud string, scopes ...string) (*fastcas.AccessClaims, error) {
	if raw != "valid" || aud != "news" || len(scopes) != 1 || scopes[0] != "workspace:read" {
		return nil, errors.New("invalid token")
	}
	return &fastcas.AccessClaims{Subject: "fastresearch", ClientID: "fastresearch", Service: f.service}, nil
}
func (f *summaryFixture) IntrospectToken(context.Context, string) (*fastcas.Introspection, error) {
	return &fastcas.Introspection{Active: f.active, Subject: "fastresearch", ClientID: "fastresearch", Audience: []string{"news"}, Scope: "workspace:read"}, nil
}
func (f *summaryFixture) ResolveLink(_ context.Context, subject string) (*fastcas.Link, error) {
	if f.fail {
		return nil, errors.New("unavailable")
	}
	if f.link.Subject != subject {
		return nil, errors.New("mismatch")
	}
	return f.link, nil
}
func TestWorkspaceSummaryIsScopedReadOnlyAndNotAnAccountCreator(t *testing.T) {
	h := fixture(t)
	user, e := h.app.Store.Create("workspace@example.test", "test-password-12345", "Reader")
	if e != nil {
		t.Fatal(e)
	}
	other, e := h.app.Store.Create("other@example.test", "test-password-12345", "Other")
	if e != nil {
		t.Fatal(e)
	}
	h.app.Config.CASIssuer = "https://cas.test"
	h.app.Config.CASClientID = "news"
	f := &summaryFixture{active: true, service: true, link: &fastcas.Link{ID: "binding", ClientID: "news", Subject: "subject", LocalRef: user, State: "active", Version: 2}}
	h.app.workspaceCAS = f
	_, e = h.app.Store.DB.Exec(`INSERT INTO cas_links VALUES(?,?,?,?,?,?,?,?)`, h.app.Config.CASIssuer, "binding", "news", user, "subject", "active", 2, "{}")
	if e != nil {
		t.Fatal(e)
	}
	if e = h.app.Store.Set(user, "inbox", []map[string]any{{"id": "own", "title": "My subscription", "read": false}}); e != nil {
		t.Fatal(e)
	}
	_ = h.app.Store.Set(other, "inbox", []map[string]any{{"id": "secret", "title": "Other user's secret"}})
	call := func(subject, token string) (int, map[string]any) {
		r := httptest.NewRequest("POST", "/api/integrations/fastresearch/workspace", strings.NewReader(`{"subject":"`+subject+`"}`))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		h.app.Handler().ServeHTTP(w, r)
		var out map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		if strings.Contains(w.Body.String(), "Other user's secret") {
			t.Fatal("another user's private data leaked")
		}
		return w.Code, out
	}
	status, body := call("subject", "valid")
	if status != 200 || body["accountState"] != "active" {
		t.Fatal(status, body)
	}
	status, body = call("missing", "valid")
	if status != 200 || body["accountState"] != "missing" {
		t.Fatal(status, body)
	}
	f.fail = true
	if status, _ = call("subject", "valid"); status != 503 {
		t.Fatal("provider failure advertised account as missing", status)
	}
	f.fail = false
	f.active = false
	if status, _ = call("subject", "valid"); status != 401 {
		t.Fatal("revoked service accepted", status)
	}
	f.active = true
	f.service = false
	if status, _ = call("subject", "valid"); status != 401 {
		t.Fatal("user token used as service", status)
	}
	f.service = true
	if status, _ = call("subject", "forged"); status != 401 {
		t.Fatal("forged token accepted", status)
	}
	var inbox []map[string]any
	_ = h.app.Store.Personal(user, "inbox", &inbox)
	if inbox[0]["read"] != false {
		t.Fatal("summary changed unread state")
	}
	var n int
	_ = h.app.Store.DB.QueryRow(`SELECT count(*) FROM users`).Scan(&n)
	if n != 2 {
		t.Fatal("summary created an account")
	}
}
