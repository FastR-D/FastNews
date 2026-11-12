// Package catalog reads the existing published JSON/JSONL corpus without a
// migration. Reports are indexed from disk rather than compiled into the UI.
package catalog

import (
	"bufio"
	"encoding/json"
	"fmt"
	"golang.org/x/text/unicode/norm"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
)

type Paper struct {
	ID            string  `json:"id"`
	Source        string  `json:"source"`
	Title         string  `json:"title"`
	TitleZH       string  `json:"title_zh"`
	Author        string  `json:"author"`
	Year          int     `json:"year"`
	Venue         string  `json:"venue"`
	Conference    string  `json:"conference"`
	Category      string  `json:"category"`
	Link          string  `json:"link"`
	Summary       string  `json:"summary"`
	SearchSummary string  `json:"search_summary,omitempty"`
	DOI           string  `json:"doi,omitempty"`
	Award         string  `json:"award,omitempty"`
	CitedBy       *int    `json:"cited_by,omitempty"`
	Reason        string  `json:"reason,omitempty"`
	Score         float64 `json:"retrieval_score,omitempty"`
	Date          string  `json:"date,omitempty"`
}
type Report struct {
	Title   string `json:"title"`
	Kind    string `json:"kind"`
	HTML    string `json:"html"`
	PDF     string `json:"pdf,omitempty"`
	Size    int64  `json:"size"`
	Updated string `json:"updated"`
}
type Catalog struct {
	Root   string
	mu     sync.RWMutex
	loaded time.Time
	papers []Paper
}

var Labels = map[string]string{"usenix": "USENIX Security", "ieee-sp": "IEEE S&P", "ndss": "NDSS", "ccs": "ACM CCS"}
var confRE = regexp.MustCompile(`^(usenix|ieee-sp|ndss|ccs)_(\d{4})_summary\.jsonl$`)

