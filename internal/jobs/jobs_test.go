package jobs

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/config"
	"github.com/FastR-D/FastNews/internal/store"
)

func TestFeedRSSAndAtomNewAnnouncements(t *testing.T) {
	rss := `<rss><channel><item><guid>story-1</guid><title>Security news</title><link>https://example.org/news</link><description>A report</description><pubDate>Wed, 11 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>`
	rows, e := ParseFeed([]byte(rss), "bleepingcomputer")
	if e != nil || len(rows) != 1 || rows[0]["source"] != "bleepingcomputer" {
		t.Fatal(rows, e)
	}
	atom := `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry><id>paper-1</id><title>New paper</title><link rel="alternate" href="https://arxiv.org/abs/1"/><summary>Evidence</summary><author><name>Alice</name></author><arxiv:announce_type>new</arxiv:announce_type></entry><entry><id>paper-2</id><title>Revision</title><link href="https://arxiv.org/abs/2"/><arxiv:announce_type>replace</arxiv:announce_type></entry></feed>`
	rows, e = ParseFeed([]byte(atom), "arxiv_cs_cr")
	if e != nil || len(rows) != 1 || rows[0]["author"] != "Alice" {
		t.Fatal(rows, e)
	}
}
func TestConferenceParsersAndAwardBoundaries(t *testing.T) {
	fixtures := map[string]string{"usenix": `<div><h2><a href="/conference/usenixsecurity26/presentation/alice">Defending LLM Tools Against Injection</a></h2><p class="authors">Alice, Bob</p><div class="abstract">A security experiment.</div></div>`, "ndss": `<div><h3><a href="/ndss-paper/secure-agents/">Secure Agents With New Defenses</a></h3><div class="authors">Alice</div></div>`, "ieee-sp": `<div class="paper"><h3>Secure Systems With New Methods</h3><p class="authors">Alice, Bob</p><p class="abstract">Verified security.</p></div>`, "ccs": `<div class="paper"><h4>New Cryptographic Protocol Designs</h4><span class="authors">Bob</span><div class="abstract">A proof.</div></div>`}
	for conf, raw := range fixtures {
		rows, e := ParseConference([]byte(raw), "https://example.org/program/", conf, 2026)
		if e != nil || len(rows) != 1 || catalog.Str(rows[0], "author") == "" {
			t.Fatal(conf, rows, e)
		}
	}
	awards := `<h2>Distinguished Paper Awards</h2><p><b>Secure Systems With New Methods</b><br>Alice</p><h2>Best Poster Award</h2><p><b>Excluded Poster Award Title</b></p><h2>Distinguished Artifact Award</h2><p><b>Excluded Artifact Work</b></p>`
	rows, e := ParseAwards([]byte(awards), "https://example.org/awards", "ieee-sp", 2026)
	if e != nil || len(rows) != 1 || catalog.Str(rows[0], "title") != "Secure Systems With New Methods" {
		t.Fatal(rows, e)
	}
}
func TestReportEscapesSourceAndCreatesDownload(t *testing.T) {
	root := t.TempDir()
	for _, dir := range []string{"top-conf/data/conferences", "top-conf/data/summary"} {
		os.MkdirAll(filepath.Join(root, dir), 0755)
	}
	os.WriteFile(filepath.Join(root, "top-conf/data/conferences/usenix_2026.jsonl"), []byte(`{"_id":"1","title":"<script>evil()</script>","link":"javascript:alert(1)"}`), 0644)
	os.WriteFile(filepath.Join(root, "top-conf/data/summary/usenix_2026_summary.jsonl"), []byte(`{"category":"ML/AI Security","paper":{"_id":"1","title":"<script>evil()</script>","summary_zh":"安全摘要"}}`), 0644)
	p := New(config.Config{Root: root, PublicPath: "/news"})
	if e := p.ConferenceReport("usenix", 2026, false); e != nil {
		t.Fatal(e)
	}
	b, e := os.ReadFile(filepath.Join(root, "top-conf/data/report/USENIX_2026_Report.html"))
	if e != nil {
		t.Fatal(e)
	}
	if strings.Contains(string(b), "<script>evil()</script>") || strings.Contains(string(b), `href="javascript:`) {
		t.Fatal("unsafe source rendered")
	}
	if !strings.Contains(string(b), "data-fastread-title=") {
		t.Fatal("FastRead handoff missing")
	}
}
func TestDailyCheckpointResumesWithoutRepeatLLM(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "secnews/data/articles")
	os.MkdirAll(dir, 0755)
	os.WriteFile(filepath.Join(dir, "2026-11-12.jsonl"), []byte("{\"_id\":\"a\",\"title\":\"Paper A\",\"source\":\"arxiv_cs_cr\"}\n{\"_id\":\"b\",\"title\":\"Paper B\",\"source\":\"arxiv_cs_ai\"}\n"), 0644)
	calls := 0
	fail := true
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if fail && calls == 2 {
			w.WriteHeader(502)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"content": `{"title_zh":"中文论文","summary_zh":"安全研究方法","recommendation_score":7,"channel":"security"}`}}}})
	}))
	defer upstream.Close()
	p := New(config.Config{Root: root, LLMKey: "test", LLMURL: upstream.URL})
	if e := p.Daily(context.Background(), "2026-11-12"); e == nil {
		t.Fatal("expected interrupted run")
	}
	fail = false
	if e := p.Daily(context.Background(), "2026-11-12"); e != nil {
		t.Fatal(e)
	}
	if calls != 3 {
		t.Fatal("checkpoint repeated prior generation", calls)
	}
	b, e := os.ReadFile(filepath.Join(root, "secnews/data/daily_summaries/2026-11-12.json"))
	if e != nil {
		t.Fatal(e)
	}
	var result struct {
		Complete bool  `json:"complete"`
		Articles []any `json:"articles"`
	}
	json.Unmarshal(b, &result)
	if !result.Complete || len(result.Articles) != 2 {
		t.Fatal(result)
	}
}

func TestLegacyArticleHash(t *testing.T) {
	article := map[string]any{"_id": "paper-1", "title": "安全 <研究>", "description": "A description", "link": "https://example.org/a"} // This exact string is Python json.dumps(..., ensure_ascii=False, sort_keys=True).
	raw := `{"_id": "paper-1", "description": "A description", "link": "https://example.org/a", "title": "安全 <研究>"}`
	if ArticleHash(article) != store.Digest(raw) {
		t.Fatal("legacy checkpoint hash changed")
	}
}

func TestExistingDailyCheckpointHash(t *testing.T) {
	root := filepath.Join("..", "..")
	rows, e := catalog.Rows(filepath.Join(root, "secnews/data/articles/2026-09-04.jsonl"))
	if e != nil {
		t.Fatal(e)
	}
	var summary struct {
		Articles []map[string]any `json:"articles"`
	}
	b, e := os.ReadFile(filepath.Join(root, "secnews/data/daily_summaries/2026-09-04.json"))
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(b, &summary); e != nil {
		t.Fatal(e)
	}
	index := map[string]map[string]any{}
	for _, row := range rows {
		index[catalog.Str(row, "_id")] = row
	}
	checked := 0
	for _, row := range summary.Articles {
		if source := index[catalog.Str(row, "_id")]; source != nil {
			if ArticleHash(source) != catalog.Str(row, "source_hash") {
				t.Fatal("existing Python checkpoint would be regenerated", catalog.Str(row, "_id"))
			}
			checked++
		}
	}
	if checked == 0 {
		t.Fatal("no legacy checkpoint verified")
	}
}
