package jobs

import (
	"context"
	"fmt"
	"github.com/FastR-D/FastNews/internal/catalog"
	"golang.org/x/net/html"
	"net/url"
	"strings"
)

func researchrURLs(conf string, year int) ([]string, error) {
	if _, err := conferenceInfo(conf, year); err != nil {
		return nil, err
	}
	if (conf != "icse" && conf != "fse") || year != 2026 {
		return nil, fmt.Errorf("researchr has no verified 2026 research-track profile for %s", conf)
	}
	track := "research-papers"
	if conf == "icse" {
		track = "research-track"
	}
	return []string{fmt.Sprintf("https://conf.researchr.org/track/%s-%d/%s-%d-%s", conf, year, conf, year, track)}, nil
}

func fetchResearchr(ctx context.Context, r PaperRequest) ([]map[string]any, error) {
	var all []map[string]any
	for _, source := range r.URLs {
		body, err := get(ctx, source)
		if err != nil {
			return nil, err
		}
		rows, err := parseResearchr(body, source, r.Conference, r.Year)
		if err != nil {
			return nil, err
		}
		all = append(all, rows...)
	}
	return all, nil
}

// The accepted-papers container is deliberately separate from the mixed session
// program, which can include journal-first, industry, workshop and tutorial talks.
func parseResearchr(raw []byte, source, conf string, year int) ([]map[string]any, error) {
	doc, err := html.Parse(strings.NewReader(string(raw)))
	if err != nil {
		return nil, err
	}
	base, err := url.Parse(source)
	if err != nil {
		return nil, err
	}
	contextPath := fmt.Sprintf("/%s-%d/", conf, year)
	var overview *html.Node
	var detail bool
	walk(doc, func(n *html.Node) {
		if attr(n, "id") == "event-overview" {
			overview = n
		}
		if n.Data == "body" && attr(n, "id") == "details" {
			detail = true
		}
	})
	if detail {
		return parseResearchrDetail(doc, source, conf, year)
	}
	identity, research := false, false
	walk(doc, func(n *html.Node) {
		if hasClass(n, "page-header") {
			label := strings.ToLower(text(n))
			research = research || (strings.Contains(label, "research") && !strings.Contains(label, "workshop"))
			walk(n, func(a *html.Node) {
				if a.Data == "a" && strings.Contains(attr(a, "href"), fmt.Sprintf("/%s-%d", conf, year)) {
					identity = true
				}
			})
		}
	})
	if !identity || !research {
		return nil, fmt.Errorf("researchr page does not identify requested conference/year")
	}
	if overview == nil {
		return nil, fmt.Errorf("researchr accepted-papers list missing; conference may be unpublished or page layout changed")
	}
	// Get affiliation data from the program, keyed by the site's event ID.
	authors := map[string][]catalog.Scholar{}
	walk(doc, func(n *html.Node) {
		if n.Data != "tr" {
			return
		}
		id := ""
		walk(n, func(a *html.Node) {
			if a.Data == "a" && attr(a, "data-event-modal") != "" {
				id = attr(a, "data-event-modal")
			}
		})
		if id != "" {
			list := researchrAuthors(n, base)
			if len(list) > 0 && (len(authors[id]) == 0 || len(list[0].Affiliations) > 0) {
				authors[id] = list
			}
		}
	})
	out := []map[string]any{}
	seen := map[string]bool{}
	walk(overview, func(n *html.Node) {
		if n.Data != "tr" {
			return
		}
		id, title, link, track := "", "", "", ""
		walk(n, func(a *html.Node) {
			if a.Data == "a" && attr(a, "data-event-modal") != "" {
				id = attr(a, "data-event-modal")
				for c := a.FirstChild; c != nil; c = c.NextSibling {
					if c.Type == html.TextNode {
						title += c.Data
					}
				}
			}
			if a.Data == "div" && hasClass(a, "prog-track") {
				track = text(a)
			}
			if a.Data == "a" {
				h := attr(a, "href")
				if strings.Contains(h, "/details"+contextPath) {
					link = h
				}
			}
		})
		if id == "" || strings.TrimSpace(title) == "" || seen[id] {
			return
		}
		seen[id] = true
		if link == "" {
			link = source
		}
		names := []string{}
		for _, a := range authors[id] {
			names = append(names, a.Name)
		}
		out = append(out, map[string]any{"_id": "researchr:" + conf + fmt.Sprint(year) + ":" + id, "title": strings.TrimSpace(title), "link": link, "source_url": source, "author": strings.Join(names, ", "), "authors_list": authors[id], "description": "", "track": "main", "presentation": track})
	})
	if len(out) == 0 {
		return nil, fmt.Errorf("researchr returned no accepted papers")
	}
	return out, nil
}

func researchrAuthors(node *html.Node, base *url.URL) []catalog.Scholar {
	out := []catalog.Scholar{}
	walk(node, func(n *html.Node) {
		if !hasClass(n, "performers") {
			return
		}
		for a := n.FirstChild; a != nil; a = a.NextSibling {
			if a.Data != "a" || !strings.Contains(attr(a, "href"), "/profile/") {
				continue
			}
			person := catalog.Scholar{Entity: catalog.Entity{Name: text(a), URL: absolute(base.String(), attr(a, "href"))}}
			for next := a.NextSibling; next != nil; next = next.NextSibling {
				if next.Data == "a" {
					break
				}
				if hasClass(next, "prog-aff") {
					person.Affiliations = append(person.Affiliations, catalog.Entity{Name: text(next)})
				}
			}
			out = append(out, person)
		}
	})
	return out
}

func parseResearchrDetail(doc *html.Node, source, conf string, year int) ([]map[string]any, error) {
	title, abstract, track := "", "", ""
	people := []catalog.Scholar{}
	who := map[string]bool{}
	walk(doc, func(n *html.Node) {
		if hasClass(n, "page-header") {
			walk(n, func(v *html.Node) {
				if v.Data == "h2" {
					title = text(v)
				}
				if v.Data == "a" && strings.Contains(attr(v, "href"), fmt.Sprintf("/track/%s-%d/", conf, year)) {
					track = text(v)
				}
			})
		}
		if n.Data == "label" && n.Parent != nil {
			label := text(n)
			for v := n.NextSibling; v != nil; v = v.NextSibling {
				if label == "Abstract" {
					abstract += text(v)
				}
				if label == "Who" {
					walk(v, func(a *html.Node) {
						if a.Data == "a" {
							who[attr(a, "href")] = true
						}
					})
				}
			}
		}
	})
	if title == "" || (!strings.Contains(strings.ToLower(track), "research") || strings.Contains(strings.ToLower(track), "workshop")) {
		return nil, fmt.Errorf("researchr detail does not identify requested conference/year")
	}
	walk(doc, func(n *html.Node) {
		if n.Data != "a" || !who[attr(n, "href")] {
			return
		}
		var headings []string
		walk(n, func(v *html.Node) {
			if v.Data == "h5" {
				headings = append(headings, text(v))
			}
		})
		if len(headings) == 0 {
			return
		}
		person := catalog.Scholar{Entity: catalog.Entity{Name: headings[0], URL: attr(n, "href")}}
		if len(headings) > 1 && headings[1] != "" {
			person.Affiliations = []catalog.Entity{{Name: headings[1]}}
		}
		people = append(people, person)
	})
	names := []string{}
	for _, a := range people {
		names = append(names, a.Name)
	}
	return []map[string]any{{"_id": source, "title": title, "link": source, "source_url": source, "description": strings.TrimSpace(abstract), "description_source": source, "author": strings.Join(names, ", "), "authors_list": people, "track": "main", "presentation": track}}, nil
}
