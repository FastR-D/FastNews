package store

import (
	"encoding/json"
	"sync"
	"testing"
)

func openTest(t *testing.T) *Store {
	t.Helper()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func TestRecoveryPreservesIdentityAndRevokesSessions(t *testing.T) {
	s := openTest(t)
	id, e := s.Create("Reader@Example.com", "long-password-123", "")
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Set(id, "impression", map[string]string{"text": "LLM security"}); e != nil {
		t.Fatal(e)
	}
	old, _, e := s.Login("reader@example.com", "long-password-123", "test")
	if e != nil {
		t.Fatal(e)
	}
	token, e := s.Issue("recovery", "reader@example.com")
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Redeem("recovery", token, "new-password-12345", "test"); e != nil {
		t.Fatal(e)
	}
	if e = s.Redeem("recovery", token, "another-password-123", "test"); e == nil {
		t.Fatal("credential replay accepted")
	}
	v, e := s.Session(old)
	if e != nil || v != nil {
		t.Fatal("old session survived recovery")
	}
	raw, _, e := s.Login("reader@example.com", "new-password-12345", "test")
	if e != nil {
		t.Fatal(e)
	}
	current, e := s.Session(raw)
	if e != nil || current.UserID != id {
		t.Fatal("identity changed")
	}
	var im map[string]string
	if e = s.Personal(id, "impression", &im); e != nil || im["text"] != "LLM security" {
		t.Fatal("content lost")
	}
}
func TestInvitationSingleConsumer(t *testing.T) {
	s := openTest(t)
	raw, e := s.Issue("invite", "new@example.com")
	if e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	success := make(chan bool, 2)
	for range 2 {
		wg.Add(1)
		go func() { defer wg.Done(); success <- s.Redeem("invite", raw, "test-password-12345", "test") == nil }()
	}
	wg.Wait()
	close(success)
	n := 0
	for v := range success {
		if v {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("invitation consumed %d times", n)
	}
}
func TestImportIsExplicitAndAtomic(t *testing.T) {
	s := openTest(t)
	a, _ := s.Create("a@example.com", "test-password-12345", "")
	b, _ := s.Create("b@example.com", "test-password-12345", "")
	sections := map[string]any{"authors": map[string]any{"authors": []any{}, "customTags": []string{}}, "impression": map[string]string{"text": "Research profile"}, "inbox": []any{}}
	if _, e := s.Import(a, "research-a", "key-a", sections, false); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Import(b, "research-a", "key-a", sections, true); e == nil {
		t.Fatal("Research account shared across users")
	}
	if _, e := s.Import(a, "research-a", "key-a", sections, false); e == nil {
		t.Fatal("content overwritten without replace")
	}
	if e := s.Set(a, "settings", map[string]bool{"dark": true}); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Import(a, "research-a", "key-a", sections, true); e != nil {
		t.Fatal(e)
	}
	var settings map[string]bool
	if e := s.Personal(a, "settings", &settings); e != nil || !settings["dark"] {
		t.Fatal("unrelated settings lost")
	}
	var absent any
	if e := s.Personal(b, "impression", &absent); e != nil || absent != nil {
		t.Fatal("partial import leaked into second account")
	}
}
func TestConcurrentPersonalUpdate(t *testing.T) {
	s := openTest(t)
	id, _ := s.Create("counter@example.com", "test-password-12345", "")
	var wg sync.WaitGroup
	for range 15 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if e := s.Update(id, "settings", func(raw json.RawMessage) (any, error) {
				n := 0
				if len(raw) > 0 {
					if e := json.Unmarshal(raw, &n); e != nil {
						return nil, e
					}
				}
				return n + 1, nil
			}); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	var n int
	if e := s.Personal(id, "settings", &n); e != nil || n != 15 {
		t.Fatalf("lost update: %d %v", n, e)
	}
}
