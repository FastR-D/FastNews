package modelconfig

import (
	"encoding/json"
	"errors"
	"github.com/FastR-D/FastNews/internal/config"
	"os"
	"strings"
	"sync"
	"testing"
)

func sample() Profile {
	return Profile{ID: "chat1", Name: "Chat", Kind: "chat", BaseURL: "https://example.org/v1", Model: "model-a", APIKey: "private-test-key", Temperature: 0.4, MaxTokens: 2048, TimeoutSeconds: 30}
}
func TestPersistenceRedactionAndLiveResolution(t *testing.T) {
	c := config.Config{DataDir: t.TempDir(), LLMKey: "env-key", LLMModel: "env-model"}
	if m, e := Resolve(c, "summary-brief"); e != nil || m.Model != "env-model" {
		t.Fatal(m, e)
	}
	s, e := Save(c, Settings{Default: "chat1", Profiles: []Profile{sample()}, Assignments: map[string]string{"news-summary": "disabled"}})
	if e != nil {
		t.Fatal(e)
	}
	info, _ := os.Stat(File(c))
	if info.Mode().Perm() != 0600 {
		t.Fatal("key file permissions")
	}
	raw, _ := json.Marshal(Redact(s))
	if strings.Contains(string(raw), "private-test-key") || strings.Contains(string(raw), "apiKey") || !strings.Contains(string(raw), `"hasKey":true`) {
		t.Fatal("redaction")
	}
	if m, e := Resolve(c, "field-briefing"); e != nil || m.Model != "model-a" || m.APIKey != "private-test-key" {
		t.Fatal("saved default not resolved")
	}
	if m, e := Resolve(c, "news-summary"); e != nil || m.Enabled {
		t.Fatal("disabled scene called model")
	}
	edited := Redact(s)
	edited.Profiles[0].Model = "model-b"
	s, e = Save(c, edited)
	if e != nil {
		t.Fatal(e)
	}
	loaded, e := Load(c)
	if e != nil || loaded.Profiles[0].APIKey != "private-test-key" {
		t.Fatal("blank key lost stored secret")
	}
	if m, e := Resolve(c, "field-briefing"); e != nil || m.Model != "model-b" {
		t.Fatal("configuration did not reload")
	}
	if _, e = Save(c, edited); !errors.Is(e, ErrConflict) {
		t.Fatal("stale write allowed", e)
	}
	edited = Redact(s)
	edited.Profiles[0].ClearKey = true
	if _, e = Save(c, edited); e != nil {
		t.Fatal(e)
	}
	loaded, _ = Load(c)
	if loaded.Profiles[0].APIKey != "" {
		t.Fatal("clear key failed")
	}
}
func TestValidationAndConcurrentEdits(t *testing.T) {
	c := config.Config{DataDir: t.TempDir()}
	for _, s := range []Settings{
		{Default: "missing"}, {Profiles: []Profile{sample()}, Assignments: map[string]string{"embedding": "chat1"}},
		{Assignments: map[string]string{"unknown": "disabled"}},
	} {
		if _, err := Save(c, s); err == nil {
			t.Fatal("invalid settings accepted")
		}
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, e := Save(c, Settings{Profiles: []Profile{sample()}}); results <- e }()
	}
	wg.Wait()
	close(results)
	success, conflict := 0, 0
	for e := range results {
		if e == nil {
			success++
		} else if errors.Is(e, ErrConflict) {
			conflict++
		} else {
			t.Fatal(e)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatal(success, conflict)
	}
}
