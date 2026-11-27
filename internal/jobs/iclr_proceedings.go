package jobs

import (
	"context"
	"fmt"
	"golang.org/x/net/html"
	"net/url"
	"strings"
)

func iclrProceedingsURLs(conf string, year int) ([]string, error) {
	if conf != "iclr" || year < 2024 || year > 2026 {
		return nil, fmt.Errorf("ICLR official proceedings verified for 2024–2026 only")
	}
	return []string{fmt.Sprintf("https://proceedings.iclr.cc/paper_files/paper/%d", year)}, nil
}
func iclrPaperURL(raw string, year int) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	if year < 2024 || year > 2026 || u.Scheme != "https" || u.Host != "proceedings.iclr.cc" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !strings.HasPrefix(u.Path, fmt.Sprintf("/paper_files/paper/%d/hash/", year)) || !strings.HasSuffix(u.Path, "-Abstract-Conference.html") {
		return nil, fmt.Errorf("invalid ICLR main-track paper identity")
	}
	return u, nil
}
func fetchICLRProceedings(ctx context.Context, r PaperRequest) ([]map[string]any, error) {
	canonical, err := iclrProceedingsURLs(r.Conference, r.Year)
	if err != nil {
		return nil, err
	}
	raw, err := get(ctx, r.URLs[0])
	if err != nil {
		return nil, err
	}
	doc, err := html.Parse(strings.NewReader(string(raw)))
	if err != nil {
		return nil, err
	}
	rows, err := indexedProceedingsRecords(doc, canonical[0], r.Year, iclrPaperURL)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		row["source_url"] = canonical[0]
	}
	return rows, nil
}
func iclrAbstract(raw []byte, link *url.URL, year int) (string, error) {
	doc, err := html.Parse(strings.NewReader(string(raw)))
	if err != nil {
		return "", err
	}
	matched, title, abstract := false, "", ""
	walk(doc, func(n *html.Node) {
		if n.Data == "a" && attr(n, "href") == fmt.Sprintf("/paper_files/paper/%d", year) {
			matched = true
		}
		if n.Data == "meta" && attr(n, "name") == "citation_title" {
			title = attr(n, "content")
		}
		if n.Data == "h1" && title == "" {
			title = text(n)
		}
		if n.Data == "section" && hasClass(n, "paper-section") {
			marked := false
			walk(n, func(child *html.Node) {
				if hasClass(child, "paper-abstract") {
					marked = true
				}
			})
			if marked {
				for child := n.FirstChild; child != nil; child = child.NextSibling {
					if hasClass(child, "section-label") {
						continue
					}
					abstract += text(child) + " "
				}
				abstract = strings.TrimSpace(abstract)
			}
		}
	})
	if title == "" || !matched || abstract == "" {
		return "", fmt.Errorf("ICLR abstract metadata incomplete: title=%t year=%t abstract=%t (%s)", title != "", matched, abstract != "", link.Path)
	}
	return abstract, nil
}
