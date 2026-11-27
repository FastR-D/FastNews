package catalog

import (
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var newsSourceID = regexp.MustCompile(`^[a-z][a-z0-9_-]*$`)

// A config file extends the defaults by ID; disabled entries opt out of feeds.
// Reading this file does not fetch feeds. Collection requires a CLI or administrator task.
func LoadNewsSources(root, file string) ([]NewsSource, error) {
	explicit := file != ""
	if file == "" {
		file = filepath.Join(root, "config/news-sources.json")
	}
	sources := map[string]NewsSource{}
	for _, source := range NewsSources {
		sources[source.ID] = source
	}
	b, err := os.ReadFile(file)
	if err != nil && (explicit || !os.IsNotExist(err)) {
		return nil, err
	}
	if err == nil {
		var overrides []NewsSource
		decoder := json.NewDecoder(strings.NewReader(string(b)))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&overrides); err != nil {
			return nil, fmt.Errorf("news sources: %w", err)
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			return nil, fmt.Errorf("news sources: expected one JSON array")
		}
		seen := map[string]bool{}
		for _, source := range overrides {
			if !newsSourceID.MatchString(source.ID) || seen[source.ID] || source.ID == "all" || ValidNewsChannel(source.ID) {
				return nil, fmt.Errorf("news sources: invalid or duplicate id %q", source.ID)
			}
			seen[source.ID] = true
			previous, exists := sources[source.ID]
			if !exists {
				previous, _ = NewsSourcePreset(source.ID)
			}
			source.Name = First(source.Name, previous.Name, source.ID)
			source.URL = First(source.URL, previous.URL)
			source.Channel = First(source.Channel, previous.Channel)
			source.Format = First(source.Format, previous.Format)
			source.Transport = First(source.Transport, previous.Transport)
			u, err := url.Parse(source.URL)
			if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil {
				return nil, fmt.Errorf("news sources: %s requires an HTTP(S) feed URL without credentials", source.ID)
			}
			if !ValidNewsChannel(source.Channel) || (source.Channel == "arxiv") != strings.HasPrefix(source.ID, "arxiv_") {
				return nil, fmt.Errorf("news sources: invalid channel for %s", source.ID)
			}
			if source.Format != "" && source.Format != "rss" && source.Format != "cisa-kev" && source.Format != "nvd" {
				return nil, fmt.Errorf("news sources: invalid format for %s", source.ID)
			}
			if source.Transport != "" && source.Transport != "direct" && source.Transport != "relay" && source.Transport != "auto" {
				return nil, fmt.Errorf("news sources: invalid transport for %s", source.ID)
			}
			if source.MaxAgeDays < -1 || source.MaxAgeDays > 36500 {
				return nil, fmt.Errorf("news sources: invalid max_age_days for %s", source.ID)
			}
			sources[source.ID] = source
		}
	}
	out := make([]NewsSource, 0, len(sources))
	for _, source := range sources {
		out = append(out, source)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}
