package trend

import (
	"cmp"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/FastR-D/FastNews/internal/catalog"
)

const minTopicPapers = 3

type Service struct {
	Catalog *catalog.Catalog
	mu      sync.Mutex
	loaded  time.Time
	latest  time.Time
	papers  []paper
	reports map[query]Report
}

type query struct {
	scope string
	days  int
}

type Window struct {
	Start        string `json:"start"`
	End          string `json:"end"`
	Papers       int    `json:"papers"`
	ObservedDays int    `json:"observedDays"`
}

type Evidence struct {
	Title string `json:"title"`
	URL   string `json:"url"`
	Date  string `json:"date"`
	Match string `json:"match"`
}

type Topic struct {
	ID       string     `json:"id"`
	Label    string     `json:"label"`
	Keywords []string   `json:"keywords"`
	Count    int        `json:"count"`
	Previous int        `json:"previous"`
	Share    float64    `json:"share"`
	Change   *float64   `json:"change"`
	Evidence []Evidence `json:"evidence"`
}

type Candidate struct {
	Phrase   string     `json:"phrase"`
	Count    int        `json:"count"`
	Evidence []Evidence `json:"evidence"`
}

type Report struct {
	Current    Window      `json:"current"`
	Previous   Window      `json:"previous"`
	Stale      bool        `json:"stale"`
	Comparable bool        `json:"comparable"`
	Matched    int         `json:"matched"`
	Topics     []Topic     `json:"topics"`
	Candidates []Candidate `json:"candidates"`
}

type paper struct {
	id, title, abstract, day string
	scopes                   uint8
}

var scopes = map[string]uint8{"ai": 1, "security": 2, "software": 4}
var categoryScope = map[string]uint8{"cs.ai": 1, "cs.cl": 1, "cs.lg": 1, "cs.cv": 1, "cs.ro": 1, "cs.ma": 1, "stat.ml": 1, "cs.cr": 2, "cs.se": 4}
var sourceCategory = map[string]string{
	"arxiv_cs_ai": "cs.ai", "arxiv_cs_cr": "cs.cr", "arxiv_cs_se": "cs.se",
	"https://rss.arxiv.org/atom/cs.ai+cs.cl": "cs.ai", "https://rss.arxiv.org/atom/cs.cr": "cs.cr", "https://rss.arxiv.org/atom/cs.se": "cs.se",
}
var arxivID = regexp.MustCompile(`(?i)(?:^https?://(?:www\.)?arxiv\.org/(?:abs|pdf)/|arxiv(?:\.org)?:)(\d{4}\.\d{4,5}|[a-z][\w.-]*/\d{7})(?:v\d+)?(?:\.pdf)?(?:[?#/].*)?$`)
var announcement = regexp.MustCompile(`(?i)\bannounce type:\s*(\S+)`)
var abstractPrefix = regexp.MustCompile(`(?is)^\s*(?:arxiv:[^\n]*?announce type:\s*\S+\s*)?abstract:\s*`)

func Supported(scope string, days int) bool {
	return scopes[scope] != 0 && (days == 7 || days == 14 || days == 30)
}

func (s *Service) Report(scope string, days int, now time.Time) (Report, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if now.Sub(s.loaded) >= time.Minute || dayString(now) != dayString(s.loaded) {
		papers, latest, err := readCorpus(s.Catalog, now)
		if err != nil {
			return Report{}, err
		}
		s.loaded, s.papers, s.latest = now, papers, latest
		s.reports = make(map[query]Report)
	}
	key := query{scope, days}
	if report, ok := s.reports[key]; ok {
		return report, nil
	}
	report := summarize(s.papers, s.latest, now, scope, days)
	s.reports[key] = report
	return report, nil
}

func dayString(value time.Time) string { return value.UTC().Format(time.DateOnly) }

func readCorpus(cat *catalog.Catalog, now time.Time) ([]paper, time.Time, error) {
	days, err := cat.Dates()
	if err != nil {
		return nil, time.Time{}, err
	}
	var latest time.Time
	var cutoff string
	var records []paper
	for _, day := range days {
		if day > dayString(now) {
			continue
		}
		if cutoff != "" && day < cutoff {
			break
		}
		rows, err := catalog.Rows(filepath.Join(cat.Root, "secnews/data/articles", day+".jsonl"))
		if err != nil {
			return nil, time.Time{}, err
		}
		for _, row := range rows {
			if !catalog.InResearchScope(row) {
				continue
			}
			if record, ok := arxivPaper(row, day); ok {
				if latest.IsZero() {
					latest, _ = time.Parse(time.DateOnly, day)
					cutoff = dayString(latest.AddDate(0, 0, -59))
				}
				records = append(records, record)
			}
		}
	}
	byID := make(map[string]int, len(records))
	unique := make([]paper, 0, len(records))
	for _, record := range records {
		if index, ok := byID[record.id]; ok {
			prior := unique[index]
			record.scopes |= prior.scopes
			if record.abstract == "" {
				record.abstract = prior.abstract
			}
			unique[index] = record
		} else {
			byID[record.id] = len(unique)
			unique = append(unique, record)
		}
	}
	latest = time.Time{}
	for _, record := range unique {
		if record.day > dayString(latest) {
			latest, _ = time.Parse(time.DateOnly, record.day)
		}
	}
	return unique, latest, nil
}

