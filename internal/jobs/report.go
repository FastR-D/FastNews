package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
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

const reportTemplate = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{{.Title}} · FastNews</title><style>
:root{color-scheme:light dark;--page:#f7f8fa;--surface:#fff;--text:#151c28;--muted:#687384;--border:#dfe3e8;--primary:#155fb8}@media(prefers-color-scheme:dark){:root{--page:#151b24;--surface:#171e27;--text:#f4f7fa;--muted:#9aa8b9;--border:#2a3543;--primary:#75b1f7}}*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--text);font:500 14px/1.8 "IBM Plex Sans","Noto Sans SC",system-ui,sans-serif}.shell{max-width:1040px;margin:auto;padding:32px 24px}header{border-bottom:1px solid var(--border);padding-bottom:28px}header small{color:var(--primary);letter-spacing:2px}h1{font-size:30px;margin:8px 0}h2{font-size:18px}h3{font-size:15px}p{margin:8px 0;color:var(--muted)}a{color:var(--primary);text-decoration:none}a:hover{text-decoration:underline}nav{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0}nav a,.button{padding:4px 10px;border:1px solid var(--border);border-radius:4px;font:inherit;cursor:pointer;background:var(--surface);color:var(--primary)}section{margin-top:28px}article{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--primary);border-radius:6px;padding:18px 22px;margin:12px 0;break-inside:avoid}article h3{margin:0}.meta{font-size:12px}footer{margin-top:32px;color:var(--muted);font-size:12px}input{font:inherit;padding:8px 12px;width:100%;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:4px}@media print{body{background:white;color:black}.no-print{display:none}.shell{padding:0}article{box-shadow:none}a{color:inherit}.meta{color:#555}section{break-inside:auto}}@media(max-width:600px){.shell{padding:20px 14px}h1{font-size:23px}}
</style></head><body><main class="shell"><header><small>FASTNEWS · RESEARCH BRIEFINGS</small><h1>{{.Title}}</h1><p>{{.Subtitle}}</p><p class="meta">{{len .Papers}} 篇 · {{.Generated}}</p><a class="no-print" href="{{.Base}}/">返回 FastNews 工作台</a></header><nav class="no-print">{{range .Categories}}<a href="#{{.}}">{{.}}</a>{{end}}</nav><input class="no-print" type="search" id="search" placeholder="搜索标题、作者与摘要" aria-label="搜索报告论文">{{$papers:=.Papers}}{{range .Categories}}{{$category:=.}}<section id="{{.}}"><h2>{{.}}</h2>{{range $papers}}{{if eq .Category $category}}<article><h3><a href="{{.Link}}" target="_blank" rel="noreferrer">{{.Title}}</a>{{if .Award}} · 杰出论文{{end}}</h3>{{if .TitleZH}}<p>{{.TitleZH}}</p>{{end}}<p>{{.Summary}}</p><p class="meta">{{.Author}} · {{.Venue}} {{.Year}}{{if .CitedBy}} · 引用 {{.CitedBy}}{{end}}</p><button class="button no-print" data-fastread data-fastread-title="{{.Title}}" data-fastread-authors="{{.Author}}" data-fastread-abstract="{{.Summary}}" data-fastread-url="{{.Link}}" data-fastread-venue="{{.Venue}}" data-fastread-year="{{.Year}}">跳转 FastRead</button></article>{{end}}{{end}}</section>{{end}}<footer>FastNews · 仅基于本地语料。未提供的引用、奖项或实验数据不会补造。</footer></main><script>document.getElementById('search').addEventListener('input',function(){var q=this.value.toLowerCase();document.querySelectorAll('article').forEach(function(a){a.hidden=!a.textContent.toLowerCase().includes(q)})})</script><script src="{{.Base}}/reports/handoff.js"></script></body></html>`

func (p *Pipeline) render(data reportData, file string, pdf bool) error {
	t, e := template.New("report").Parse(reportTemplate)
	if e != nil {
		return e
	}
	var b bytes.Buffer
	if e = t.Execute(&b, data); e != nil {
		return e
	}
	if e = atomic(file, b.Bytes()); e != nil {
		return e
	}
	if pdf {
		return PDF(context.Background(), file, strings.TrimSuffix(file, ".html")+".pdf")
	}
	return nil
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
	if _, e := ConferenceURLs(conf, year); e != nil {
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
	filename := map[string]string{"usenix": "USENIX", "ieee-sp": "IEEE-SP", "ndss": "NDSS", "ccs": "CCS"}[conf] + fmt.Sprintf("_%d_Report.html", year)
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
			for _, source := range []string{"bleepingcomputer", "arxiv_cs_cr", "arxiv_cs_ai"} {
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
			category := "安全资讯"
			if strings.Contains(source, "cs_ai") || strings.Contains(source, "cs.ai") {
				category = "AI 研究"
			}
			cats[category] = true
			papers = append(papers, catalog.Paper{ID: id, Title: catalog.Str(v, "title"), TitleZH: catalog.Str(v, "title_zh"), Link: catalog.Str(v, "link"), Summary: catalog.First(catalog.Str(v, "summary_zh"), catalog.Str(v, "intro"), catalog.Str(v, "description")), Author: catalog.Str(v, "author"), Category: category, Venue: source, Date: day})
		}
	}
	categories := []string{}
	for c := range cats {
		categories = append(categories, c)
	}
	sort.Strings(categories)
	filename := fmt.Sprintf("%d.%d.%d-report.html", latest.Year(), latest.Month(), (latest.Day()-1)/7+1)
	data := reportData{Title: "安全资讯周报 · " + dates[0], Subtitle: cutoff + " 至 " + dates[0], Generated: time.Now().UTC().Format(time.RFC3339), Papers: papers, Categories: categories, Base: p.Config.PublicPath}
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
		b, e = os.ReadFile(strings.TrimSuffix(file, ".html") + ".pdf")
		if e != nil {
			return e
		}
		return atomic(filepath.Join(p.Config.Root, "output", strings.TrimSuffix(filename, ".html")+".pdf"), b)
	}
	return nil
}
