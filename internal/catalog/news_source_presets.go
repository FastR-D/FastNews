package catalog

import (
	_ "embed"
	"encoding/json"
)

// Presets are reviewed collection endpoints, not subscriptions. Only explicit
// administrator activation or server configuration starts their collection.
//
//go:embed news_source_presets.json
var newsSourcePresetsJSON []byte

func NewsSourcePreset(id string) (NewsSource, bool) {
	var presets []NewsSource
	if json.Unmarshal(newsSourcePresetsJSON, &presets) != nil {
		return NewsSource{}, false
	}
	for _, source := range presets {
		if source.ID == id {
			return source, true
		}
	}
	return NewsSource{}, false
}
