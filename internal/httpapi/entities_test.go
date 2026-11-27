package httpapi

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEntitiesRespectLoginAndExactNames(t *testing.T) {
	h := fixture(t)
	h.app.Config.RequireLogin = true
	status, _, _ := h.request(t, "GET", "/api/entities?kind=author&name=Alice", nil, "", false)
	if status != 401 {
		t.Fatal(status)
	}
	h.login(t, "entities@example.com")
	for _, name := range []string{"Alice", "Researcher"} {
		status, v, _ := h.request(t, "GET", "/api/entities?kind=author&name="+name, nil, "", true)
		if status != 200 || v["total"] != float64(0) {
			t.Fatal(status, v)
		}
	}
	status, v, _ := h.request(t, "GET", "/api/entities?kind=author&name=Alice%20Researcher", nil, "", true)
	if status != 200 || v["total"] != float64(1) || v["match"] != "name" {
		t.Fatal(status, v)
	}
	os.WriteFile(filepath.Join(h.app.Config.Root, "top-conf/data/conferences/icse_2026.jsonl"), []byte(`{"_id":"other","title":"Example","link":"https://example.org/p","author":"Alice Researcher","authors_list":[{"name":"Alice Researcher","url":"https://example.org/other","affiliations":[{"name":"Example University"}]}]}`), 0600)
	h.app.Catalog.Invalidate()
	status, v, _ = h.request(t, "GET", "/api/entities?kind=author&name=Alice%20Researcher&ref=https%3A%2F%2Fexample.org%2Fother", nil, "", true)
	if status != 200 || v["total"] != float64(1) || v["match"] != "source-profile" {
		t.Fatal(status, v)
	}
	status, v, _ = h.request(t, "GET", "/api/entities?kind=institution&name=Example%20University", nil, "", true)
	if status != 200 || v["total"] != float64(1) {
		t.Fatal(status, v)
	}
}
func TestRegistryProfilesRetainSourceFacts(t *testing.T) {
	v, err := parseRegistryProfile("ORCID", []byte(`{"name":{"given-names":{"value":"Alice"},"family-name":{"value":"Example"}},"biography":{"content":"Studies software agents."},"researcher-urls":{"researcher-url":[{"url-name":"Homepage","url":{"value":"https://example.org/alice"}}]}}`))
	if err != nil || v["title"] != "Alice Example" || v["description"] != "Studies software agents." {
		t.Fatal(v, err)
	}
	v, err = parseRegistryProfile("ROR", []byte(`{"names":[{"value":"Example University","types":["ror_display"]}],"established":1900,"status":"active","types":["education"],"links":[{"type":"website","value":"https://example.org"}]}`))
	if err != nil || v["title"] != "Example University" {
		t.Fatal(v, err)
	}
}
func TestPaperPlansShareManualAndScheduledSelection(t *testing.T) {
	h := fixture(t)
	targets, err := h.app.selectedCollectionSources("papers-ml")
	if err != nil || len(targets) != 3 {
		t.Fatal(targets, err)
	}
	for _, target := range targets {
		if target.Paper == nil || target.Paper.Domain != "ml" {
			t.Fatal(target)
		}
	}
	if _, err := h.app.selectedCollectionSources("paper-arbitrary-url"); err == nil {
		t.Fatal("unknown selection accepted")
	}
}
