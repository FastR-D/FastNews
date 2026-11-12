package httpapi

import (
	"github.com/FastR-D/FastNews/internal/store"
	"net/http"
	"testing"
)

func TestAdminUserLifecycle(t *testing.T) {
	h := fixture(t)
	h.login(t, "admin@example.com")
	if status, _, _ := h.request(t, "GET", "/api/admin/users", nil, "", true); status != 403 {
		t.Fatal(status)
	}
	current, _ := h.app.Store.Session(h.cookie.Value)
	if _, err := h.app.Store.DB.Exec(`UPDATE users SET role='admin' WHERE id=?`, current.UserID); err != nil {
		t.Fatal(err)
	}
	input := store.UserInput{Email: "member@example.com", Password: "member-password-12345", Name: "Member", Role: "user", Status: "active", Reason: "Team onboarding"}
	if status, _, _ := h.request(t, "POST", "/api/admin/users", input, "", true); status != 403 {
		t.Fatal("CSRF", status)
	}
	status, user, headers := h.request(t, "POST", "/api/admin/users", input, h.csrf, true)
	if status != 201 || headers.Get("Set-Cookie") != "" || user["password"] != nil {
		t.Fatal(status, user)
	}
	id := user["id"].(string)
	raw, _, err := h.app.Store.Login(input.Email, input.Password, "test")
	if err != nil {
		t.Fatal(err)
	}
	if status, _, _ := h.request(t, "POST", "/api/admin/users", input, h.csrf, true); status != 409 {
		t.Fatal("duplicate", status)
	}
	input.Email = "changed@example.com"
	input.Password = "changed-password-12345"
	if status, _, _ := h.request(t, "PATCH", "/api/admin/users/"+id, input, h.csrf, true); status != 200 {
		t.Fatal(status)
	}
	if session, _ := h.app.Store.Session(raw); session != nil {
		t.Fatal("old session survived")
	}
	raw, _, err = h.app.Store.Login(input.Email, input.Password, "test")
	if err != nil {
		t.Fatal(err)
	}
	input.Status = "disabled"
	if status, _, _ := h.request(t, "PATCH", "/api/admin/users/"+id, input, h.csrf, true); status != 200 {
		t.Fatal(status)
	}
	if session, _ := h.app.Store.Session(raw); session != nil {
		t.Fatal("disabled session survived")
	}
	if status, _, _ := h.request(t, "DELETE", "/api/admin/users/"+current.UserID, input, h.csrf, true); status != 409 {
		t.Fatal("self delete", status)
	}
	if status, _, _ := h.request(t, "DELETE", "/api/admin/users/"+id, input, h.csrf, true); status != 200 {
		t.Fatal(status)
	}
}
func TestPublicRegistrationDisabled(t *testing.T) {
	h := fixture(t)
	status, info, _ := h.request(t, "GET", "/api/auth/info", nil, "", false)
	if status != 200 || info["registration"] != false {
		t.Fatal(status, info)
	}
	token := store.Random()
	h.cookie = &http.Cookie{Name: "fastnews_preauth", Value: token}
	if status, _, _ := h.request(t, "POST", "/api/auth/register", map[string]string{"password": "valid-password-12345", "token": "invitation"}, token, true); status != 403 {
		t.Fatal(status)
	}
}
