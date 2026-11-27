package catalog

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSourceDirectorySeparatesConfigurationResearchAndEvidence(t *testing.T) {
	root := t.TempDir()
	for _, dir := range []string{"config", "secnews/data/articles"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	configuration := `[{"id":"openai","disabled":true},{"id":"private_feed","name":"My Feed","channel":"news","url":"https://example.org/private/token-path?key=do-not-publish"}]`
	if err := os.WriteFile(filepath.Join(root, "config/news-sources.json"), []byte(configuration), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "secnews/data/articles/2026-11-27.jsonl"), []byte("{\"source\":\"openai\",\"_id\":\"one\"}\n{\"source\":\"private_feed\",\"_id\":\"two\"}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	directory, err := (&Catalog{Root: root}).SourceDirectory()
	if err != nil {
		t.Fatal(err)
	}
	if directory.ArchiveDate != "2026-11-27" {
		t.Fatal(directory.ArchiveDate)
	}
	found := map[string]DirectorySource{}
	for _, source := range directory.Sources {
		if _, duplicate := found[source.ID]; duplicate {
			t.Fatal("duplicate ID", source.ID)
		}
		found[source.ID] = source
		if source.Category == "cve" && source.Configured {
			t.Fatal("research candidate promoted to collector", source)
		}
	}
	if !found["openai"].Disabled || found["openai"].RecentCount != 1 {
		t.Fatal(found["openai"])
	}
	if found["private_feed"].URL != "https://example.org" || !found["private_feed"].Configured || found["private_feed"].RecentCount != 1 {
		t.Fatal(found["private_feed"])
	}
	raw, _ := json.Marshal(directory)
	if strings.Contains(string(raw), "do-not-publish") || strings.Contains(string(raw), "token-path") {
		t.Fatal("feed credentials exposed")
	}
}
