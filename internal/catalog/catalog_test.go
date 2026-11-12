package catalog

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestArxivURLSourceAndSummaryMerge(t *testing.T) {
	root := t.TempDir()
	day := time.Now().UTC().Format("2006-01-02")
	for _, dir := range []string{"secnews/data/articles", "secnews/data/daily_summaries"} {
		os.MkdirAll(filepath.Join(root, dir), 0755)
	}
	row := map[string]any{"_id": "arxiv-one", "title": "Agent Security", "description": "Original abstract", "source": "https://rss.arxiv.org/atom/cs.ai+cs.cl", "link": "https://arxiv.org/abs/one"}
	b, _ := json.Marshal(row)
	os.WriteFile(filepath.Join(root, "secnews/data/articles", day+".jsonl"), append(b, '\n'), 0644)
	b, _ = json.Marshal(map[string]any{"articles": []map[string]any{{"_id": "arxiv-one", "title_zh": "智能体安全", "summary_zh": "研究智能体安全边界"}}})
	os.WriteFile(filepath.Join(root, "secnews/data/daily_summaries", day+".json"), b, 0644)
	c := &Catalog{Root: root}
	papers, e := c.Papers()
	if e != nil || len(papers) != 1 || papers[0].Source != "arxiv" || papers[0].TitleZH != "智能体安全" {
		t.Fatal(papers, e)
	}
}

func TestAwardAndCitationNormalization(t *testing.T) {
	if NormalizeTitle("Sécure Agents (Paper 1093)") != NormalizeTitle("Secure Agents") {
		t.Fatal("award title normalization differs")
	}
	if CanonicalAward("Distinguished Artifact Award") != "" || CanonicalAward("Best Poster Award") != "" || CanonicalAward("Best Paper Award") != "Distinguished Paper" {
		t.Fatal("unrelated award classified as paper award")
	}
	n := ParseCited("Cited by 1,234")
	if n == nil || *n != 1234 {
		t.Fatal(n)
	}
	if ParseCited(-1.0) != nil || ParseCited(1.5) != nil || ParseCited(true) != nil {
		t.Fatal("invalid citation count accepted")
	}
}