func arxivPaper(row map[string]any, day string) (paper, bool) {
	source := strings.ToLower(catalog.Str(row, "source"))
	if !strings.HasPrefix(source, "arxiv_") && !strings.HasPrefix(source, "https://rss.arxiv.org/") && source != "arxiv" {
		return paper{}, false
	}
	match := arxivID.FindStringSubmatch(strings.TrimSpace(catalog.Str(row, "link")))
	if match == nil {
		match = arxivID.FindStringSubmatch(strings.TrimSpace(catalog.Str(row, "_id")))
	}
	title := strings.Join(strings.Fields(catalog.Str(row, "title")), " ")
	if match == nil || title == "" {
		return paper{}, false
	}
	abstract := catalog.First(catalog.Str(row, "description"), catalog.Str(row, "abstract"))
	if notice := announcement.FindStringSubmatch(abstract); notice != nil && !strings.EqualFold(notice[1], "new") {
		return paper{}, false
	}
	var fields uint8
	if categories, ok := row["categories"].([]any); ok && len(categories) > 0 {
		for _, value := range categories {
			if category, ok := value.(string); ok {
				fields |= categoryScope[strings.ToLower(strings.TrimSpace(category))]
			}
		}
	} else {
		fields = categoryScope[sourceCategory[source]]
	}
	return paper{strings.ToLower(match[1]), title, abstractPrefix.ReplaceAllString(abstract, ""), day, fields}, fields != 0
}

func (p paper) evidence(match string) Evidence {
	return Evidence{p.title, "https://arxiv.org/abs/" + p.id, p.day, match}
}

func summarize(papers []paper, latest, now time.Time, scope string, days int) Report {
	report := Report{Topics: []Topic{}, Candidates: []Candidate{}}
	if latest.IsZero() {
		return report
	}
	report.Stale = dayString(latest.AddDate(0, 0, 7)) < dayString(now)
	report.Current = Window{Start: dayString(latest.AddDate(0, 0, 1-days)), End: dayString(latest)}
	report.Previous = Window{Start: dayString(latest.AddDate(0, 0, 1-2*days)), End: dayString(latest.AddDate(0, 0, -days))}
	currentDays, previousDays := map[string]bool{}, map[string]bool{}
	definitions := taxonomy[scope]
	counts := make([]topicCount, len(definitions))
	phrases := map[string]*phraseCount{}
	known := knownPhrases(definitions)
	for _, paper := range papers {
		if paper.scopes&scopes[scope] == 0 || paper.day < report.Previous.Start {
			continue
		}
		current := paper.day >= report.Current.Start
		if current {
			report.Current.Papers++
			currentDays[paper.day] = true
		} else {
			report.Previous.Papers++
			previousDays[paper.day] = true
		}
		title := focusText(paper.title)
		abstract := " " + normalize(paper.abstract) + " "
		focus := contributionText(paper.abstract)
		matched := false
		for index, def := range definitions {
			if counts[index].add(def, paper, title, abstract, focus, current) {
				matched = true
			}
		}
		if current {
			if matched {
				report.Matched++
			}
			addPhrases(phrases, known, paper, title, abstract)
		}
	}
	report.Current.ObservedDays, report.Previous.ObservedDays = len(currentDays), len(previousDays)
	minimumDays := (days + 2) / 3
	report.Comparable = report.Current.Papers >= 20 && report.Previous.Papers >= 20 && len(currentDays) >= minimumDays && len(previousDays) >= minimumDays
	for index, count := range counts {
		if count.current >= minTopicPapers {
			report.Topics = append(report.Topics, count.result(definitions[index], report))
		}
	}
	slices.SortFunc(report.Topics, func(left, right Topic) int {
		return cmp.Or(cmp.Compare(right.Count, left.Count), cmp.Compare(left.ID, right.ID))
	})
	report.Candidates = topPhrases(phrases)
	return report
}
