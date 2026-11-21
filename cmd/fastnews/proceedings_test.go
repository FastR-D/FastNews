package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/config"
	"github.com/FastR-D/FastNews/internal/httpapi"
	"github.com/FastR-D/FastNews/internal/store"
)

func TestOfficialProceedingsThroughCollectionClassificationAndReport(t *testing.T) {
	for _, conf := range []string{"icml", "neurips"} {
		t.Run(conf, func(t *testing.T) {
			fixture := "icml-2025-index.html"
			if conf == "neurips" {
				fixture = "neurips-2025-index.html"
			}
			index, err := os.ReadFile(filepath.Join("testdata", fixture))
			if err != nil {
				t.Fatal(err)
			}
			feed, err := os.ReadFile(filepath.Join("testdata", "icml-2025-feed.xml"))
			if err != nil {
				t.Fatal(err)
			}
			var mode atomic.Int32
			var models atomic.Int32
			original := http.DefaultTransport
			http.DefaultTransport = newsTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.Hostname() == "127.0.0.1" {
					return original.RoundTrip(r)
				}
				if r.URL.Hostname() != "proceedings.mlr.press" && r.URL.Hostname() != "papers.nips.cc" {
					return nil, fmt.Errorf("unexpected source %s", r.URL)
				}
				body := string(index)
				if strings.HasSuffix(r.URL.Path, "feed.xml") {
					body = string(feed)
					if mode.Load() == 1 {
						return &http.Response{StatusCode: 503, Body: io.NopCloser(strings.NewReader("unavailable")), Header: http.Header{}, Request: r}, nil
					}
					if mode.Load() == 2 {
						body = strings.ReplaceAll(body, "aamand25a.html", "missing25a.html")
					}
				} else {
					switch mode.Load() {
					case 1:
						if conf == "neurips" {
							body = strings.Replace(body, "3 papers", "4 papers", 1)
						}
					case 2:
						if conf == "neurips" {
							body = strings.ReplaceAll(body, "/2025/hash/", "/2024/hash/")
						}
					case 3:
						body = `<html><body>Verification required</body></html>`
					case 4:
						body = strings.ReplaceAll(body, `class="authors"`, `class="missing"`)
						body = strings.ReplaceAll(body, `class="paper-authors"`, `class="missing"`)
					case 5:
						body = strings.ReplaceAll(body, "v267/", "v235/")
						body = strings.ReplaceAll(body, `data-track="conference"`, `data-track="creative_ai_track"`)
					}
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}, Request: r}, nil
			})
			t.Cleanup(func() { http.DefaultTransport = original })
			model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				models.Add(1)
				body, _ := io.ReadAll(r.Body)
				if conf == "icml" && !strings.Contains(string(body), "description") {
					t.Error("source evidence missing")
				}
				fmt.Fprint(w, `{"choices":[{"finish_reason":"stop","message":{"content":"{\"category\":\"Recorded test category\",\"summary_zh\":\"隔离模型协议验收，非真实模型质量评估。\"}"}}]}`)
			}))
			defer model.Close()
			c := config.Config{Root: t.TempDir(), LLMKey: "fixture", LLMURL: model.URL}
			args := []string{"--conference", conf, "--year", "2025"}
			for range 2 {
				if err := job(context.Background(), c, "fetch-conf", args); err != nil {
					t.Fatal(err)
				}
			}
			file := filepath.Join(c.Root, "top-conf/data/conferences", conf+"_2025.jsonl")
			rows, err := catalog.Rows(file)
			if err != nil || len(rows) != 2 {
				t.Fatalf("scope/deduplication: %d records, %v", len(rows), err)
			}
			for _, row := range rows {
				if catalog.Str(row, "author") == "" {
					t.Fatal("author metadata lost")
				}
				if conf == "icml" && catalog.Str(row, "description") == "" {
					t.Fatal("RSS abstract lost")
				}
				if conf == "neurips" && (catalog.Str(row, "track") != "conference" || catalog.Str(row, "description") != "") {
					t.Fatal("track scope or unknown abstract changed", row)
				}
			}
			if conf == "icml" && rows[0]["_id"] != "https://openreview.net/forum?id=jYmGi1175R" {
				t.Fatal("publisher-linked identity changed", rows[0]["_id"])
			}
			for range 2 {
				if err := job(context.Background(), c, "summarize-conf", args); err != nil {
					t.Fatal(err)
				}
			}
			if models.Load() != 2 {
				t.Fatal("summary checkpoint was not reused", models.Load())
			}
			if err := job(context.Background(), c, "conference-report", args); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(filepath.Join(c.Root, "top-conf/data/report", strings.ToUpper(conf)+"_2025_Report.html"))
			if err != nil || !strings.Contains(string(data), catalog.Str(rows[0], "title")) {
				t.Fatal("report artifact missing", err)
			}
			db, err := store.Open(filepath.Join(c.Root, "accounts"))
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			app, err := httpapi.New(c, db)
			if err != nil {
				t.Fatal(err)
			}
			recorder := httptest.NewRecorder()
			app.Handler().ServeHTTP(recorder, httptest.NewRequest("GET", "/api/papers?conference="+conf+"&year=2025", nil))
			if recorder.Code != 200 || !strings.Contains(recorder.Body.String(), catalog.Str(rows[0], "title")) {
				t.Fatal("catalog failed", recorder.Code, recorder.Body.String())
			}
			before, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			for _, failure := range []int32{1, 2, 3, 4, 5} {
				mode.Store(failure)
				if err := job(context.Background(), c, "fetch-conf", args); err == nil {
					t.Fatal("invalid proceedings accepted", failure)
				}
				after, err := os.ReadFile(file)
				if err != nil || string(after) != string(before) {
					t.Fatal("failed source changed corpus", failure, err)
				}
			}
		})
	}
}

func TestUnverifiedProceedingsYearFailsBeforeNetworkOrCorpusWrites(t *testing.T) {
	var requests atomic.Int32
	original := http.DefaultTransport
	http.DefaultTransport = newsTransport(func(r *http.Request) (*http.Response, error) {
		requests.Add(1)
		return nil, fmt.Errorf("unexpected network request")
	})
	t.Cleanup(func() { http.DefaultTransport = original })
	for _, conf := range []string{"icml", "neurips"} {
		c := config.Config{Root: t.TempDir()}
		if err := job(context.Background(), c, "fetch-conf", []string{"--conference", conf, "--year", "2026"}); err == nil {
			t.Fatal("unverified year accepted", conf)
		}
		if _, err := os.Stat(filepath.Join(c.Root, "top-conf")); !os.IsNotExist(err) {
			t.Fatal("unsupported year created corpus", conf, err)
		}
	}
	if requests.Load() != 0 {
		t.Fatal("unsupported source was fetched", requests.Load())
	}
}
