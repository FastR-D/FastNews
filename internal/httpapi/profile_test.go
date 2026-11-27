package httpapi

import (
	"strings"
	"testing"

	"github.com/FastR-D/FastNews/internal/store"
)

func TestAccountProfileUpdateIsScopedAndRevokesOtherSessions(t *testing.T) {
	h := fixture(t)
	input := map[string]string{"name": "Updated researcher", "email": "updated@example.com", "currentPassword": "test-password-12345", "newPassword": "updated-password-12345", "role": "admin", "id": "someone-else"}
	path := "/api/auth/profile"
	if status, _, _ := h.request(t, "POST", path, input, "", false); status != 401 {
		t.Fatal(status)
	}
	h.login(t, "reader@example.com")
	otherRaw, _, err := h.app.Store.Login("reader@example.com", "test-password-12345", "other-device")
	if err != nil {
		t.Fatal(err)
	}
	current, _ := h.app.Store.Session(h.cookie.Value)
	if status, _, _ := h.request(t, "POST", path, input, "", true); status != 403 {
		t.Fatal(status)
	}
	input["currentPassword"] = "incorrect"
	if status, _, _ := h.request(t, "POST", path, input, h.csrf, true); status != 403 {
		t.Fatal(status)
	}
	input["currentPassword"] = "test-password-12345"
	if _, err := h.app.Store.Create("existing@example.com", "test-password-12345", "Existing"); err != nil {
		t.Fatal(err)
	}
	input["email"] = "existing@example.com"
	if status, _, _ := h.request(t, "POST", path, input, h.csrf, true); status != 409 {
		t.Fatal(status)
	}
	input["email"] = "updated@example.com"
	status, body, _ := h.request(t, "POST", path, input, h.csrf, true)
	if status != 200 || body["id"] != current.UserID || body["role"] != "user" || body["name"] != input["name"] || body["password"] != nil {
		t.Fatal(status, body)
	}
	if old, _ := h.app.Store.Session(otherRaw); old != nil {
		t.Fatal("old session survived password change")
	}
	if kept, _ := h.app.Store.Session(h.cookie.Value); kept == nil || kept.Email != input["email"] {
		t.Fatal(kept)
	}
	if _, _, err := h.app.Store.Login(input["email"], "test-password-12345", "check-old"); err == nil {
		t.Fatal("old password accepted")
	}
	if _, _, err := h.app.Store.Login(input["email"], input["newPassword"], "check-new"); err != nil {
		t.Fatal(err)
	}
	var hash string
	if err := h.app.Store.DB.QueryRow(`SELECT password FROM users WHERE id=?`, current.UserID).Scan(&hash); err != nil || !store.Check(hash, input["newPassword"]) || strings.Contains(hash, input["newPassword"]) {
		t.Fatal("invalid password storage", err)
	}
}