func Rows(path string) ([]map[string]any, error) {
	f, e := os.Open(path)
	if os.IsNotExist(e) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	s.Buffer(make([]byte, 65536), 8*1024*1024)
	rows := []map[string]any{}
	for s.Scan() {
		if strings.TrimSpace(s.Text()) == "" {
			continue
		}
		var v map[string]any
		if json.Unmarshal(s.Bytes(), &v) == nil && v != nil {
			rows = append(rows, v)
		}
	}
	return rows, s.Err()
}
func Str(m map[string]any, k string) string {
	if m == nil || m[k] == nil {
		return ""
	}
	switch v := m[k].(type) {
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	default:
		return fmt.Sprint(v)
	}
}
func First(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}
func Clip(s string, n int) string {
	r := []rune(strings.Join(strings.Fields(s), " "))
	if len(r) > n {
		return string(r[:n]) + "…"
	}
	return string(r)
}
func object(m map[string]any, k string) map[string]any { v, _ := m[k].(map[string]any); return v }
func (c *Catalog) Papers() ([]Paper, error) {
	c.mu.RLock()
	if time.Since(c.loaded) < time.Minute {
		out := append([]Paper(nil), c.papers...)
		c.mu.RUnlock()
		return out, nil
	}
	c.mu.RUnlock()
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Since(c.loaded) < time.Minute {
		return append([]Paper(nil), c.papers...), nil
	}
	files, e := filepath.Glob(filepath.Join(c.Root, "top-conf/data/summary/*_summary.jsonl"))
	if e != nil {
		return nil, e
	}
	out := []Paper{}
	awards := map[string]string{}
	var index struct {
		Papers []map[string]any `json:"papers"`
	}
	if b, e := os.ReadFile(filepath.Join(c.Root, "top-conf/data/awards.json")); e == nil && json.Unmarshal(b, &index) == nil {
		for _, a := range index.Papers {
			if award := CanonicalAward(First(Str(a, "award"), "Distinguished Paper")); award != "" {
				awards[Str(a, "conference")+Str(a, "year")+NormalizeTitle(Str(a, "title"))] = award
			}
		}
	}
	for _, f := range files {
		m := confRE.FindStringSubmatch(filepath.Base(f))
		if m == nil {
			continue
		}
		year, _ := strconv.Atoi(m[2])
		src, e := Rows(filepath.Join(c.Root, "top-conf/data/conferences", m[1]+"_"+m[2]+".jsonl"))
		if e != nil {
			return nil, e
		}
		sources := map[string]map[string]any{}
		for _, s := range src {
			sources[First(Str(s, "_id"), Str(s, "link"))] = s
		}
		rows, e := Rows(f)
		if e != nil {
			return nil, e
		}
		for _, r := range rows {
			p := object(r, "paper")
			if p == nil {
				continue
			}
			id := First(Str(p, "_id"), Str(p, "link"))
			s := sources[id]
			title := First(Str(p, "title"), Str(s, "title"))
			if id == "" || title == "" {
				continue
			}
			summary := First(Str(p, "summary_zh"), Str(s, "description"))
			v := Paper{ID: id, Source: "top-conf", Title: title, Author: First(Str(p, "author"), Str(s, "author")), Year: year, Venue: Labels[m[1]], Conference: m[1], Category: First(Str(r, "category"), "Uncategorized"), Link: First(Str(p, "link"), Str(s, "link"), id), Summary: Clip(summary, 1200), SearchSummary: summary + " " + Str(s, "description"), DOI: Str(s, "doi"), Award: awards[m[1]+m[2]+NormalizeTitle(title)]}
			if award := CanonicalAward(Str(s, "award")); award != "" {
				v.Award = award
			}
			raw, ok := s["cited_by"]
			if !ok {
				raw = s["citation_count"]
			}
			v.CitedBy = ParseCited(raw)

			out = append(out, v)
		}
	}
	dates, e := c.Dates()
	if e != nil {
		return nil, e
	}
	seen := map[string]bool{}
	cutoff := time.Now().AddDate(0, 0, -90).Format("2006-01-02")
	for _, day := range dates {
		if day < cutoff {
			continue
		}
		rows, e := c.News(day)
		if e != nil {
			return nil, e
		}
		for _, r := range rows {
			if !strings.Contains(strings.ToLower(Str(r, "source")), "arxiv") {
				continue
			}
			id := First(Str(r, "_id"), Str(r, "link"))
			if seen[id] {
				continue
			}
			seen[id] = true
			year, _ := strconv.Atoi(day[:4])
			out = append(out, Paper{ID: id, Source: "arxiv", Title: Str(r, "title"), TitleZH: Str(r, "title_zh"), Author: Str(r, "author"), Year: year, Conference: "arxiv", Venue: "arXiv", Category: Str(r, "source"), Link: Str(r, "link"), Summary: First(Str(r, "summary_zh"), Str(r, "description")), Date: day})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Year > out[j].Year })
	c.papers = out
	c.loaded = time.Now()
	return append([]Paper(nil), out...), nil
}

var nonTitle = regexp.MustCompile(`[^a-z0-9]+`)
var paperNumberRE = regexp.MustCompile(`(?i)\s*\(paper\s+\d+\)\s*`)

