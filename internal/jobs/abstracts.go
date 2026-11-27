package jobs

import (
	"context"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"

	"github.com/FastR-D/FastNews/internal/catalog"
	"golang.org/x/net/html"
)

func neuripsPaperURL(raw string, year int) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	if neuripsVolumes[year].URL == "" || u.Scheme != "https" || u.Host != "papers.nips.cc" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !strings.HasPrefix(u.Path, fmt.Sprintf("/paper_files/paper/%d/hash/", year)) || !strings.HasSuffix(u.Path, "-Abstract-Conference.html") {
		return nil, fmt.Errorf("not a verified NeurIPS main-track paper URL for %d", year)
	}
	return u, nil
}

func (p *Pipeline) EnrichConferenceAbstracts(ctx context.Context, conf string, year, limit int) error {
	metadata, err := conferenceInfo(conf, year)
	if err != nil {
		return err
	}
	if metadata.Provider != "neurips-proceedings" && conf != "iclr" {
		return fmt.Errorf("abstract enrichment is supported for official NeurIPS and ICLR proceedings")
	}
	if limit < 0 {
		return fmt.Errorf("abstract limit must be nonnegative")
	}
	rows, err := p.Catalog.ConferenceRows(conf, year)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return fmt.Errorf("no papers; run fetch-conf first")
	}
	completed := 0
	for _, paper := range rows {
		if catalog.Str(paper, "description") != "" {
			continue
		}
		if p.Topic != "" {
			candidate := catalog.Paper{Title: catalog.Str(paper, "title")}
			catalog.DecoratePaper(&candidate, paper)
			if !catalog.HasTopic(candidate, p.Topic) {
				continue
			}
		}
		if limit > 0 && completed >= limit {
			break
		}
		validate := neuripsPaperURL
		parse := neuripsAbstract
		if conf == "iclr" {
			validate = iclrPaperURL
			parse = iclrAbstract
		}
		link, err := validate(catalog.Str(paper, "link"), year)
		if err != nil {
			return err
		}
		if catalog.Str(paper, "_id") == "" {
			return fmt.Errorf("paper identity is missing")
		}
		body, err := get(ctx, link.String())
		if err != nil {
			return err
		}
		abstract, err := parse(body, link, year)
		if err != nil {
			return err
		}
		record := map[string]any{"_id": paper["_id"], "description": abstract, "description_source": link.String()}
		file := filepath.Join(p.Config.Root, "top-conf/data/abstracts", fmt.Sprintf("%s_%d.jsonl", conf, year))
		if err := appendRows(file, []map[string]any{record}); err != nil {
			return err
		}
		p.Catalog.Invalidate()
		completed++
	}
	return nil
}

func neuripsAbstract(raw []byte, link *url.URL, year int) (string, error) {
	doc, err := html.Parse(strings.NewReader(string(raw)))
	if err != nil {
		return "", err
	}
	meta := map[string]string{}
	sections := []*html.Node{}
	walk(doc, func(n *html.Node) {
		if n.Type != html.ElementNode {
			return
		}
		if n.Data == "meta" {
			meta[attr(n, "name")] = attr(n, "content")
		}
		if n.Data == "section" && hasClass(n, "paper-section") {
			marked := false
			walk(n, func(child *html.Node) {
				if child.Type == html.ElementNode && hasClass(child, "paper-abstract") {
					marked = true
				}
			})
			if marked {
				sections = append(sections, n)
			}
		}
	})
	expected := strings.Replace(strings.TrimSuffix(link.Path, "-Abstract-Conference.html"), "/hash/", "/file/", 1) + "-Paper-Conference.pdf"
	pdf, err := url.Parse(meta["citation_pdf_url"])
	if err != nil {
		return "", err
	}
	if meta["citation_title"] == "" || meta["citation_volume"] != neuripsVolumes[year].CitationVolume || pdf.Scheme != "https" || pdf.User != nil || pdf.RawQuery != "" || pdf.Fragment != "" || (pdf.Host != "proceedings.neurips.cc" && pdf.Host != "papers.nips.cc" && pdf.Host != "papers.neurips.cc") || pdf.Path != expected {
		return "", fmt.Errorf("NeurIPS citation volume/PDF identity does not match the requested paper")
	}
	if len(sections) != 1 {
		return "", fmt.Errorf("NeurIPS page must declare one abstract section")
	}
	var content strings.Builder
	for child := sections[0].FirstChild; child != nil; child = child.NextSibling {
		if child.Type == html.ElementNode && hasClass(child, "section-label") {
			continue
		}
		content.WriteString(text(child))
		content.WriteByte(' ')
	}
	abstract := strings.Join(strings.Fields(content.String()), " ")
	if abstract == "" {
		return "", fmt.Errorf("NeurIPS abstract section is empty")
	}
	return abstract, nil
}
