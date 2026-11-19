package trend

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/FastR-D/FastNews/internal/catalog"
)

func TestKeywordEvidence(t *testing.T) {
	definition := taxonomy["ai"][2]
	for _, test := range []struct {
		name, title, abstract, evidence string
	}{
		{"title alias", "Evaluating retrieval‑augmented generation with GraphRAG", "", "标题：retrieval augmented generation"},
		{"ambiguous acronym", "RAG scoring for project risk", "A red amber green dashboard for project risk.", ""},
		{"grounded acronym", "Revisiting RAG", "Retrieval-augmented generation (RAG) improves access to external knowledge.", "标题缩写，摘要全称：retrieval augmented generation"},
		{"background only", "A study of verification", "Retrieval-augmented generation is popular. We propose a protocol for verification.", ""},
		{"contribution", "Evidence from real deployments", "We study retrieval-augmented generation for question answering.", "摘要贡献：retrieval augmented generation"},
		{"excluded baseline", "Verification without retrieval-augmented generation", "We analyze verification compared to retrieval-augmented generation baselines.", ""},
		{"whole words", "Retrieval-augmented generational models", "", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			var count topicCount
			paper := paper{id: "2611.01234", title: test.title, day: "2026-11-15"}
			matched := count.add(definition, paper, focusText(test.title), " "+normalize(test.abstract)+" ", contributionText(test.abstract), true)
			if !matched && test.evidence == "" {
				return
			}
			evidence := append(count.title, count.abstract...)
			if !matched || count.current != 1 || len(evidence) != 1 || evidence[0].Match != test.evidence {
				t.Fatalf("unexpected match: %t, evidence: %+v", matched, evidence)
			}
		})
	}
}

func TestWindowsCompareSharesNotVolume(t *testing.T) {
	latest := time.Date(2026, 11, 15, 0, 0, 0, 0, time.UTC)
	var papers []paper
	add := func(total, hits, offset int) {
		for index := range total {
			title := "Semantic evaluation for question answering"
			abstract := "We evaluate an existing system for question answering."
			if index < hits {
				title = "Cross-session latency in LLM agents with recurrent cache routing"
				abstract = "We propose recurrent cache routing with tool calling for latency."
			}
			papers = append(papers, paper{fmt.Sprint(len(papers)), title, abstract, dayString(latest.AddDate(0, 0, offset-index%3)), scopes["ai"]})
		}
	}
	add(40, 10, 0)
	add(20, 8, -7)
	report := summarize(papers, latest, latest, "ai", 7)
	if !report.Comparable || report.Matched != 10 || report.Current.Start != "2026-11-09" || report.Previous.End != "2026-11-08" || len(report.Topics) != 1 {
		t.Fatalf("unexpected report: %+v", report)
	}
	topic := report.Topics[0]
	if topic.Count != 10 || topic.Previous != 8 || topic.Share != 25 || topic.Change == nil || math.Abs(*topic.Change-(-15)) > 0.0001 {
		t.Fatalf("unexpected share change: %+v", topic)
	}
	if len(report.Candidates) != 1 || report.Candidates[0].Phrase != "recurrent cache routing" || report.Candidates[0].Count != 10 {
		t.Fatalf("unexpected candidates: %+v", report.Candidates)
	}
	withoutBaseline := summarize(papers[:40], latest, latest.AddDate(0, 0, 8), "ai", 7)
	if withoutBaseline.Comparable || withoutBaseline.Topics[0].Change != nil || !withoutBaseline.Stale {
		t.Fatalf("reported growth despite missing baseline: %+v", withoutBaseline)
	}
}

func TestCandidatePhrasesExcludeKnownFragments(t *testing.T) {
	known := knownPhrases(taxonomy["ai"])
	seen := map[string]*phraseCount{}
	title := "Multi-Agent Systems for Recurrent Cache Routing with Vision-Language Models in Natural Language"
	abstract := "Multi-agent systems use recurrent cache routing with vision-language models in natural language."
	for index := range 3 {
		day := fmt.Sprintf("2026-11-%02d", 12+index)
		addPhrases(seen, known, paper{id: fmt.Sprint(index), title: title, day: day}, focusText(title), " "+normalize(abstract)+" ")
	}
	for _, fragment := range []string{"multi agent", "agent systems", "vision language", "vision language models", "natural language"} {
		if seen[fragment] != nil {
			t.Errorf("known fragment surfaced as a candidate: %s", fragment)
		}
	}
	if seen["recurrent cache routing"].count != 3 {
		t.Fatal("recurring grounded phrase was dropped")
	}
}

func TestArchiveDeduplicationAndScope(t *testing.T) {
	root := t.TempDir()
	directory := filepath.Join(root, "secnews/data/articles")
	if err := os.MkdirAll(directory, 0755); err != nil {
		t.Fatal(err)
	}
	write := func(day string, rows ...map[string]any) {
		t.Helper()
		var content strings.Builder
		for _, row := range rows {
			if err := json.NewEncoder(&content).Encode(row); err != nil {
				t.Fatal(err)
			}
		}
		if err := os.WriteFile(filepath.Join(directory, day+".jsonl"), []byte(content.String()), 0644); err != nil {
			t.Fatal(err)
		}
	}
	entry := func(link, source, title, description string, categories ...string) map[string]any {
		return map[string]any{"link": link, "source": source, "title": title, "description": description, "categories": categories}
	}
	write("2026-09-04", entry("http://arxiv.org/abs/2609.01234v1", "arxiv_cs_ai", "Evaluating LLM agents", "", "cs.AI"))
	write("2026-09-11",
		entry("https://arxiv.org/pdf/2609.01234v2.pdf", "https://rss.arxiv.org/atom/cs.se", "Evaluating LLM agents", "We present an analysis of tool calling.", "cs.SE"),
		entry("https://arxiv.org/abs/2609.07890", "arxiv_cs_cr", "On privacy leakage", "We study privacy leakage."),
		entry("https://arxiv.org/abs/2609.09123", "arxiv_cs_ai", "Test-time scaling", "arXiv:2609.09123v2 Announce Type: replace\nAbstract: Revised."),
	)
	write("2026-09-12", entry("https://example.org/news", "securityweek", "Daily news", ""))
	write("2026-11-20", entry("https://arxiv.org/abs/2611.01234", "arxiv_cs_ai", "Future paper", "", "cs.AI"))
	now := time.Date(2026, 11, 19, 0, 0, 0, 0, time.UTC)
	cat := &catalog.Catalog{Root: root}
	papers, latest, err := readCorpus(cat, now)
	if err != nil || len(papers) != 2 || dayString(latest) != "2026-09-11" {
		t.Fatalf("archive: %+v, latest: %v, error: %v", papers, latest, err)
	}
	if papers[0].day != "2026-09-04" || papers[0].scopes != scopes["ai"]|scopes["software"] || !strings.Contains(papers[0].abstract, "tool calling") {
		t.Fatalf("duplicate was not merged into its first date: %+v", papers[0])
	}
	service := Service{Catalog: cat}
	report, err := service.Report("ai", 7, now)
	if err != nil || report.Current.Papers != 0 || report.Previous.Papers != 1 || !report.Stale {
		t.Fatalf("unexpected archive report: %+v, %v", report, err)
	}
}
