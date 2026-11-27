package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/config"
)

type newsTransport func(*http.Request) (*http.Response, error)

func (f newsTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestNewsSourcesThroughCLIAndWeeklyReport(t *testing.T) {
	// Real CLI dispatch, fetch/parser, persistence, catalog, newspaper and HTML report.
	// Only the public HTTP transport is redirected to recorded RSS/Atom protocols.
	want := []string{"bleepingcomputer", "thehackernews", "securityweek", "arxiv_cs_cr", "arxiv_cs_ai", "arxiv_cs_se", "krebs", "openai", "huggingface"}
	var failBleeping atomic.Bool
	failBleeping.Store(true)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		source := r.Header.Get("X-Fixture-Source")
		if source == "bleepingcomputer" && failBleeping.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if strings.HasPrefix(source, "arxiv_") {
			fmt.Fprintf(w, `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>%s</id><title>%s article</title><link rel="alternate" href="https://papers.example/%s"/><summary>Research abstract</summary><author><name>Alice</name></author></entry></feed>`, source, source, source)
		} else {
			fmt.Fprintf(w, `<rss version="2.0"><channel><item><guid>%s</guid><title>%s article</title><link>https://news.example/%s</link><description>News abstract</description><author>Editor</author></item></channel></rss>`, source, source, source)
		}
	}))
	defer upstream.Close()
	local, _ := url.Parse(upstream.URL)
	original := http.DefaultTransport
	http.DefaultTransport = newsTransport(func(r *http.Request) (*http.Response, error) {
		definition, ok := catalog.FindNewsSource(r.URL.String())
		if !ok {
			return nil, fmt.Errorf("unexpected upstream: %s", r.URL)
		}
		source := definition.ID
		request := r.Clone(r.Context())
		request.URL = local
		request.Header.Set("X-Fixture-Source", source)
		return original.RoundTrip(request)
	})
	t.Cleanup(func() { http.DefaultTransport = original })
	c := config.Config{Root: t.TempDir()}
	ctx := context.Background()
	if err := job(ctx, c, "fetch-news", []string{"--source", "all"}); err == nil {
		t.Fatal("failed source must remain visible to the scheduler")
	}
	file := filepath.Join(c.Root, "secnews/data/articles", time.Now().UTC().Format("2006-01-02")+".jsonl")
	rows, err := catalog.Rows(file)
	if err != nil || len(rows) != len(want)-1 {
		t.Fatalf("other feeds must survive a source failure: %d rows, %v", len(rows), err)
	}
	failBleeping.Store(false)
	for range 2 {
		if err := job(ctx, c, "fetch-news", []string{"--source", "all"}); err != nil {
			t.Fatal(err)
		}
	}
	rows, err = catalog.Rows(file)
	if err != nil || len(rows) != len(want) {
		t.Fatalf("retry/deduplication: %d rows, %v", len(rows), err)
	}
	for _, source := range want {
		found := false
		for _, row := range rows {
			if catalog.Str(row, "source") == source {
				found = true
				definition, _ := catalog.FindNewsSource(source)
				if catalog.Str(row, "channel") != definition.Channel {
					t.Errorf("%s lost its channel", source)
				}
				if catalog.Str(row, "author") == "" {
					t.Errorf("%s lost its RSS/Atom author", source)
				}
			}
		}
		if !found {
			t.Errorf("missing source %s", source)
		}
	}
	if err := job(ctx, c, "newspaper", nil); err != nil {
		t.Fatal(err)
	}
	if err := job(ctx, c, "weekly-report", nil); err != nil {
		t.Fatal(err)
	}
	reports, err := filepath.Glob(filepath.Join(c.Root, "secnews/data/report/*.json"))
	if err != nil || len(reports) != 1 {
		t.Fatalf("report artifact: %v, %v", reports, err)
	}
	report, err := os.ReadFile(reports[0])
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range want {
		if !strings.Contains(string(report), source+" article") {
			t.Errorf("weekly report dropped %s", source)
		}
	}
}

func TestFetchNewsRejectsNonFeedBeforePersistence(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<html><body>Upstream maintenance</body></html>`)
	}))
	defer upstream.Close()
	c := config.Config{Root: t.TempDir()}
	if err := job(context.Background(), c, "fetch-news", []string{"--source", "bleepingcomputer", "--url", upstream.URL}); err == nil {
		t.Fatal("HTML response must not be reported as a successful empty feed")
	}
	if _, err := os.Stat(filepath.Join(c.Root, "secnews")); !os.IsNotExist(err) {
		t.Fatal("invalid response created corpus files", err)
	}
}

func TestDailySummaryRequiresRecordedScoreWithinModelContract(t *testing.T) {
	for _, test := range []struct {
		name, score string
		want        int
	}{
		{"missing", "", 0}, {"null", `,"recommendation_score":null`, 0},
		{"zero", `,"recommendation_score":0`, 0}, {"negative", `,"recommendation_score":-1`, 0},
		{"too-high", `,"recommendation_score":11`, 0}, {"wrong-type", `,"recommendation_score":"high"`, 0},
		{"minimum", `,"recommendation_score":1`, 1}, {"maximum", `,"recommendation_score":10`, 10},
	} {
		t.Run(test.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "GET" {
					fmt.Fprint(w, `<rss><channel><item><guid>score-contract</guid><title>Security study</title><link>https://news.example/study</link><description>Observed facts</description></item></channel></rss>`)
					return
				}
				reply := `{"title_zh":"中文导读","summary_zh":"事实摘要","channel":"security"` + test.score + `}`
				fmt.Fprintf(w, `{"choices":[{"finish_reason":"stop","message":{"content":%q}}]}`, reply)
			}))
			defer upstream.Close()
			c := config.Config{Root: t.TempDir(), LLMKey: "fixture", LLMURL: upstream.URL}
			if err := job(context.Background(), c, "fetch-news", []string{"--source", "bleepingcomputer", "--url", upstream.URL}); err != nil {
				t.Fatal(err)
			}
			err := job(context.Background(), c, "daily-summary", nil)
			file := filepath.Join(c.Root, "secnews/data/daily_summaries", time.Now().UTC().Format("2006-01-02")+".json")
			if test.want == 0 {
				if err == nil {
					t.Fatal("missing or invalid score was turned into a recorded priority")
				}
				if _, err := os.Stat(file); !os.IsNotExist(err) {
					t.Fatal("invalid summary was persisted", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			articles, err := (&catalog.Catalog{Root: c.Root}).News(time.Now().UTC().Format("2006-01-02"))
			if err != nil || len(articles) != 1 || articles[0]["recommendation_score"] != float64(test.want) {
				t.Fatal("valid model score was changed or lost", articles, err)
			}
		})
	}
}
