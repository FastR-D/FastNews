package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"maps"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/FastR-D/FastNews/internal/catalog"
)

func absolute(base, ref string) string {
	if ref == "" {
		return ""
	}
	b, e := url.Parse(base)
	if e != nil {
		return ""
	}
	u, e := url.Parse(ref)
	if e != nil {
		return ""
	}
	v := b.ResolveReference(u)
	if (v.Scheme != "http" && v.Scheme != "https") || v.User != nil {
		return ""
	}
	return v.String()
}

type reportData struct {
	Title, Subtitle, Generated string
	Papers                     []catalog.Paper
	Categories                 []string
	Base                       string
}

const reportTemplate = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>{{.Title}}</title><style>body{font:14px/1.8 sans-serif;max-width:900px;margin:auto;padding:32px}h1{font-size:26px}h2{font-size:20px}h3{font-size:17px}article{margin:24px 0;break-inside:avoid}a{color:inherit;text-decoration:none}@page{size:A4;margin:18mm}</style><h1>{{.Title}}</h1>{{$papers:=.Papers}}{{range .Categories}}{{$category:=.}}<h2>{{.}}</h2>{{range $papers}}{{if eq .Category $category}}<article><h3>{{.Title}}</h3><p>{{.Author}}</p><p>{{.Summary}}</p></article>{{end}}{{end}}{{end}}</html>`

func (p *Pipeline) render(data reportData, file string, pdf bool) error {
	var content []catalog.ReportNode
	for i, category := range data.Categories {
		section := catalog.ReportNode{Tag: "section", ID: fmt.Sprintf("report-category-%d", i), Children: []catalog.ReportNode{{Tag: "h2", Children: []catalog.ReportNode{{Text: category}}}}}
		for _, paper := range data.Papers {
			if paper.Category != category {
				continue
			}
			item := catalog.ReportNode{Tag: "article", Paper: map[string]string{"id": paper.ID, "title": paper.Title, "authors": paper.Author, "summary": paper.Summary, "url": paper.Link, "venue": paper.Venue, "year": fmt.Sprint(paper.Year)}}
			item.Children = []catalog.ReportNode{{Tag: "h3", Children: []catalog.ReportNode{{Tag: "a", Href: paper.Link, Children: []catalog.ReportNode{{Text: paper.Title}}}}}, {Tag: "p", Children: []catalog.ReportNode{{Text: paper.Author}}}, {Tag: "p", Children: []catalog.ReportNode{{Text: paper.Summary}}}}
			if paper.TitleZH != "" {
				item.Children = append(item.Children, catalog.ReportNode{Tag: "p", Children: []catalog.ReportNode{{Text: paper.TitleZH}}})
			}
			section.Children = append(section.Children, item)
		}
		content = append(content, section)
	}
	b, e := json.MarshalIndent(content, "", "  ")
	if e != nil {
		return e
	}
	if e = atomic(file, b); e != nil {
		return e
	}
	if !pdf {
		return nil
	}
	t, e := template.New("print").Parse(reportTemplate)
	if e != nil {
		return e
	}
	var html bytes.Buffer
	if e = t.Execute(&html, data); e != nil {
		return e
	}
	temp, e := os.CreateTemp("", "fastnews-print-*.html")
	if e != nil {
		return e
	}
	defer os.Remove(temp.Name())
	if _, e = temp.Write(html.Bytes()); e != nil {
		temp.Close()
		return e
	}
	if e = temp.Close(); e != nil {
		return e
	}
	return PDF(context.Background(), temp.Name(), strings.TrimSuffix(file, ".json")+".pdf")
}
func PDF(ctx context.Context, html, pdf string) error {
	binary := os.Getenv("FASTNEWS_CHROME")
	if binary == "" {
		for _, candidate := range []string{"chromium", "chromium-browser", "google-chrome"} {
			if p, e := exec.LookPath(candidate); e == nil {
				binary = p
				break
			}
		}
	}
	if binary == "" {
		return fmt.Errorf("HTML generated; PDF requires Chromium (set FASTNEWS_CHROME)")
	}
	absolute, e := filepath.Abs(html)
	if e != nil {
		return e
	}
	target, e := filepath.Abs(pdf)
	if e != nil {
		return e
	}
	profile, e := os.MkdirTemp("", "fastnews-print-*")
	if e != nil {
		return e
	}
	defer os.RemoveAll(profile)
	deadline, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(deadline, binary, "--headless", "--disable-gpu", "--no-pdf-header-footer", "--user-data-dir="+profile, "--print-to-pdf="+target, (&url.URL{Scheme: "file", Path: absolute}).String())
	if e = cmd.Run(); e != nil {
		return fmt.Errorf("Chromium PDF export: %w", e)
	}
	_, e = os.Stat(target)
	return e
}
func (p *Pipeline) ConferenceReport(conf string, year int, pdf bool) error {
	if _, e := conferenceInfo(conf, year); e != nil {
		return e
	}
	papers, e := p.Catalog.Papers()
	if e != nil {
		return e
	}
	out := []catalog.Paper{}
	categories := map[string]bool{}
	for _, v := range papers {
		if v.Source == "top-conf" && v.Conference == conf && v.Year == year {
			out = append(out, v)
			categories[v.Category] = true
		}
	}
	if len(out) == 0 {
		return fmt.Errorf("no summarized papers")
	}
	cats := []string{}
	for c := range categories {
		cats = append(cats, c)
	}
	sort.Strings(cats)
	filename := strings.ToUpper(conf) + fmt.Sprintf("_%d_Report.json", year)
	return p.render(reportData{Title: fmt.Sprintf("%s %d", catalog.Labels[conf], year), Subtitle: "顶会论文分类与中文深度摘要", Generated: time.Now().UTC().Format(time.RFC3339), Papers: out, Categories: cats, Base: p.Config.PublicPath}, filepath.Join(p.Config.Root, "top-conf/data/report", filename), pdf)
}
func (p *Pipeline) Weekly(days int, pdf bool) error {
	dates, e := p.Catalog.Dates()
	if e != nil {
		return e
	}
	if len(dates) == 0 {
		return fmt.Errorf("no news articles")
	}
	latest, e := time.Parse("2006-01-02", dates[0])
	if e != nil {
		return e
	}
	cutoff := latest.AddDate(0, 0, -max(1, days)+1).Format("2006-01-02")
	papers := []catalog.Paper{}
	seen := map[string]bool{}
	cats := map[string]bool{}
	for _, day := range dates {
		if day < cutoff {
			continue
		}
		rows, e := p.Catalog.News(day)
		if e != nil {
			return e
		}
		if raw, err := os.ReadFile(filepath.Join(p.Config.Root, "secnews/data/newspapers", day+".json")); err == nil {
			var newspaper struct {
				Articles map[string][]map[string]any `json:"articles"`
			}
			if err = json.Unmarshal(raw, &newspaper); err != nil {
				return err
			}
			rows = []map[string]any{}
			for _, source := range slices.Sorted(maps.Keys(newspaper.Articles)) {
				rows = append(rows, newspaper.Articles[source]...)
			}
		}
		for _, v := range rows {
			id := catalog.First(catalog.Str(v, "_id"), catalog.Str(v, "link"))
			if seen[id] {
				continue
			}
			seen[id] = true
			source := catalog.Str(v, "source")
			category := catalog.NewsChannelName(catalog.NewsChannel(v))
			cats[category] = true
			papers = append(papers, catalog.Paper{ID: id, Title: catalog.Str(v, "title"), TitleZH: catalog.Str(v, "title_zh"), Link: catalog.Str(v, "link"), Summary: catalog.First(catalog.Str(v, "summary_zh"), catalog.Str(v, "intro"), catalog.Str(v, "description")), Author: catalog.Str(v, "author"), Category: category, Venue: source, Date: day})
		}
	}
	categories := []string{}
	for c := range cats {
		categories = append(categories, c)
	}
	sort.Strings(categories)
	filename := fmt.Sprintf("%d.%d.%d-report.json", latest.Year(), latest.Month(), (latest.Day()-1)/7+1)
	data := reportData{Title: "新闻、安全与 AI 资讯周报 · " + dates[0], Subtitle: cutoff + " 至 " + dates[0], Generated: time.Now().UTC().Format(time.RFC3339), Papers: papers, Categories: categories, Base: p.Config.PublicPath}
	file := filepath.Join(p.Config.Root, "secnews/data/report", filename)
	if e = p.render(data, file, pdf); e != nil {
		return e
	}
	b, e := os.ReadFile(file)
	if e != nil {
		return e
	}
	if e = atomic(filepath.Join(p.Config.Root, "output", filename), b); e != nil {
		return e
	}
	if pdf {
		b, e = os.ReadFile(strings.TrimSuffix(file, ".json") + ".pdf")
		if e != nil {
			return e
		}
		return atomic(filepath.Join(p.Config.Root, "output", strings.TrimSuffix(filename, ".json")+".pdf"), b)
	}
	return nil
}
