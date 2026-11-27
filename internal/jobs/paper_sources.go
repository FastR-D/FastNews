package jobs

import (
	"context"
	"fmt"
	"github.com/FastR-D/FastNews/internal/catalog"
)

// PaperSource fetches a complete source snapshot without writing application data.
// Pagination, publisher identity and track validation belong to the adapter;
// deduplication, topic selection and storage belong to Pipeline.
type PaperSource interface {
	URLs(conference string, year int) ([]string, error)
	Fetch(context.Context, PaperRequest) ([]map[string]any, error)
}

type PaperRequest struct {
	Conference string
	Year       int
	URLs       []string
}

type sourceAdapter struct {
	urls  func(string, int) ([]string, error)
	fetch func(context.Context, PaperRequest) ([]map[string]any, error)
}

func (s sourceAdapter) URLs(c string, y int) ([]string, error) { return s.urls(c, y) }
func (s sourceAdapter) Fetch(ctx context.Context, r PaperRequest) ([]map[string]any, error) {
	return s.fetch(ctx, r)
}

// NewPaperSources returns an independent registry, allowing new domain providers
// or test adapters to be installed without changing the orchestration pipeline.
func NewPaperSources() map[string]PaperSource {
	structured := sourceAdapter{defaultConferenceURLs, func(ctx context.Context, r PaperRequest) ([]map[string]any, error) {
		return fetchStructuredConference(ctx, r.Conference, r.Year, r.URLs[0])
	}}
	proceedings := sourceAdapter{defaultConferenceURLs, func(ctx context.Context, r PaperRequest) ([]map[string]any, error) {
		return fetchProceedings(ctx, r.Conference, r.Year, r.URLs[0])
	}}
	return map[string]PaperSource{
		"html": sourceAdapter{defaultConferenceURLs, func(ctx context.Context, r PaperRequest) ([]map[string]any, error) {
			return fetchHTMLConference(ctx, r.Conference, r.Year, r.URLs)
		}},
		"dblp": structured, "openreview": structured,
		"pmlr": proceedings, "neurips-proceedings": proceedings,
		"researchr":        sourceAdapter{researchrURLs, fetchResearchr},
		"iclr-proceedings": sourceAdapter{iclrProceedingsURLs, fetchICLRProceedings},
	}
}
func ConferenceURLs(conf string, year int) ([]string, error) {
	metadata, err := conferenceInfo(conf, year)
	if err != nil {
		return nil, err
	}
	source := NewPaperSources()[metadata.Provider]
	if source == nil {
		return nil, fmt.Errorf("unregistered paper provider %q", metadata.Provider)
	}
	return source.URLs(conf, year)
}
func (p *Pipeline) FetchConference(ctx context.Context, conf string, year int, override string) error {
	metadata, err := conferenceInfo(conf, year)
	if err != nil {
		return err
	}
	registry := p.Sources
	if registry == nil {
		registry = NewPaperSources()
	}
	provider := catalog.First(p.Provider, metadata.Provider)
	source := registry[provider]
	if source == nil {
		return fmt.Errorf("unregistered paper provider %q", provider)
	}
	if p.Topic != "" && !catalog.ValidTopic(p.Topic) {
		return fmt.Errorf("unknown paper topic %q", p.Topic)
	}
	urls, err := source.URLs(conf, year)
	if err != nil {
		return err
	}
	if override != "" {
		urls = []string{override}
	}
	if len(urls) == 0 {
		return fmt.Errorf("paper source has no endpoint")
	}
	rows, err := source.Fetch(ctx, PaperRequest{conf, year, urls})
	if err != nil {
		return err
	}
	selected := []map[string]any{}
	for _, row := range rows {
		if catalog.Str(row, "_id") == "" || catalog.Str(row, "title") == "" || catalog.Str(row, "link") == "" {
			return fmt.Errorf("paper source returned a record without identity, title or link")
		}
		row["provider"] = provider
		// Preserve the full conference corpus; topic selection is a reading view,
		// never a destructive ingestion filter. Selected counts are reported separately.
		selected = append(selected, row)
	}
	if len(selected) == 0 {
		return fmt.Errorf("no papers returned")
	}
	if err := p.appendConferenceRecords(conf, year, selected); err != nil {
		return err
	}
	p.Catalog.Invalidate()
	return nil
}
