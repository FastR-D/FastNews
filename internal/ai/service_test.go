package ai

import (
	"context"
	"encoding/json"
	"github.com/FastR-D/FastNews/internal/config"
	"github.com/FastR-D/FastNews/internal/modelconfig"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSceneRoutingReloadAndDisabled(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		expected := "default-model"
		if calls == 2 {
			expected = "summary-model"
		}
		if body["model"] != expected || body["max_tokens"] != float64(2048) || body["temperature"] != 0.5 || r.Header.Get("Authorization") != "Bearer private" {
			t.Error("incorrect provider request", body["model"])
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"choices":[{"finish_reason":"stop","message":{"content":"{\"ok\":true}"}}]}`))
	}))
	defer upstream.Close()
	c := config.Config{DataDir: t.TempDir()}
	svc := Service{Config: c}
	a := modelconfig.Profile{ID: "a", Name: "Default", Kind: "chat", BaseURL: upstream.URL, Model: "default-model", APIKey: "private", MaxTokens: 2048, Temperature: 0.5, TimeoutSeconds: 10}
	b := a
	b.ID = "b"
	b.Model = "summary-model"
	saved, e := modelconfig.Save(c, modelconfig.Settings{Default: "a", Profiles: []modelconfig.Profile{a, b}, Assignments: map[string]string{"paper-summary": "b"}})
	if e != nil {
		t.Fatal(e)
	}
	var out map[string]any
	for _, scene := range []string{"field-briefing", "paper-summary"} {
		if e := svc.CompleteFor(context.Background(), scene, "system", "user", &out); e != nil {
			t.Fatal(e)
		}
	}
	saved.Assignments["paper-summary"] = "a"
	saved, e = modelconfig.Save(c, saved)
	if e != nil {
		t.Fatal(e)
	}
	if e := svc.CompleteFor(context.Background(), "paper-summary", "system", "user", &out); e != nil {
		t.Fatal(e)
	}
	saved.Assignments["paper-summary"] = "disabled"
	if _, e = modelconfig.Save(c, saved); e != nil {
		t.Fatal(e)
	}
	if e := svc.CompleteFor(context.Background(), "paper-summary", "system", "user", &out); e == nil || calls != 3 {
		t.Fatal("disabled scene still called provider")
	}
}
