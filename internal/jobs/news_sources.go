package jobs

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/FastR-D/FastNews/internal/catalog"
)

// NewsProgress reports committed rows and per-source failures to a task monitor.
type NewsProgress struct {
	Source  string `json:"source"`
	State   string `json:"state"`
	Fetched int    `json:"fetched"`
	Added   int    `json:"added"`
	Stale   int    `json:"stale"`
	Error   string `json:"error,omitempty"`
}

func (p *Pipeline) newsProgress(event NewsProgress) {
	if p.NewsProgress != nil {
		p.NewsProgress(event)
	}
}

func (p *Pipeline) newsSources(file string) ([]catalog.NewsSource, error) {
	return catalog.LoadNewsSources(p.Config.Root, file)
}

func newsLinkKey(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return raw
	}
	u.Fragment = ""
	u.Host = strings.ToLower(u.Host)
	query := u.Query()
	for key := range query {
		if strings.HasPrefix(strings.ToLower(key), "utm_") || key == "fbclid" || key == "gclid" || key == "at_medium" || key == "at_campaign" {
			query.Del(key)
		}
	}
	u.RawQuery = query.Encode()
	return u.String()
}

func feedPublished(raw string) time.Time {
	for _, layout := range []string{time.RFC3339Nano, time.RFC1123Z, time.RFC1123, time.RFC822Z, time.RFC822, time.RFC850, time.ANSIC, "2006-01-02T15:04:05-0700", "2006-01-02"} {
		if parsed, err := time.Parse(layout, strings.TrimSpace(raw)); err == nil {
			return parsed
		}
	}
	return time.Time{}
}

func (p *Pipeline) FetchNewsConfigured(ctx context.Context, selection, override, file string) error {
	sources, err := p.newsSources(file)
	if err != nil {
		return err
	}
	group := selection == "all" || catalog.ValidNewsChannel(selection)
	if override != "" && group {
		return fmt.Errorf("--url requires a single source")
	}
	selected := []catalog.NewsSource{}
	for _, source := range sources {
		if source.Disabled {
			continue
		}
		if selection == "all" || selection == source.ID || selection == source.Channel {
			selected = append(selected, source)
		}
	}
	if len(selected) == 0 {
		return fmt.Errorf("no enabled sources for %q", selection)
	}
	if override != "" {
		selected[0].URL = override
	}
	return p.FetchNewsSources(ctx, selected)
}

// FetchNewsSources collects an already validated snapshot of enabled sources.
func (p *Pipeline) FetchNewsSources(ctx context.Context, selected []catalog.NewsSource) error {
	// Load the archive once per batch. Slow-moving feeds must not reappear after
	// the old seven-day dedup window expires, including after a process restart.
	seen := map[string]bool{}
	dates, err := p.Catalog.Dates()
	if err != nil {
		return err
	}
	for _, day := range dates {
		rows, err := catalog.Rows(filepath.Join(p.Config.Root, "secnews/data/articles", day+".jsonl"))
		if err != nil {
			return err
		}
		for _, row := range rows {
			if id := catalog.Str(row, "_id"); id != "" {
				seen["id:"+id] = true
			}
			if link := catalog.Str(row, "link"); link != "" {
				seen["url:"+newsLinkKey(link)] = true
			}
		}
	}
	day := time.Now().UTC().Format("2006-01-02")
	var failures []error
	for _, source := range selected {
		if err := ctx.Err(); err != nil {
			return errors.Join(append(failures, err)...)
		}
		p.newsProgress(NewsProgress{Source: source.ID, State: "running"})
		raw, err := get(ctx, source.URL)
		var rows []map[string]any
		if err == nil {
			rows, err = parseFeed(raw, source)
		}
		if err != nil {
			if errors.Is(ctx.Err(), context.Canceled) {
				p.newsProgress(NewsProgress{Source: source.ID, State: "cancelled"})
				return errors.Join(append(failures, ctx.Err())...)
			}
			p.newsProgress(NewsProgress{Source: source.ID, State: "failed", Error: err.Error()})
			failures = append(failures, fmt.Errorf("%s: %w", source.ID, err))
			continue
		}
		out := []map[string]any{}
		pending := map[string]bool{}
		maxAge := source.MaxAgeDays
		if maxAge == 0 {
			maxAge = 14
		}
		cutoff := time.Now().UTC().AddDate(0, 0, -maxAge)
		stale := 0
		for _, row := range rows {
			published := feedPublished(catalog.Str(row, "published"))
			if maxAge > 0 && !published.IsZero() && published.Before(cutoff) {
				stale++
				continue
			}
			id, link := "id:"+catalog.Str(row, "_id"), "url:"+newsLinkKey(catalog.Str(row, "link"))
			if seen[id] || seen[link] || pending[id] || pending[link] {
				continue
			}
			pending[id], pending[link] = true, true
			out = append(out, row)
		}
		if len(out) > 0 {
			if err := appendRows(filepath.Join(p.Config.Root, "secnews/data/articles", day+".jsonl"), out); err != nil {
				p.newsProgress(NewsProgress{Source: source.ID, State: "failed", Error: err.Error()})
				return errors.Join(append(failures, err)...)
			}
			for key := range pending {
				seen[key] = true
			}
		}
		p.newsProgress(NewsProgress{Source: source.ID, State: "completed", Fetched: len(rows), Added: len(out), Stale: stale})
		fmt.Fprintf(os.Stderr, "%s [%s]: fetched=%d stale=%d added=%d\n", source.ID, source.Channel, len(rows), stale, len(out))
	}
	return errors.Join(failures...)
}