func NormalizeTitle(s string) string {
	decomposed := norm.NFKD.String(strings.ToLower(s))
	var plain strings.Builder
	for _, r := range decomposed {
		if !unicode.Is(unicode.Mn, r) {
			plain.WriteRune(r)
		}
	}
	s = paperNumberRE.ReplaceAllString(plain.String(), " ")
	return strings.TrimSpace(nonTitle.ReplaceAllString(s, " "))
}
func (c *Catalog) Invalidate() { c.mu.Lock(); defer c.mu.Unlock(); c.loaded = time.Time{} }
func (c *Catalog) Dates() ([]string, error) {
	files, e := filepath.Glob(filepath.Join(c.Root, "secnews/data/articles/????-??-??.jsonl"))
	out := []string{}
	for _, f := range files {
		s := strings.TrimSuffix(filepath.Base(f), ".jsonl")
		if _, err := time.Parse("2006-01-02", s); err == nil {
			out = append(out, s)
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(out)))
	return out, e
}
func (c *Catalog) News(day string) ([]map[string]any, error) {
	if _, e := time.Parse("2006-01-02", day); e != nil {
		return nil, e
	}
	rows, e := Rows(filepath.Join(c.Root, "secnews/data/articles", day+".jsonl"))
	if e != nil {
		return nil, e
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	var summaries struct {
		Articles []map[string]any `json:"articles"`
	}
	b, e := os.ReadFile(filepath.Join(c.Root, "secnews/data/daily_summaries", day+".json"))
	if e == nil {
		if e = json.Unmarshal(b, &summaries); e != nil {
			return nil, e
		}
		byID := map[string]map[string]any{}
		for _, r := range summaries.Articles {
			byID[First(Str(r, "_id"), Str(r, "link"))] = r
		}
		for _, r := range rows {
			if extra := byID[First(Str(r, "_id"), Str(r, "link"))]; extra != nil {
				for k, v := range extra {
					r[k] = v
				}
			}
		}
	}
	return rows, nil
}
func (c *Catalog) Reports() ([]Report, error) {
	out := []Report{}
	for _, kind := range []string{"top-conf", "secnews"} {
		files, e := filepath.Glob(filepath.Join(c.Root, kind, "data/report/*.html"))
		if e != nil {
			return nil, e
		}
		for _, f := range files {
			info, e := os.Stat(f)
			if e != nil {
				return nil, e
			}
			name := filepath.Base(f)
			title := strings.TrimSuffix(strings.TrimSuffix(name, ".html"), "_Report")
			title = strings.TrimSuffix(title, "-report")
			title = strings.ReplaceAll(title, "_", " ")
			for k, label := range map[string]string{"USENIX": "USENIX Security", "IEEE-SP": "IEEE S&P", "CCS": "ACM CCS"} {
				title = strings.ReplaceAll(title, k, label)
			}
			v := Report{Title: title, Kind: kind, HTML: kind + "/data/report/" + name, Size: info.Size(), Updated: info.ModTime().UTC().Format(time.RFC3339)}
			pdf := strings.TrimSuffix(f, ".html") + ".pdf"
			if _, e := os.Stat(pdf); e == nil {
				v.PDF = kind + "/data/report/" + filepath.Base(pdf)
			}
			out = append(out, v)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Kind == out[j].Kind {
			return out[i].Title > out[j].Title
		}
		return out[i].Kind < out[j].Kind
	})
	return out, nil
}

func CanonicalAward(s string) string {
	text := strings.ToLower(s)
	for _, excluded := range []string{"artifact", "reviewer", "test of time", "honorable mention", "poster"} {
		if strings.Contains(text, excluded) {
			return ""
		}
	}
	if strings.Contains(text, "distinguished paper") || strings.Contains(text, "best paper") {
		return "Distinguished Paper"
	}
	return ""
}

var citationNumber = regexp.MustCompile(`\d+`)

func ParseCited(value any) *int {
	var text string
	switch v := value.(type) {
	case float64:
		if v < 0 || v != math.Trunc(v) {
			return nil
		}
		text = strconv.FormatFloat(v, 'f', 0, 64)
	case string:
		text = strings.ReplaceAll(v, ",", "")
	case int:
		if v < 0 {
			return nil
		}
		text = strconv.Itoa(v)
	default:
		return nil
	}
	match := citationNumber.FindString(text)
	if match == "" {
		return nil
	}
	n, e := strconv.Atoi(match)
	if e != nil {
		return nil
	}
	return &n
}

// UnmarshalJSON accepts the string years used by older report handoffs while
// preserving an integer year for the typed catalog and new React client.
func (p *Paper) UnmarshalJSON(raw []byte) error {
	type alias Paper
	value := struct {
		*alias
		Year json.RawMessage `json:"year"`
	}{alias: (*alias)(p)}
	if e := json.Unmarshal(raw, &value); e != nil {
		return e
	}
	if len(value.Year) == 0 || string(value.Year) == "null" {
		p.Year = 0
		return nil
	}
	var year int
	if e := json.Unmarshal(value.Year, &year); e == nil {
		p.Year = year
		return nil
	}
	var text string
	if e := json.Unmarshal(value.Year, &text); e != nil {
		return e
	}
	if text == "" {
		p.Year = 0
		return nil
	}
	parsed, e := strconv.Atoi(text)
	if e != nil {
		return e
	}
	p.Year = parsed
	return nil
}
