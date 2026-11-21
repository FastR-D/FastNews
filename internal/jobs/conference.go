package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/FastR-D/FastNews/internal/catalog"
	"golang.org/x/net/html"
)

func conferenceInfo(conf string, year int) (catalog.Conference, error) {
	metadata, ok := catalog.Conferences[conf]
	if !ok {
		return metadata, fmt.Errorf("unknown conference %q", conf)
	}
	if year < 2000 || year > 2100 {
		return metadata, fmt.Errorf("invalid conference year")
	}
	return metadata, nil
}

func ConferenceURLs(conf string, year int) ([]string, error) {
	metadata, err := conferenceInfo(conf, year)
	if err != nil {
		return nil, err
	}
	if metadata.Provider == "pmlr" || metadata.Provider == "neurips-proceedings" {
		source, err := proceedingsURL(conf, year)
		if err != nil {
			return nil, err
		}
		return []string{source}, nil
	}
	if metadata.Provider == "openreview" {
		query := url.Values{"content.venueid": {fmt.Sprintf("%s/%d/Conference", metadata.RemoteID, year)}}
		return []string{"https://api2.openreview.net/notes?" + query.Encode()}, nil
	}
	if metadata.Provider == "dblp" {
		query := url.Values{"q": {fmt.Sprintf("stream:conf/%s: year:%d:", metadata.RemoteID, year)}, "format": {"json"}}
		return []string{"https://dblp.org/search/publ/api?" + query.Encode()}, nil
	}
	switch conf {
	case "usenix":
		base := fmt.Sprintf("https://www.usenix.org/conference/usenixsecurity%02d/", year%100)
		out := []string{}
		for _, p := range []string{"technical-sessions", "accepted-papers", "winter-accepted-papers", "summer-accepted-papers", "fall-accepted-papers", "cycle1-accepted-papers", "cycle2-accepted-papers", "cycle3-accepted-papers"} {
			out = append(out, base+p)
		}
		return out, nil
	case "ieee-sp":
		return []string{fmt.Sprintf("https://sp%d.ieee-security.org/accepted-papers.html", year), fmt.Sprintf("https://www.ieee-security.org/TC/SP%d/program-papers.html", year), fmt.Sprintf("https://www.ieee-security.org/TC/SP%d/accepted-papers.html", year)}, nil
	case "ndss":
		return []string{fmt.Sprintf("https://www.ndss-symposium.org/ndss%d/accepted-papers/", year), fmt.Sprintf("https://www.ndss-symposium.org/ndss-%d/accepted-papers/", year)}, nil
	case "ccs":
		base := fmt.Sprintf("https://www.sigsac.org/ccs/CCS%d/", year)
		return []string{base + "program/accepted-papers.html", base + "accepted-papers.html", base + "program.html", base + "index.html"}, nil
	}
	return nil, fmt.Errorf("unknown conference")
}
func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}
func text(n *html.Node) string {
	if n == nil {
		return ""
	}
	if n.Type == html.TextNode {
		return n.Data + " "
	}
	if n.Type == html.ElementNode && (n.Data == "script" || n.Data == "style") {
		return ""
	}
	s := ""
	for child := n.FirstChild; child != nil; child = child.NextSibling {
		s += text(child)
	}
	return strings.Join(strings.Fields(s), " ")
}
func walk(n *html.Node, fn func(*html.Node)) {
	fn(n)
	for child := n.FirstChild; child != nil; child = child.NextSibling {
		walk(child, fn)
	}
}

var skip = regexp.MustCompile(`(?i)^(accepted papers|technical sessions|session |keynote|welcome|program|proceedings|registration|available media|view |download |paper pdf|presentation slides|artifact |poster:)`)

