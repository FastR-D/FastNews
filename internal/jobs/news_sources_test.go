package jobs

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/config"
)

func TestConfiguredChannelDeduplicatesOldArchivesAndTrackingLinks(t *testing.T) {
	var requested []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requested = append(requested, r.URL.Path)
		fmt.Fprint(w, `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
		<item><guid>changed-guid</guid><title>Old story</title><link>https://news.example/old?utm_source=new#section</link></item>
		<item><guid>archive</guid><title>Historical story</title><link>https://news.example/archive</link><pubDate>Wed, 11 Nov 2020 12:00:00 GMT</pubDate></item>
		<item><guid>new</guid><title>New story</title><link>https://news.example/new</link><content:encoded><![CDATA[<p>Useful &amp; accurate</p><script>ignore this</script>]]></content:encoded></item>
		</channel></rss>`)
	}))
	defer upstream.Close()
	root := t.TempDir()
	directory := filepath.Join(root, "secnews/data/articles")
	if err := os.MkdirAll(directory, 0755); err != nil {
		t.Fatal(err)
	}
	oldDay := time.Now().UTC().AddDate(0, 0, -30).Format("2006-01-02")
	if err := os.WriteFile(filepath.Join(directory, oldDay+".jsonl"), []byte(`{"_id":"old-guid","link":"https://news.example/old?utm_source=old"}`), 0644); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "sources.json")
	configuration := fmt.Sprintf(`[
	{"id":"openai","disabled":true}, {"id":"huggingface","disabled":true},
	{"id":"custom_ai","name":"Custom AI","channel":"ai","url":%q},
	{"id":"custom_news","name":"Other news","channel":"news","url":%q}
	]`, upstream.URL+"/ai", upstream.URL+"/news")
	if err := os.WriteFile(file, []byte(configuration), 0644); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		// A fresh pipeline simulates a scheduled job in a new process.
		if err := New(config.Config{Root: root}).FetchNewsConfigured(context.Background(), "ai", "", file); err != nil {
			t.Fatal(err)
		}
	}
	if strings.Join(requested, ",") != "/ai,/ai" {
		t.Fatal("channel or disabled-source filtering failed", requested)
	}
	rows, err := catalog.Rows(filepath.Join(directory, time.Now().UTC().Format("2006-01-02")+".jsonl"))
	if err != nil || len(rows) != 1 {
		t.Fatal("old/duplicate item persisted", rows, err)
	}
	if rows[0]["channel"] != "ai" || rows[0]["source_name"] != "Custom AI" || rows[0]["description"] != "Useful & accurate" {
		t.Fatal("custom feed metadata/content lost", rows)
	}
	if err := New(config.Config{Root: root}).FetchNewsConfigured(context.Background(), "ai", upstream.URL, file); err == nil {
		t.Fatal("group URL override accepted")
	}
}

func TestSourceConfigRejectsInvalidEntriesBeforeFetching(t *testing.T) {
	for _, raw := range []string{
		`[{"id":"new","url":"file:///etc/passwd","channel":"ai"}]`,
		`[{"id":"openai","channel":"other"}]`,
		`[{"id":"openai"},{"id":"openai"}]`,
		`[{"id":"all","url":"https://example.org/feed","channel":"news"}]`,
		`[{"id":"openai","disable":true}]`,
		`[{"id":"new","url":"https://example.org/feed","channel":"arxiv"}]`,
		`[] []`,
		`[{"id":"openai","max_age_days":-2}]`,
	} {
		root := t.TempDir()
		file := filepath.Join(root, "sources.json")
		if err := os.WriteFile(file, []byte(raw), 0644); err != nil {
			t.Fatal(err)
		}
		if _, err := New(config.Config{Root: root}).newsSources(file); err == nil {
			t.Fatal("invalid config accepted", raw)
		}
	}
}

func TestCollectionPersistsOnlyCSPrimaryPapers(t *testing.T) {
	raw := `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
 <entry><title>CS paper</title><link href="https://arxiv.org/abs/2611.00001"/><category term="stat.ML"/><category term="cs.AI"/><arxiv:primary_category term="cs.AI"/></entry>
 <entry><title>Cross listed biology</title><link href="https://arxiv.org/abs/2611.00002"/><category term="cs.AI"/><arxiv:primary_category term="q-bio.QM"/></entry>
 <entry><title>Unknown subject</title><link href="https://arxiv.org/abs/2611.00003"/></entry>
 </feed>`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, raw) }))
	defer server.Close()
	for _, channel := range []string{"arxiv", "ai"} {
		root := t.TempDir()
		source := catalog.NewsSource{ID: "arxiv_test", URL: server.URL, Channel: channel, MaxAgeDays: -1}
		p := New(config.Config{Root: root})
		if err := p.FetchNewsSources(context.Background(), []catalog.NewsSource{source}); err != nil {
			t.Fatal(err)
		}
		rows, err := catalog.Rows(filepath.Join(root, "secnews/data/articles", time.Now().UTC().Format(time.DateOnly)+".jsonl"))
		if err != nil || len(rows) != 1 || rows[0]["title"] != "CS paper" || rows[0]["primary_category"] != "cs.AI" {
			t.Fatal(rows, err)
		}
	}
	source := catalog.NewsSource{ID: "arxiv_physics", URL: "https://rss.arxiv.org/atom/physics.med-ph", Channel: "arxiv"}
	if err := New(config.Config{Root: t.TempDir()}).FetchNewsSources(context.Background(), []catalog.NewsSource{source}); err == nil || !strings.Contains(err.Error(), "cs.*") {
		t.Fatal("Non-CS source must fail before fetching", err)
	}
}
