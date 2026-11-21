package catalog

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"path/filepath"
)

// ConferenceRows overlays checkpointed publisher abstracts on original records.
func (c *Catalog) ConferenceRows(conf string, year int) ([]map[string]any, error) {
	name := fmt.Sprintf("%s_%d.jsonl", conf, year)
	rows, err := Rows(filepath.Join(c.Root, "top-conf/data/conferences", name))
	if err != nil {
		return nil, err
	}
	abstracts, err := Rows(filepath.Join(c.Root, "top-conf/data/abstracts", name))
	if err != nil {
		return nil, err
	}
	byID := map[string]map[string]any{}
	for _, row := range rows {
		byID[Str(row, "_id")] = row
	}
	for _, record := range abstracts {
		row := byID[Str(record, "_id")]
		if row == nil || Str(record, "description") == "" || Str(record, "description_source") == "" {
			continue
		}
		row["description"], row["description_source"] = record["description"], record["description_source"]
	}
	return rows, nil
}

// ConferenceSourceHash binds regenerated summaries to enriched source evidence.
// Unenriched archives keep their existing ID-only checkpoints.
func ConferenceSourceHash(paper map[string]any) string {
	if Str(paper, "description_source") == "" {
		return ""
	}
	body, _ := json.Marshal(paper)
	return fmt.Sprintf("%x", sha256.Sum256(body))
}