func ParseConference(raw []byte, base, conf string, year int) ([]map[string]any, error) {
	doc, e := html.Parse(strings.NewReader(string(raw)))
	if e != nil {
		return nil, e
	}
	out := []map[string]any{}
	seen := map[string]bool{}
	walk(doc, func(n *html.Node) {
		if n.Type != html.ElementNode {
			return
		}
		cls := attr(n, "class")
		href := attr(n, "href")
		titleNode := false
		switch conf {
		case "usenix":
			titleNode = n.Data == "a" && strings.Contains(href, "/presentation/")
		case "ndss":
			titleNode = n.Data == "a" && strings.Contains(href, "/ndss-paper/")
		default:
			titleNode = n.Data == "h3" || n.Data == "h4" || (n.Data == "strong" && strings.Contains(strings.ToLower(attr(n.Parent, "class")), "paper")) || (n.Data == "span" && strings.Contains(strings.ToLower(cls), "paper-title")) || (n.Data == "div" && strings.Contains(strings.ToLower(cls), "paper-title"))
		}
		if !titleNode {
			return
		}
		title := text(n)
		if len(title) < 8 || len(title) > 700 || skip.MatchString(title) {
			return
		}
		key := catalog.NormalizeTitle(title)
		if seen[key] {
			return
		}
		seen[key] = true
		block := n.Parent
		if block != nil && len(text(block)) < len(title)+20 {
			block = block.Parent
		}
		authors, abstract := "", ""
		if block != nil {
			walk(block, func(v *html.Node) {
				if v.Type != html.ElementNode {
					return
				}
				c := strings.ToLower(attr(v, "class"))
				if strings.Contains(c, "author") || strings.Contains(c, "presenter") {
					if authors == "" {
						authors = text(v)
					}
				}
				if strings.Contains(c, "abstract") || strings.Contains(c, "description") {
					if abstract == "" {
						abstract = text(v)
					}
				}
				if href == "" && v.Data == "a" {
					h := attr(v, "href")
					if strings.Contains(h, "doi.org/") || strings.Contains(h, "/presentation/") || strings.Contains(h, "/ndss-paper/") {
						href = h
					}
				}
			})
			if authors == "" {
				for next := n.NextSibling; next != nil; next = next.NextSibling {
					if next.Type == html.TextNode && strings.TrimSpace(next.Data) == "" {
						continue
					}
					v := text(next)
					if len(v) > 4 && !skip.MatchString(v) {
						authors = catalog.Clip(v, 1000)
						break
					}
				}
			}
		}
		link := absolute(base, href)
		if link == "" {
			link = base + "#" + strings.ReplaceAll(key, " ", "-")
		}
		out = append(out, map[string]any{"_id": link, "title": title, "link": link, "description": abstract, "author": authors, "source": catalog.Labels[conf] + " " + strconv.Itoa(year), "published": fmt.Sprintf("%d-01-01T00:00:00Z", year), "fetched_at": time.Now().UTC().Format(time.RFC3339)})
	})
	return out, nil
}
func (p *Pipeline) FetchConference(ctx context.Context, conf string, year int, override string) error {
	urls, err := ConferenceURLs(conf, year)
	if err != nil {
		return err
	}
	if provider := catalog.Conferences[conf].Provider; provider == "pmlr" || provider == "neurips-proceedings" {
		return p.fetchProceedings(ctx, conf, year, catalog.First(override, urls[0]))
	}
	if catalog.Conferences[conf].Provider != "html" {
		return p.fetchStructuredConference(ctx, conf, year, catalog.First(override, urls[0]))
	}
	if override != "" {
		urls = []string{override}
	}
	file := filepath.Join(p.Config.Root, "top-conf/data/conferences", fmt.Sprintf("%s_%d.jsonl", conf, year))
	existing, err := catalog.Rows(file)
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, row := range existing {
		seen[catalog.NormalizeTitle(catalog.Str(row, "title"))] = true
	}
	found := []map[string]any{}
	var last error
	parsed := false
	for _, source := range urls {
		raw, err := get(ctx, source)
		if err != nil {
			last = err
			continue
		}
		rows, err := ParseConference(raw, source, conf, year)
		if err != nil {
			last = err
			continue
		}
		if len(rows) > 0 {
			parsed = true
		}
		for _, row := range rows {
			key := catalog.NormalizeTitle(catalog.Str(row, "title"))
			if seen[key] {
				continue
			}
			seen[key] = true
			if (conf == "usenix" || conf == "ndss") && catalog.Str(row, "description") == "" {
				if detail, err := get(ctx, catalog.Str(row, "link")); err == nil {
					doc, _ := html.Parse(strings.NewReader(string(detail)))
					if doc != nil {
						walk(doc, func(n *html.Node) {
							if n.Type != html.ElementNode {
								return
							}
							cls := strings.ToLower(attr(n, "class"))
							if strings.Contains(cls, "abstract") && catalog.Str(row, "description") == "" {
								row["description"] = text(n)
							}
							if strings.Contains(cls, "presenter") && catalog.Str(row, "author") == "" {
								row["author"] = text(n)
							}
						})
					}
				}
			}
			found = append(found, row)
		}
		if conf != "usenix" && len(rows) > 0 {
			break
		}
	}
	if !parsed {
		return fmt.Errorf("no papers parsed from official pages; supply --url (last error: %v)", last)
	}
	return appendRows(file, found)
}
func (p *Pipeline) SummarizeConference(ctx context.Context, conf string, year int) error {
	if _, e := conferenceInfo(conf, year); e != nil {
		return e
	}
	base := fmt.Sprintf("%s_%d", conf, year)
	rows, e := catalog.Rows(filepath.Join(p.Config.Root, "top-conf/data/conferences", base+".jsonl"))
	if e != nil {
		return e
	}
	if len(rows) == 0 {
		return fmt.Errorf("no papers; run fetch-conf first")
	}
	file := filepath.Join(p.Config.Root, "top-conf/data/summary", base+"_summary.jsonl")
	old, e := catalog.Rows(file)
	if e != nil {
		return e
	}
	done := map[string]bool{}
	for _, r := range old {
		v, _ := r["paper"].(map[string]any)
		done[catalog.Str(v, "_id")] = true
	}
	for _, paper := range rows {
		if done[catalog.Str(paper, "_id")] {
			continue
		}
		b, _ := json.Marshal(paper)
		var result struct {
			Category string `json:"category"`
			Summary  string `json:"summary_zh"`
		}
		taxonomy := map[string]string{
			"security": "Web Security、System Security、Cryptography、Privacy、ML/AI Security、Network Security、Software Security、Hardware Security、Usable Security、Other",
			"ml":       "模型架构与训练、推理与规划、Coding Agents、智能体评测、对齐与安全、视觉与多模态、强化学习、机器学习理论等",
			"software": "Coding Agents、代码生成、程序修复、软件测试、程序分析、需求与设计、软件维护、实证软件工程等",
		}[catalog.Conferences[conf].Domain]
		prompt := fmt.Sprintf(`你是%s论文编辑。仅根据提供的标题、摘要与关键词归纳问题、方法、结果与局限；无摘要时明确说明仅据标题，禁止捏造实验。按论文实际贡献给出具体研究类别，参考方向：%s。返回JSON {"category":"具体研究类别","summary_zh":"中文深度摘要"}。`, catalog.Labels[conf], taxonomy)
		if e = p.AI.Complete(ctx, prompt, string(b), &result); e != nil {
			return e
		}
		if result.Category == "" || result.Summary == "" {
			return fmt.Errorf("empty paper summary")
		}
		record := map[string]any{"category": result.Category, "paper": map[string]any{"_id": paper["_id"], "title": paper["title"], "link": paper["link"], "author": paper["author"], "summary_zh": result.Summary}}
		if e = appendRows(file, []map[string]any{record}); e != nil {
			return e
		}
	}
	return nil
}
