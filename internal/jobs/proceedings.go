package jobs

import (
	"context"
	"encoding/xml"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

// These publisher volumes were checked against the official 2024/2025 indexes.
var pmlrVolumes = map[int]string{2024: "235", 2025: "267"}
var neuripsVolumes = map[int]struct{ URL, CitationVolume string }{
	2024: {"https://papers.nips.cc/paper_files/paper/2024", "37"},
	2025: {"https://papers.nips.cc/paper_files/paper/2025/vol38-main-conference", "38"},
}

func proceedingsURL(conf string, year int) (string, error) {
	if conf == "icml" && pmlrVolumes[year] != "" {
		return "https://proceedings.mlr.press/v" + pmlrVolumes[year] + "/", nil
	}
	if conf == "neurips" && neuripsVolumes[year].URL != "" {
		return neuripsVolumes[year].URL, nil
	}
	return "", fmt.Errorf("official %s proceedings profile is not verified for %d; supported years: 2024, 2025", conf, year)
}

func hasClass(n *html.Node, class string) bool {
	for _, value := range strings.Fields(attr(n, "class")) {
		if value == class {
			return true
		}
	}
	return false
}

func (p *Pipeline) fetchProceedings(ctx context.Context, conf string, year int, source string) error {
	canonical, err := proceedingsURL(conf, year)
	if err != nil {
		return err
	}
	raw, err := get(ctx, source)
	if err != nil {
		return err
	}
	doc, err := html.Parse(strings.NewReader(string(raw)))
	if err != nil {
		return err
	}
	var rows []map[string]any
	if conf == "icml" {
		rows, err = pmlrRecords(ctx, doc, source, canonical)
	} else {
		rows, err = neuripsRecords(doc, canonical, year)
	}
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return fmt.Errorf("no papers parsed from official %s proceedings", conf)
	}
	u, err := url.Parse(source)
	if err != nil {
		return err
	}
	for _, row := range rows {
		row["source_url"] = publicConferenceEndpoint(u)
	}
	return p.appendConferenceRecords(conf, year, rows)
}

func pmlrRecords(ctx context.Context, doc *html.Node, source, canonical string) ([]map[string]any, error) {
	declared := ""
	blocks := []*html.Node{}
	walk(doc, func(n *html.Node) {
		if n.Type != html.ElementNode {
			return
		}
		if n.Data == "meta" && attr(n, "property") == "og:url" {
			declared = attr(n, "content")
		}
		if n.Data == "div" && hasClass(n, "paper") {
			blocks = append(blocks, n)
		}
	})
	if declared != canonical || len(blocks) == 0 {
		return nil, fmt.Errorf("PMLR index does not declare the expected volume %s", canonical)
	}
	base, _ := url.Parse(canonical)
	rows := []map[string]any{}
	byLink := map[string]map[string]any{}
	identities := map[string]bool{}
	for _, block := range blocks {
		title, authors, link, review := "", "", "", ""
		walk(block, func(n *html.Node) {
			if n.Type != html.ElementNode {
				return
			}
			if hasClass(n, "title") {
				title = text(n)
			}
			if hasClass(n, "authors") {
				authors = text(n)
			}
			if n.Data != "a" {
				return
			}
			u, err := url.Parse(absolute(canonical, attr(n, "href")))
			if err != nil || u.User != nil {
				return
			}
			if u.Scheme == "https" && u.Host == base.Host && strings.HasPrefix(u.Path, base.Path) && strings.HasSuffix(u.Path, ".html") {
				link = u.String()
			}
			if u.Scheme == "https" && u.Host == "openreview.net" && u.Path == "/forum" && u.Query().Get("id") != "" {
				review = "https://openreview.net/forum?" + url.Values{"id": {u.Query().Get("id")}}.Encode()
			}
		})
		id := link
		if review != "" {
			id = review
		}
		if title == "" || authors == "" || link == "" || byLink[link] != nil || identities[id] {
			return nil, fmt.Errorf("PMLR paper has missing or repeated identity/title/authors")
		}
		row := map[string]any{"_id": id, "title": title, "author": authors, "link": link, "description": ""}
		rows = append(rows, row)
		byLink[link] = row
		identities[id] = true
	}
	u, err := url.Parse(source)
	if err != nil {
		return nil, err
	}
	feedURL := u.ResolveReference(&url.URL{Path: "assets/rss/feed.xml"}).String()
	raw, err := get(ctx, feedURL)
	if err != nil {
		return nil, err
	}
	var feed Feed
	if err := xml.Unmarshal(raw, &feed); err != nil {
		return nil, err
	}
	if feed.XMLName.Local != "rss" || len(feed.Channel.Items) != len(rows) {
		return nil, fmt.Errorf("PMLR index/RSS paper counts disagree")
	}
	seen := map[string]bool{}
	for _, item := range feed.Channel.Items {
		link := ""
		for _, l := range item.Links {
			if l.Rel == "" || l.Rel == "alternate" {
				link = l.Text
				break
			}
		}
		row := byLink[link]
		if row == nil || seen[link] {
			return nil, fmt.Errorf("PMLR RSS identity is missing from or repeated against index: %s", link)
		}
		seen[link] = true
		row["description"] = item.Description
		if item.PubDate != "" {
			row["published"] = item.PubDate
		}
	}
	return rows, nil
}

func neuripsRecords(doc *html.Node, canonical string, year int) ([]map[string]any, error) {
	declared := -1
	listed := 0
	rows := []map[string]any{}
	seen := map[string]bool{}
	var invalid error
	walk(doc, func(n *html.Node) {
		if invalid != nil || n.Type != html.ElementNode {
			return
		}
		if hasClass(n, "paper-count") {
			parts := strings.Fields(text(n))
			if len(parts) > 0 {
				value, err := strconv.Atoi(parts[0])
				if err == nil {
					declared = value
				}
			}
		}
		if n.Data != "li" || n.Parent == nil || !hasClass(n.Parent, "paper-list") {
			return
		}
		listed++
		if attr(n, "data-track") != "conference" {
			return
		}
		title, authors, link := "", "", ""
		walk(n, func(child *html.Node) {
			if child.Type != html.ElementNode {
				return
			}
			if hasClass(child, "paper-authors") {
				authors = text(child)
			}
			if child.Data == "a" && attr(child, "title") == "paper title" {
				title = text(child)
				link = absolute(canonical, attr(child, "href"))
			}
		})
		_, err := neuripsPaperURL(link, year)
		if err != nil || title == "" || authors == "" || seen[link] {
			invalid = fmt.Errorf("NeurIPS paper lacks valid main-track identity/title/authors for %d", year)
			return
		}
		seen[link] = true
		rows = append(rows, map[string]any{"_id": link, "title": title, "author": authors, "link": link, "description": "", "track": "conference"})
	})
	if invalid != nil {
		return nil, invalid
	}
	if declared < 0 || declared != listed {
		return nil, fmt.Errorf("NeurIPS declared/listed paper counts disagree: %d / %d", declared, listed)
	}
	return rows, nil
}
