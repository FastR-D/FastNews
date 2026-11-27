package catalog

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestReviewedPresetsRequireExplicitActivation(t *testing.T) {
	root := t.TempDir()
	before, err := LoadNewsSources(root, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range before {
		if s.ID == "source_3" {
			t.Fatal("preset subscribed without activation")
		}
	}
	var presets []NewsSource
	if err = json.Unmarshal(newsSourcePresetsJSON, &presets); err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Join(root, "config"), 0700)
	os.WriteFile(filepath.Join(root, "config/news-sources.json"), newsSourcePresetsJSON, 0600)
	after, err := LoadNewsSources(root, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before)+len(presets) {
		t.Fatal(len(after))
	}
	for _, s := range presets {
		if s.URL == "" || s.Channel == "" || s.Name == "" {
			t.Fatal(s)
		}
	}
}
