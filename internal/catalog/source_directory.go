package catalog

import (
	_ "embed"
	"encoding/json"
	"net/url"
	"path/filepath"
	"sort"
)

//go:embed source_directory.json
var sourceResearch []byte

type SourceReference struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	URL   string `json:"url"`
}

type DirectorySource struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	URL          string            `json:"url"`
	Category     string            `json:"category"`
	Description  string            `json:"description"`
	Verification string            `json:"verification"`
	ReviewedAt   string            `json:"reviewedAt,omitempty"`
	Note         string            `json:"note,omitempty"`
	References   []SourceReference `json:"references"`
	Configured   bool              `json:"configured"`
	Disabled     bool              `json:"disabled"`
	Channel      string            `json:"channel,omitempty"`
	RecentCount  int               `json:"recentCount"`
}

type SourceDirectory struct {
	Sources     []DirectorySource `json:"sources"`
	ArchiveDate string            `json:"archiveDate"`
}

// SourceDirectory describes research separately from actual configuration and
// archive evidence. It does not crawl, expose feed credentials, or imply health.
func (c *Catalog) SourceDirectory() (SourceDirectory, error) {
	var result SourceDirectory
	if err := json.Unmarshal(sourceResearch, &result.Sources); err != nil {
		return result, err
	}
	configured, err := LoadNewsSources(c.Root, "")
	if err != nil {
		return result, err
	}
	byID := map[string]int{}
	for i, source := range result.Sources {
		byID[source.ID] = i
	}
	for _, source := range configured {
		i, ok := byID[source.ID]
		if !ok {
			// Runtime feed URLs may include API tokens. Publish only a credential-free
			// origin for sources absent from the curated public research catalogue.
			website := ""
			if u, err := url.Parse(source.URL); err == nil {
				website = (&url.URL{Scheme: u.Scheme, Host: u.Host}).String()
			}
			result.Sources = append(result.Sources, DirectorySource{ID: source.ID, Name: source.Name, URL: website, Category: source.Channel, Description: "采集配置中的订阅来源。", Verification: "unreviewed", References: []SourceReference{}})
			i = len(result.Sources) - 1
		}
		result.Sources[i].Configured = true
		result.Sources[i].Disabled = source.Disabled
		result.Sources[i].Channel = source.Channel
		result.Sources[i].Name = source.Name
	}
	dates, err := c.Dates()
	if err != nil {
		return result, err
	}
	if len(dates) > 0 {
		result.ArchiveDate = dates[0]
		rows, err := Rows(filepath.Join(c.Root, "secnews/data/articles", dates[0]+".jsonl"))
		if err != nil {
			return result, err
		}
		counts := map[string]int{}
		for _, row := range rows {
			id := Str(row, "source")
			if source, ok := FindNewsSource(id); ok {
				id = source.ID
			}
			counts[id]++
		}
		for i := range result.Sources {
			result.Sources[i].RecentCount = counts[result.Sources[i].ID]
		}
	}
	sort.SliceStable(result.Sources, func(i, j int) bool {
		a, b := result.Sources[i], result.Sources[j]
		activeA, activeB := a.Configured && !a.Disabled, b.Configured && !b.Disabled
		if activeA != activeB {
			return activeA
		}
		return a.Name < b.Name
	})
	return result, nil
}
