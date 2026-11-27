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
		AuthorIDs struct {
			Value []string `json:"value"`
		} `json:"authorids"`
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

func fetchStructuredConference(ctx context.Context, conf string, year int, endpoint string) ([]map[string]any, error) {
	metadata := catalog.Conferences[conf]
	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, err
	}
	publicEndpoint := publicConferenceEndpoint(u)
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
				return nil, err
			}
			var page struct {
				Notes []reviewNote `json:"notes"`
				Count *int         `json:"count"`
			}
			if err := json.Unmarshal(body, &page); err != nil {
				return nil, fmt.Errorf("OpenReview response: %w", err)
			}
			if page.Count == nil {
				return nil, fmt.Errorf("OpenReview response missing count")
			}
			total, count = *page.Count, len(page.Notes)
			for _, note := range page.Notes {
				if note.ID == "" || note.Content.Title.Value == "" || note.Content.VenueID.Value != venue {
					return nil, fmt.Errorf("OpenReview note lacks identity/title or accepted venue %s", venue)
				}
				link := "https://openreview.net/forum?" + url.Values{"id": {catalog.First(note.Forum, note.ID)}}.Encode()
				if seen[link] {
					return nil, fmt.Errorf("source repeated a paper across pages: %s", link)
				}
				seen[link] = true
				rows = append(rows, map[string]any{"_id": link, "title": note.Content.Title.Value, "link": link,
					"description": note.Content.Abstract.Value, "author": strings.Join(note.Content.Authors.Value, ", "),
					"track": "conference", "authors_list": reviewAuthors(note), "keywords": note.Content.Keywords.Value, "presentation": note.Content.Venue.Value, "source_url": publicEndpoint})
			}
		} else {
			query.Set("q", fmt.Sprintf("stream:conf/%s: year:%d:", metadata.RemoteID, year))
			query.Set("format", "json")
			query.Set("h", "1000")
			query.Set("f", strconv.Itoa(offset))
			u.RawQuery = query.Encode()
			body, err := get(ctx, u.String())
			if err != nil {
				return nil, err
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
				return nil, fmt.Errorf("DBLP response: %w", err)
			}
			total, err = strconv.Atoi(page.Result.Hits.Total)
			if err != nil {
				return nil, fmt.Errorf("DBLP response missing valid total")
			}
			count = len(page.Result.Hits.Hits)
			for _, hit := range page.Result.Hits.Hits {
				v := hit.Info
				if v.Type != "Conference and Workshop Papers" {
					continue
				}
				if v.Year != strconv.Itoa(year) || !strings.HasPrefix(v.Key, "conf/"+metadata.RemoteID+"/") || v.Title == "" {
					return nil, fmt.Errorf("DBLP record is outside the requested conference/year or lacks a title")
				}
				authors, err := bibliographyValues(v.Authors.Author)
				if err != nil {
					return nil, err
				}
				links, err := bibliographyValues(v.EE)
				if err != nil {
					return nil, err
				}
				venues, err := bibliographyValues(v.Venue)
				if err != nil {
					return nil, err
				}
				link := v.URL
				if len(links) > 0 {
					link = links[0]
				}
				if link == "" || seen[v.Key] {
					return nil, fmt.Errorf("DBLP record has no URL or repeats identity: %s", v.Key)
				}
				seen[v.Key] = true
				rows = append(rows, map[string]any{"_id": "https://dblp.org/rec/" + v.Key, "title": v.Title, "link": link,
					"description": "", "author": strings.Join(authors, ", "), "track": bibliographyTrack(venues, metadata.Name), "venue": strings.Join(venues, ", "), "source_url": publicEndpoint})
			}
		}
		if expectedTotal >= 0 && total != expectedTotal {
			return nil, fmt.Errorf("source total changed during pagination: %d to %d", expectedTotal, total)
		}
		expectedTotal = total
		if total < 0 || offset+count > total || (count == 0 && offset < total) {
			return nil, fmt.Errorf("incomplete source pagination at %d of %d", offset, total)
		}
		offset += count
		if offset == total {
			break
		}
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("no papers returned for %s %d", conf, year)
	}
	return rows, nil
}

func publicConferenceEndpoint(endpoint *url.URL) string {
	public := *endpoint
	public.User, public.RawQuery, public.Fragment = nil, "", ""
	return public.String()
}

func (p *Pipeline) appendConferenceRecords(conf string, year int, rows []map[string]any) error {
	file := filepath.Join(p.Config.Root, "top-conf/data/conferences", fmt.Sprintf("%s_%d.jsonl", conf, year))
	existing, err := catalog.Rows(file)
	if err != nil {
		return err
	}
	known, titles := map[string]int{}, map[string]int{}
	for i, row := range existing {
		known[catalog.Str(row, "_id")] = i
		titles[catalog.NormalizeTitle(catalog.Str(row, "title"))] = i
	}
	for _, row := range rows {
		id, title := catalog.Str(row, "_id"), catalog.NormalizeTitle(catalog.Str(row, "title"))
		index, ok := known[id]
		if !ok {
			if candidate, exists := titles[title]; exists {
				old := existing[candidate]
				crossProvider := catalog.Str(old, "provider") != "" && catalog.Str(old, "provider") != catalog.Str(row, "provider")
				detail := strings.HasPrefix(catalog.Str(old, "_id"), "researchr:") && catalog.Str(row, "description_source") != ""
				if (crossProvider || detail) && catalog.Str(old, "author") == catalog.Str(row, "author") {
					index, ok = candidate, true
				}
			}
		}
		if ok {
			old := existing[index]
			// Keep stable identity and retain richer evidence when the new snapshot lacks it.
			for key, value := range row {
				if catalog.Str(row, "provider") == "researchr" && catalog.Str(old, "description_source") != "" && catalog.Str(row, "description") == "" && (key == "link" || key == "source_url") {
					continue
				}
				if key == "_id" || key == "fetched_at" {
					continue
				}
				if value == nil || catalog.Str(row, key) == "" {
					continue
				}
				if key == "authors_list" {
					b, _ := json.Marshal(value)
					if string(b) == "[]" || string(b) == "null" {
						continue
					}
				}
				old[key] = value
			}
			continue
		}
		row["source"] = catalog.Labels[conf] + " " + strconv.Itoa(year)
		row["fetched_at"] = time.Now().UTC().Format(time.RFC3339)
		known[id], titles[title] = len(existing), len(existing)
		existing = append(existing, row)
	}
	var data []byte
	for _, row := range existing {
		b, err := json.Marshal(row)
		if err != nil {
			return err
		}
		data = append(data, append(b, '\n')...)
	}
	return atomic(file, data)
}

func reviewAuthors(note reviewNote) []catalog.Scholar {
	out := []catalog.Scholar{}
	for i, name := range note.Content.Authors.Value {
		person := catalog.Scholar{Entity: catalog.Entity{Name: name}}
		if i < len(note.Content.AuthorIDs.Value) {
			id := note.Content.AuthorIDs.Value[i]
			if strings.HasPrefix(id, "~") {
				person.URL = "https://openreview.net/profile?id=" + url.QueryEscape(id)
			}
		}
		out = append(out, person)
	}
	return out
}
func bibliographyTrack(venues []string, name string) string {
	for _, venue := range venues {
		if strings.EqualFold(venue, name) {
			return "conference"
		}
		v := strings.ToLower(venue)
		if strings.Contains(v, "companion") {
			return "companion"
		}
		if strings.Contains(v, "workshop") {
			return "workshop"
		}
	}
	return "unknown"
}
