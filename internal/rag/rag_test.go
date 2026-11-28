package rag

import (
	"context"
	"encoding/json"
	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/config"
	"github.com/FastR-D/FastNews/internal/modelconfig"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRemoteFailureRebuildsBothSides(t *testing.T) {
	fail := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail {
			w.WriteHeader(502)
			return
		}
		var body struct {
			Input []string `json:"input"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		rows := []map[string]any{}
		for i := range body.Input {
			rows = append(rows, map[string]any{"index": i, "embedding": []float64{1, 0, 0}})
		}
		json.NewEncoder(w).Encode(map[string]any{"data": rows})
	}))
	defer upstream.Close()
	r := Retriever{Config: config.Config{EmbeddingURL: upstream.URL, LLMKey: "test"}}
	papers := []catalog.Paper{{ID: "a", Title: "LLM jailbreak prompt injection", Year: 2026}, {ID: "b", Title: "network traffic compression", Year: 2025}}
	if _, provider, e := r.Search(context.Background(), papers, "LLM jailbreak", 2); e != nil || provider != "openai" {
		t.Fatal(provider, e)
	}
	fail = true
	hits, provider, e := r.Search(context.Background(), papers, "LLM jailbreak", 2)
	if e != nil || provider != "hash" || hits[0].ID != "a" {
		t.Fatal(hits, provider, e)
	}
	if len(r.vectors[0]) != 128 {
		t.Fatal("kept remote vectors with offline query")
	}
}

func TestAlternatingCorporaReuseRemoteEmbeddings(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body struct {
			Input []string `json:"input"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		rows := []map[string]any{}
		for i := range body.Input {
			rows = append(rows, map[string]any{"index": i, "embedding": []float64{1, 0}})
		}
		json.NewEncoder(w).Encode(map[string]any{"data": rows})
	}))
	defer upstream.Close()
	r := Retriever{Config: config.Config{EmbeddingURL: upstream.URL}}
	a := []catalog.Paper{{ID: "a", Title: "A"}}
	b := []catalog.Paper{{ID: "b", Title: "B"}}
	for _, pool := range [][]catalog.Paper{a, b, a, b} {
		if _, _, e := r.Search(context.Background(), pool, "query", 1); e != nil {
			t.Fatal(e)
		}
	}
	if calls != 6 {
		t.Fatal("corpus was embedded again", calls)
	}
}

func TestModelChangeRebuildsCorpusVectors(t *testing.T) {
	calls := map[string]int{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string   `json:"model"`
			Input []string `json:"input"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		calls[body.Model]++
		rows := []map[string]any{}
		vector := []float64{1, 0}
		if body.Model == "second" {
			vector = []float64{0, 1, 0}
		}
		for i := range body.Input {
			rows = append(rows, map[string]any{"index": i, "embedding": vector})
		}
		json.NewEncoder(w).Encode(map[string]any{"data": rows})
	}))
	defer upstream.Close()
	c := config.Config{DataDir: t.TempDir()}
	profile := modelconfig.Profile{ID: "vec", Name: "Vectors", Kind: "embedding", BaseURL: upstream.URL, Model: "first", MaxTokens: 128, TimeoutSeconds: 10}
	saved, err := modelconfig.Save(c, modelconfig.Settings{Profiles: []modelconfig.Profile{profile}, Assignments: map[string]string{"embedding": "vec"}})
	if err != nil {
		t.Fatal(err)
	}
	r := Retriever{Config: c}
	papers := []catalog.Paper{{ID: "a", Title: "Research"}}
	if _, provider, err := r.Search(context.Background(), papers, "research", 1); err != nil || provider != "openai" {
		t.Fatal(provider, err)
	}
	saved.Profiles[0].Model = "second"
	if _, err = modelconfig.Save(c, saved); err != nil {
		t.Fatal(err)
	}
	if _, provider, err := r.Search(context.Background(), papers, "research", 1); err != nil || provider != "openai" {
		t.Fatal(provider, err)
	}
	if calls["first"] != 2 || calls["second"] != 2 || len(r.vectors[0]) != 3 {
		t.Fatal("stale vectors reused", calls)
	}
}
