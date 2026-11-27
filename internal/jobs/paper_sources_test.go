package jobs

import (
	"context"
	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/config"
	"os"
	"path/filepath"
	"testing"
)

func TestAdapterRegistryPersistsIdempotentlyAndRejectsInvalidSnapshots(t *testing.T) {
	p := New(config.Config{Root: t.TempDir()})
	p.Provider = "example"
	p.Sources = NewPaperSources()
	rows := []map[string]any{{"_id": "one", "title": "Coding Agents for Testing", "link": "https://example.org/one"}, {"_id": "two", "title": "Coding Agents for Testing", "link": "https://example.org/two"}}
	p.Sources["example"] = sourceAdapter{func(string, int) ([]string, error) { return []string{"https://example.org"}, nil }, func(context.Context, PaperRequest) ([]map[string]any, error) { return rows, nil }}
	for range 2 {
		if err := p.FetchConference(context.Background(), "icse", 2026, ""); err != nil {
			t.Fatal(err)
		}
	}
	file := filepath.Join(p.Config.Root, "top-conf/data/conferences/icse_2026.jsonl")
	saved, _ := catalog.Rows(file)
	if len(saved) != 2 {
		t.Fatal("distinct IDs with same title collapsed", saved)
	}
	before, _ := os.ReadFile(file)
	rows = append(rows, map[string]any{"title": "invalid"})
	if err := p.FetchConference(context.Background(), "icse", 2026, ""); err == nil {
		t.Fatal("invalid snapshot accepted")
	}
	after, _ := os.ReadFile(file)
	if string(before) != string(after) {
		t.Fatal("failed snapshot partially persisted")
	}
}
func TestResearchrUsesAcceptedListAndPreservesAffiliations(t *testing.T) {
	page := `<div class="page-header"><a href="https://conf.researchr.org/home/icse-2026">ICSE 2026</a><h1>Research Track ICSE 2026</h1></div><div class="page-header"><h3>FAQ</h3></div><table><tr><td><a data-event-modal="one">Coding Agents</a><div class="performers"><a href="/profile/icse-2026/alice">Alice</a><span class="prog-aff">Example University</span></div></td></tr><tr><td><a data-event-modal="workshop">A workshop talk</a></td></tr></table><div id="event-overview"><table><tr><td><a data-event-modal="one">Coding Agents</a><div class="prog-track">Research Track</div></td></tr></table></div>`
	rows, err := parseResearchr([]byte(page), "https://conf.researchr.org/track/icse-2026/icse-2026-research-track", "icse", 2026)
	if err != nil || len(rows) != 1 {
		t.Fatal(rows, err)
	}
	people := rows[0]["authors_list"].([]catalog.Scholar)
	if len(people) != 1 || people[0].Affiliations[0].Name != "Example University" {
		t.Fatal(people)
	}
	if _, err := parseResearchr([]byte(page), "https://example.org", "icse", 2025); err == nil {
		t.Fatal("wrong year accepted")
	}
}

func TestICLRNestedAbstractAndWrongYear(t *testing.T) {
	link, _ := iclrPaperURL("https://proceedings.iclr.cc/paper_files/paper/2025/hash/example-Abstract-Conference.html", 2025)
	raw := []byte(`<h1>Example Coding Agents</h1><a href="/paper_files/paper/2025">ICLR 2025</a><section class="paper-section"><h2 class="section-label">Abstract</h2><p class="paper-abstract"><p>We study software agents.</p></p></section>`)
	value, err := iclrAbstract(raw, link, 2025)
	if err != nil || value != "We study software agents." {
		t.Fatal(value, err)
	}
	if _, err := iclrAbstract(raw, link, 2026); err == nil {
		t.Fatal("wrong proceedings year accepted")
	}
}
