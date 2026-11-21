package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/FastR-D/FastNews/internal/catalog"
)

type reviewNote struct {
	ID      string `json:"id"`
	Forum   string `json:"forum"`
	Content struct {
		Title struct {
			Value string `json:"value"`
		} `json:"title"`
		Abstract struct {
			Value string `json:"value"`
		} `json:"abstract"`
		Authors struct {
			Value []string `json:"value"`
		} `json:"authors"`
		Keywords struct {
			Value []string `json:"value"`
		} `json:"keywords"`
		VenueID struct {
			Value string `json:"value"`
		} `json:"venueid"`
		Venue struct {
			Value string `json:"value"`
		} `json:"venue"`
	} `json:"content"`
}

type bibliographyHit struct {
	Info struct {
		Key     string          `json:"key"`
		Title   string          `json:"title"`
		Year    string          `json:"year"`
		Type    string          `json:"type"`
		URL     string          `json:"url"`
		EE      json.RawMessage `json:"ee"`
		Venue   json.RawMessage `json:"venue"`
		Authors struct {
			Author json.RawMessage `json:"author"`
		} `json:"authors"`
	} `json:"info"`
}

// DBLP declares scalar fields and author lists as either one value or an array.
func bibliographyValues(raw json.RawMessage) ([]string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	values := []json.RawMessage{raw}
	if raw[0] == '[' {
		if err := json.Unmarshal(raw, &values); err != nil {
			return nil, err
		}
	}
	out := []string{}
	for _, item := range values {
		var value string
		if len(item) > 0 && item[0] == '"' {
			if err := json.Unmarshal(item, &value); err != nil {
				return nil, err
			}
		} else {
			var named struct {
				Text string `json:"text"`
			}
			if err := json.Unmarshal(item, &named); err != nil {
				return nil, err
			}
			value = named.Text
		}
		if value == "" {
			return nil, fmt.Errorf("empty bibliographic value")
		}
		out = append(out, value)
	}
	return out, nil
}

func (p *Pipeline) fetchStructuredConference(ctx context.Context, conf string, year int, endpoint string) error {
	metadata := catalog.Conferences[conf]
	u, err := url.Parse(endpoint)
	if err != nil {
		return err
	}
	publicEndpoint := *u
	publicEndpoint.User = nil
	publicEndpoint.RawQuery = ""
	publicEndpoint.Fragment = ""
	rows := []map[string]any{}
	seen := map[string]bool{}
	offset := 0
	expectedTotal := -1
	for {
		query := u.Query()
		total, count := 0, 0
		if metadata.Provider == "openreview" {
			venue := fmt.Sprintf("%s/%d/Conference", metadata.RemoteID, year)
			query.Set("content.venueid", venue)
			query.Set("limit", "1000")
			query.Set("offset", strconv.Itoa(offset))
			u.RawQuery = query.Encode()
			body, err := get(ctx, u.String())
			if err != nil {
				return err
			}
			var page struct {
				Notes []reviewNote `json:"notes"`
				Count *int         `json:"count"`
			}
			if err := json.Unmarshal(body, &page); err != nil {
				return fmt.Errorf("OpenReview response: %w", err)
			}
			if page.Count == nil {
				return fmt.Errorf("OpenReview response missing count")
			}
			total, count = *page.Count, len(page.Notes)
			for _, note := range page.Notes {
				if note.ID == "" || note.Content.Title.Value == "" || note.Content.VenueID.Value != venue {
					return fmt.Errorf("OpenReview note lacks identity/title or accepted venue %s", venue)
				}
				link := "https://openreview.net/forum?" + url.Values{"id": {catalog.First(note.Forum, note.ID)}}.Encode()
				if seen[link] {
					return fmt.Errorf("source repeated a paper across pages: %s", link)
				}
				seen[link] = true
				rows = append(rows, map[string]any{"_id": link, "title": note.Content.Title.Value, "link": link,
					"description": note.Content.Abstract.Value, "author": strings.Join(note.Content.Authors.Value, ", "),
					"keywords": note.Content.Keywords.Value, "presentation": note.Content.Venue.Value, "source_url": publicEndpoint.String()})
			}
		} else {
			query.Set("q", fmt.Sprintf("stream:conf/%s: year:%d:", metadata.RemoteID, year))
			query.Set("format", "json")
			query.Set("h", "1000")
			query.Set("f", strconv.Itoa(offset))
			u.RawQuery = query.Encode()
			body, err := get(ctx, u.String())
			if err != nil {
				return err
			}
			var page struct {
				Result struct {
					Hits struct {
						Total string            `json:"@total"`
						Hits  []bibliographyHit `json:"hit"`
					} `json:"hits"`
				} `json:"result"`
			}
			if err := json.Unmarshal(body, &page); err != nil {
				return fmt.Errorf("DBLP response: %w", err)
			}
			total, err = strconv.Atoi(page.Result.Hits.Total)
			if err != nil {
				return fmt.Errorf("DBLP response missing valid total")
			}
			count = len(page.Result.Hits.Hits)
			for _, hit := range page.Result.Hits.Hits {
				v := hit.Info
				if v.Type != "Conference and Workshop Papers" {
					continue
				}
				if v.Year != strconv.Itoa(year) || !strings.HasPrefix(v.Key, "conf/"+metadata.RemoteID+"/") || v.Title == "" {
					return fmt.Errorf("DBLP record is outside the requested conference/year or lacks a title")
				}
				authors, err := bibliographyValues(v.Authors.Author)
				if err != nil {
					return err
				}
				links, err := bibliographyValues(v.EE)
				if err != nil {
					return err
				}
				venues, err := bibliographyValues(v.Venue)
				if err != nil {
					return err
				}
				link := v.URL
				if len(links) > 0 {
					link = links[0]
				}
				if link == "" || seen[v.Key] {
					return fmt.Errorf("DBLP record has no URL or repeats identity: %s", v.Key)
				}
				seen[v.Key] = true
				rows = append(rows, map[string]any{"_id": "https://dblp.org/rec/" + v.Key, "title": v.Title, "link": link,
					"description": "", "author": strings.Join(authors, ", "), "venue": strings.Join(venues, ", "), "source_url": publicEndpoint.String()})
			}
		}
		if expectedTotal >= 0 && total != expectedTotal {
			return fmt.Errorf("source total changed during pagination: %d to %d", expectedTotal, total)
		}
		expectedTotal = total
		if total < 0 || offset+count > total || (count == 0 && offset < total) {
			return fmt.Errorf("incomplete source pagination at %d of %d", offset, total)
		}
		offset += count
		if offset == total {
			break
		}
	}
	if len(rows) == 0 {
		return fmt.Errorf("no papers returned for %s %d", conf, year)
	}
	file := filepath.Join(p.Config.Root, "top-conf/data/conferences", fmt.Sprintf("%s_%d.jsonl", conf, year))
	existing, err := catalog.Rows(file)
	if err != nil {
		return err
	}
	known := map[string]bool{}
	for _, row := range existing {
		known[catalog.Str(row, "_id")] = true
	}
	out := []map[string]any{}
	for _, row := range rows {
		if known[catalog.Str(row, "_id")] {
			continue
		}
		row["source"] = metadata.Name + " " + strconv.Itoa(year)
		row["fetched_at"] = time.Now().UTC().Format(time.RFC3339)
		out = append(out, row)
	}
	return appendRows(file, out)
}
