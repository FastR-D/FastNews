package identity

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"sync"
	"testing"
	"time"

	fastcas "github.com/FastR-D/FastCAS/sdk/go"
	"github.com/FastR-D/FastNews/internal/config"
	"github.com/FastR-D/FastNews/internal/store"
	"golang.org/x/oauth2"
)

func setup(t *testing.T) (*CAS, string, string) {
	t.Helper()
	s, e := store.Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	user, e := s.Create("cas@example.com", "test-password-12345", "")
	if e != nil {
		t.Fatal(e)
	}
	raw, _, e := s.Login("cas@example.com", "test-password-12345", "test")
	if e != nil {
		t.Fatal(e)
	}
	c, e := New(config.Config{CASEnabled: true, CASIssuer: "https://cas.example.org", CASClientID: "news", CASSecret: "test", CASRedirect: "https://news.example.org/api/auth/fastcas/callback", CASLogin: true, CASLink: true, ResearchConnect: true, VaultKey: base64.RawURLEncoding.EncodeToString(make([]byte, 32))}, s)
	if e != nil {
		t.Fatal(e)
	}
	return c, user, raw
}
func TestTransactionAtomicTake(t *testing.T) {
	c, _, _ := setup(t)
	ctx := context.Background()
	if e := c.Put(ctx, fastcas.Transaction{State: "one", ExpiresAt: time.Now().Add(time.Minute)}); e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	count := 0
	for range 5 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			v, e := c.Take(ctx, "one")
			if e != nil {
				t.Error(e)
			}
			if v != nil {
				mu.Lock()
				count++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if count != 1 {
		t.Fatal("transaction replay", count)
	}
}
func TestRevocationAffectsOnlyCASAndRollsBack(t *testing.T) {
	c, user, local := setup(t)
	link := &fastcas.Link{ID: "link-one", ClientID: "news", Subject: "identity-one", LocalRef: user, State: "active", Version: 1}
	if e := c.Accept(link); e != nil {
		t.Fatal(e)
	}
	result := &fastcas.LoginResult{Identity: fastcas.Identity{Issuer: c.Config.CASIssuer, Subject: link.Subject, SessionID: "sid"}, Token: &oauth2.Token{AccessToken: "access-secret", RefreshToken: "refresh-secret", Expiry: time.Now().Add(time.Hour)}}
	raw, e := c.issue(link, result)
	if e != nil {
		t.Fatal(e)
	}
	revoked := *link
	revoked.Version = 2
	revoked.State = "revoked"
	event := fastcas.Notification{ID: "event-one", Type: "account_link.revoked", Link: &revoked}
	if _, e = c.Store.DB.Exec(`CREATE TRIGGER fail_event BEFORE INSERT ON cas_events BEGIN SELECT RAISE(ABORT,'retry'); END;`); e != nil {
		t.Fatal(e)
	}
	if e = c.Notification(context.Background(), event); e == nil {
		t.Fatal("event failure ignored")
	}
	var n int
	if e = c.Store.DB.QueryRow(`SELECT count(*) FROM sessions WHERE hash=?`, store.Digest(raw)).Scan(&n); e != nil || n != 1 {
		t.Fatal("partial event committed")
	}
	c.Store.DB.Exec(`DROP TRIGGER fail_event`)
	if e = c.Notification(context.Background(), event); e != nil {
		t.Fatal(e)
	}
	if e = c.Notification(context.Background(), event); e != nil {
		t.Fatal("duplicate not idempotent", e)
	}
	if v, e := c.Store.Session(raw); e != nil || v != nil {
		t.Fatal("CAS session survived revoke")
	}
	if v, e := c.Store.Session(local); e != nil || v == nil {
		t.Fatal("local session revoked")
	}
	if e = c.Store.DB.QueryRow(`SELECT count(*) FROM cas_token_vault`).Scan(&n); e != nil || n != 0 {
		t.Fatal("vault not deleted", n, e)
	}
	if e = c.Accept(link); e == nil {
		t.Fatal("stale active link resurrected")
	}
}
func TestVaultCipherIsSessionBound(t *testing.T) {
	c, user, _ := setup(t)
	link := &fastcas.Link{ID: "one", ClientID: "news", Subject: "subject", LocalRef: user, State: "active", Version: 1}
	if e := c.Accept(link); e != nil {
		t.Fatal(e)
	}
	raw, e := c.issue(link, &fastcas.LoginResult{Identity: fastcas.Identity{Issuer: c.Config.CASIssuer, Subject: "subject"}, Token: &oauth2.Token{AccessToken: "access-secret", RefreshToken: "refresh-secret", Expiry: time.Now().Add(time.Hour)}})
	if e != nil {
		t.Fatal(e)
	}
	var b []byte
	var subject string
	if e = c.Store.DB.QueryRow(`SELECT subject,access_cipher FROM cas_token_vault WHERE session_hash=?`, store.Digest(raw)).Scan(&subject, &b); e != nil {
		t.Fatal(e)
	}
	plain, e := c.open(b, store.Digest(raw), subject)
	if e != nil || plain != "access-secret" {
		t.Fatal(plain, e)
	}
	if _, e = c.open(b, "another-session", subject); e == nil {
		t.Fatal("ciphertext moved across sessions")
	}
	var provider string
	c.Store.DB.QueryRow(`SELECT provider FROM sessions WHERE hash=?`, store.Digest(raw)).Scan(&provider)
	var v map[string]any
	if e = json.Unmarshal([]byte(provider), &v); e != nil {
		t.Fatal(e)
	}
}
