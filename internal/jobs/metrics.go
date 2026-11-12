package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/FastR-D/FastNews/internal/catalog"
	"golang.org/x/net/html"
)

var paperNumber = regexp.MustCompile(`(?i)\s*\(paper\s+\d+\)\s*`)

func ParseAwards(raw []byte, source, conf string, year int) ([]map[string]any, error) {
	doc, e := html.Parse(strings.NewReader(string(raw)))
	if e != nil {
		return nil, e
	}
	out := []map[string]any{}
	active := false
	seen := map[string]bool{}
	walk(doc, func(n *html.Node) {
		if n.Type != html.ElementNode {
			return
		}
		t := strings.ToLower(text(n))
		if n.Data == "h1" || n.Data == "h2" || n.Data == "h3" {
			active = (strings.Contains(t, "distinguished paper") || strings.Contains(t, "best paper")) && !strings.Contains(t, "artifact") && !strings.Contains(t, "poster")
			return
		}
		if !active {
			return
		}
		candidate := ""
		if n.Data == "li" || n.Data == "p" {
			for child := n.FirstChild; child != nil; child = child.NextSibling {
				if child.Type == html.TextNode {
					candidate += child.Data
				} else if child.Data == "b" || child.Data == "strong" || child.Data == "a" {
					candidate += text(child)
				} else if candidate != "" {
					break
				}
			}
		}
		candidate = strings.TrimSpace(paperNumber.ReplaceAllString(candidate, ""))
		if len(candidate) < 8 || len(candidate) > 600 || seen[catalog.NormalizeTitle(candidate)] {
			return
		}
		seen[catalog.NormalizeTitle(candidate)] = true
		out = append(out, map[string]any{"conference": conf, "year": year, "title": candidate, "award": "Distinguished Paper", "source": source})
	})
	return out, nil
}
func (p *Pipeline) Awards(ctx context.Context, conf string, year int, rawURL string) error {
	if _, e := ConferenceURLs(conf, year); e != nil {
		return e
	}
	if rawURL == "" {
		switch conf {
		case "usenix":
			rawURL = fmt.Sprintf("https://www.usenix.org/conference/usenixsecurity%02d/technical-sessions", year%100)
		case "ieee-sp":
			rawURL = fmt.Sprintf("https://sp%d.ieee-security.org/awards.html", year)
		case "ndss":
			rawURL = fmt.Sprintf("https://www.ndss-symposium.org/ndss%d/awards/", year)
		case "ccs":
			rawURL = fmt.Sprintf("https://www.sigsac.org/ccs/CCS%d/awards.html", year)
		}
	}
	b, e := get(ctx, rawURL)
	if e != nil {
		return e
	}
	papers, e := ParseAwards(b, rawURL, conf, year)
	if e != nil {
		return e
	}
	if len(papers) == 0 {
		return fmt.Errorf("no distinguished papers parsed; check --url")
	}
	file := filepath.Join(p.Config.Root, "top-conf/data/awards.json")
	var previous struct {
		Papers []map[string]any `json:"papers"`
	}
	if b, e := os.ReadFile(file); e == nil {
		if e = json.Unmarshal(b, &previous); e != nil {
			return e
		}
	}
	out := []map[string]any{}
	for _, v := range previous.Papers {
		if catalog.Str(v, "conference") != conf || catalog.Str(v, "year") != fmt.Sprint(year) {
			out = append(out, v)
		}
	}
	out = append(out, papers...)
	return writeJSON(file, map[string]any{"generated_at": time.Now().UTC().Format(time.RFC3339), "papers": out})
}
func (p *Pipeline) Metrics(ctx context.Context, conf string, year int, limit int) error {
	if _, e := ConferenceURLs(conf, year); e != nil {
		return e
	}
	file := filepath.Join(p.Config.Root, "top-conf/data/conferences", fmt.Sprintf("%s_%d.jsonl", conf, year))
	papers, e := catalog.Rows(file)
	if e != nil {
		return e
	}
	n := 0
	for _, paper := range papers {
		if _, ok := paper["cited_by"]; ok {
			continue
		}
		if n >= limit && limit > 0 {
			break
		}
		endpoint := "https://api.openalex.org/works?search=" + url.QueryEscape(catalog.Str(paper, "title")) + "&per-page=3"
		b, e := get(ctx, endpoint)
		if e != nil {
			return e
		}
		var result struct {
			Results []struct {
				ID    string `json:"id"`
				Title string `json:"title"`
				Cited int    `json:"cited_by_count"`
				DOI   string `json:"doi"`
			} `json:"results"`
		}
		if e = json.Unmarshal(b, &result); e != nil {
			return e
		}
		for _, hit := range result.Results {
			if catalog.NormalizeTitle(hit.Title) == catalog.NormalizeTitle(catalog.Str(paper, "title")) {
				paper["cited_by"] = hit.Cited
				paper["openalex_id"] = hit.ID
				paper["doi"] = strings.TrimPrefix(hit.DOI, "https://doi.org/")
				paper["metrics_updated_at"] = time.Now().UTC().Format(time.RFC3339)
				break
			}
		}
		n++
		var out bytes.Buffer
		enc := json.NewEncoder(&out)
		enc.SetEscapeHTML(false)
		for _, row := range papers {
			if e = enc.Encode(row); e != nil {
				return e
			}
		}
		if e = atomic(file, out.Bytes()); e != nil {
			return e
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(150 * time.Millisecond):
		}
	}
	return nil
}
