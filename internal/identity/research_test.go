package identity

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResearchProofReadsSnapshotAndLogsOut(t *testing.T) {
	loggedOut := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/content/unlock" && r.Header.Get("Authorization") != "Bearer temporary-research-session" {
			t.Error("missing Research proof")
		}
		if r.Header.Get("Cookie") != "" {
			t.Error("local cookie forwarded")
		}
		var response any
		switch r.URL.Path {
		case "/api/content/unlock":
			response = map[string]string{"session": "temporary-research-session", "accountId": "research-uuid", "keyId": "key-id"}
		case "/api/content/me":
			response = map[string]string{"accountId": "research-uuid", "keyId": "key-id"}
		case "/api/content/authors":
			response = map[string]any{"authors": []any{}, "customTags": []string{}}
		case "/api/content/impression":
			response = map[string]any{"impression": map[string]string{"text": "security"}}
		case "/api/content/inbox":
			response = map[string]any{"items": []any{}}
		case "/api/content/logout":
			loggedOut = true
			response = map[string]bool{"ok": true}
		default:
			w.WriteHeader(404)
			return
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer upstream.Close()
	id, key, sections, e := Snapshot(context.Background(), upstream.URL, "test-research-key")
	if e != nil || id != "research-uuid" || key != "key-id" || len(sections) != 3 || !loggedOut {
		t.Fatal(id, key, sections, e, loggedOut)
	}
}
func TestResearchRefusesRedirectAndCleansUpAfterMismatch(t *testing.T) {
	redirected := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected = true; w.WriteHeader(200) }))
	defer target.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL+"/leak", 302) }))
	defer upstream.Close()
	if _, _, _, e := Snapshot(context.Background(), upstream.URL, "test-research-key"); e == nil || redirected {
		t.Fatal("proof followed redirect", e, redirected)
	}
	logout := false
	mismatch := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/content/unlock":
			json.NewEncoder(w).Encode(map[string]string{"session": "temp", "accountId": "one", "keyId": "key"})
		case "/api/content/me":
			json.NewEncoder(w).Encode(map[string]string{"accountId": "two", "keyId": "key"})
		case "/api/content/logout":
			logout = true
			json.NewEncoder(w).Encode(map[string]bool{"ok": true})
		}
	}))
	defer mismatch.Close()
	if _, _, _, e := Snapshot(context.Background(), mismatch.URL, "test-research-key"); e == nil || !logout {
		t.Fatal("proof mismatch accepted or session leaked", e, logout)
	}
}
