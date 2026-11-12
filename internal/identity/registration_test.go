package identity

import (
	"context"
	fastcas "github.com/FastR-D/FastCAS/sdk/go"
	"github.com/FastR-D/FastNews/internal/store"
	"testing"
)

func TestCASAdminPromotion(t *testing.T) {
	c, user, _ := setup(t)
	link := &fastcas.Link{ID: "admin-link", ClientID: "news", Subject: "cas-admin", LocalRef: user, State: "active", Version: 1}
	if err := c.Accept(link); err != nil {
		t.Fatal(err)
	}
	result := &fastcas.LoginResult{Identity: fastcas.Identity{Issuer: c.Config.CASIssuer, Subject: link.Subject, Role: "admin"}}
	raw, err := c.issue(link, result)
	if err != nil {
		t.Fatal(err)
	}
	session, err := c.Store.Session(raw)
	if err != nil || session.Role != "admin" {
		t.Fatal(session, err)
	}
	result.Identity.Role = "member"
	if _, err = c.issue(link, result); err != nil {
		t.Fatal(err)
	}
	session, _ = c.Store.Session(raw)
	if session.Role != "admin" {
		t.Fatal("local admin demoted")
	}
	c.Store.DB.Exec(`UPDATE users SET status='disabled' WHERE id=?`, user)
	if _, err = c.issue(link, result); err == nil {
		t.Fatal("disabled user logged in")
	}
}
func TestRegistrationRequiresFreshBrowserProofAndUniqueAccount(t *testing.T) {
	c, _, _ := setup(t)
	binding := store.Random()
	c.Store.DB.Exec(`INSERT INTO cas_signups VALUES(?,?,?,?,?,?,NULL)`, store.Digest(binding), c.Config.CASIssuer, "subject", "cas@example.com", "Name", store.Now()+300)
	if _, err := c.RegistrationStatus("wrong-browser"); err == nil {
		t.Fatal("wrong browser accepted")
	}
	if _, _, err := c.BeginRegistration(context.Background(), binding, store.UserInput{Email: "cas@example.com", Password: "test-password-12345", Role: "admin"}); err == nil {
		t.Fatal("existing account merged")
	}
	c.Store.DB.Exec(`UPDATE cas_signups SET expires=0`)
	if _, err := c.RegistrationStatus(binding); err == nil {
		t.Fatal("expired proof accepted")
	}
}
