package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	fastcas "github.com/FastR-D/FastCAS/sdk/go"
	"net/http/httptest"
	"strings"
	"testing"
)

type readConnectionProvider struct {
	link            *fastcas.Link
	active, service bool
	scope, audience string
}

func (f *readConnectionProvider) VerifyAccessToken(_ context.Context, token, aud string, scopes ...string) (*fastcas.AccessClaims, error) {
	if token != "service" || aud != "news" || len(scopes) != 1 || scopes[0] != "fastread:connect" {
		return nil, errors.New("denied")
	}
	return &fastcas.AccessClaims{Subject: "fastread-sync", ClientID: "fastread-sync", Service: f.service}, nil
}
func (f *readConnectionProvider) IntrospectToken(context.Context, string) (*fastcas.Introspection, error) {
	return &fastcas.Introspection{Subject: "fastread-sync", ClientID: "fastread-sync", Active: f.active, Audience: []string{f.audience}, Scope: f.scope}, nil
}
func (f *readConnectionProvider) ResolveLink(_ context.Context, subject string) (*fastcas.Link, error) {
	if f.link.Subject != subject {
		return nil, errors.New("not found")
	}
	return f.link, nil
}
func TestReadCASConnectionScopesIdentityAndRevocation(t *testing.T) {
	h := fixture(t)
	h.login(t, "cas-owner@example.test")
	var user string
	if err := h.app.Store.DB.QueryRow("SELECT id FROM users WHERE email='cas-owner@example.test'").Scan(&user); err != nil {
		t.Fatal(err)
	}
	h.app.Config.CASIssuer = "https://cas.test"
	h.app.Config.CASClientID = "news"
	provider := &readConnectionProvider{active: true, service: true, scope: "fastread:connect", audience: "news", link: &fastcas.Link{ID: "link", ClientID: "news", Subject: "subject", LocalRef: user, State: "active", Version: 2}}
	h.app.workspaceCAS = provider
	if _, err := h.app.Store.DB.Exec("INSERT INTO cas_links VALUES(?,?,?,?,?,?,?,?)", "https://cas.test", "link", "news", user, "subject", "active", 2, "{}"); err != nil {
		t.Fatal(err)
	}
	request := func(subject string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/api/integrations/fastread/cas-connect", strings.NewReader(`{"subject":"`+subject+`"}`))
		r.Header.Set("Authorization", "Bearer service")
		w := httptest.NewRecorder()
		h.app.serve(w, r)
		return w
	}
	for _, alter := range []func(){func() { provider.service = false }, func() { provider.active = false }, func() { provider.scope = "workspace:read" }, func() { provider.audience = "wrong" }} {
		alter()
		if w := request("subject"); w.Code != 401 && w.Code != 403 {
			t.Fatal("invalid grant accepted", w.Code, w.Body.String())
		}
		provider.active = true
		provider.service = true
		provider.scope = "fastread:connect"
		provider.audience = "news"
	}
	if w := request("unlinked-subject"); w.Code != 403 {
		t.Fatal("unlinked identity accepted", w.Code)
	}
	w := request("subject")
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	var response map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &response)
	token := response["token"].(string)
	if status, _ := integrationRequest(t, h, "PUT", token, map[string]string{"text": "CAS research direction", "mode": "replace"}); status != 200 {
		t.Fatal("CAS write failed", status)
	}
	r := httptest.NewRequest("GET", "/api/integrations/fastread/token", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	check := httptest.NewRecorder()
	h.app.serve(check, r)
	if check.Code != 200 {
		t.Fatal("credential probe requires browser cookie", check.Code)
	}
	_, _ = h.app.Store.DB.Exec("UPDATE cas_links SET state='revoked',version=3")
	if status, _ := integrationRequest(t, h, "GET", token, nil); status != 403 {
		t.Fatal("revoked CAS credential accepted", status)
	}
	_, _ = h.app.Store.DB.Exec("UPDATE cas_links SET state='active',version=4")
	provider.link.Version = 4
	if status, _ := integrationRequest(t, h, "GET", token, nil); status != 403 {
		t.Fatal("relink revived old credential", status)
	}
}

func TestNewsHandoffUsesCASWithoutResearchTicket(t *testing.T) {
	h := fixture(t)
	h.login(t, "handoff@example.test")
	var user string
	_ = h.app.Store.DB.QueryRow("SELECT id FROM users WHERE email='handoff@example.test'").Scan(&user)
	h.app.Config.CASIssuer = "https://cas.test"
	h.app.Config.CASClientID = "news"
	_, err := h.app.Store.DB.Exec("INSERT INTO cas_links VALUES(?,?,?,?,?,?,?,?)", "https://cas.test", "link", "news", user, "subject", "active", 2, "{}")
	if err != nil {
		t.Fatal(err)
	}
	status, _, _ := h.request(t, "POST", "/api/fastread", map[string]string{"title": "Paper"}, "", true)
	if status != 403 {
		t.Fatal("missing CSRF accepted", status)
	}
	status, response, _ := h.request(t, "POST", "/api/fastread", map[string]string{"title": "Paper", "id": "p1"}, h.csrf, true)
	if status != 200 {
		t.Fatal(status, response)
	}
	target := response["redirect"].(string)
	if !strings.Contains(target, "auth=cas#fastnews=") || strings.Contains(target, "sso=") || strings.Contains(target, h.cookie.Value) {
		t.Fatal("handoff exposed authentication state", target)
	}
}
