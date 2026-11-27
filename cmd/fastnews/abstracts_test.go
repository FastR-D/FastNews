package main

import (
	"context"
	"encoding/json"
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

func TestNeuripsAbstractsResumeAndRefreshSourceBoundSummaries(t *testing.T) {
	index, err := os.ReadFile(filepath.Join("testdata", "neurips-2025-index.html"))
	if err != nil {
		t.Fatal(err)
	}
	var failSecond atomic.Bool
	failSecond.Store(true)
	var first, second, models atomic.Int32
	original := http.DefaultTransport
	http.DefaultTransport = newsTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Hostname() == "127.0.0.1" {
			return original.RoundTrip(r)
		}
		if r.URL.Hostname() != "papers.nips.cc" {
			return nil, fmt.Errorf("unexpected source")
		}
		body := string(index)
		status := 200
		if strings.HasSuffix(r.URL.Path, ".html") {
			if strings.Contains(r.URL.Path, "0010665e") {
				second.Add(1)
				if failSecond.Load() {
					status = 503
				}
			} else {
				first.Add(1)
			}
			pdf := strings.Replace(strings.TrimSuffix(r.URL.Path, "-Abstract-Conference.html"), "/hash/", "/file/", 1) + "-Paper-Conference.pdf"
			body = fmt.Sprintf(`<html><head><meta name="citation_title" content="Recorded paper"><meta name="citation_volume" content="38"><meta name="citation_publication_date" content="2026-04-23"><meta name="citation_pdf_url" content="https://proceedings.neurips.cc%s"></head><body><section class="paper-section"><h2 class="section-label">Abstract</h2><p class="paper-abstract"><p>We examine <em>model efficiency</em> with measured evidence.</p></p></section></body></html>`, pdf)
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}, Request: r}, nil
	})
	t.Cleanup(func() { http.DefaultTransport = original })
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := models.Add(1)
		body, _ := io.ReadAll(r.Body)
		if count > 2 && !strings.Contains(string(body), "We examine model efficiency with measured evidence.") {
			t.Error("regenerated summary did not receive enriched source text")
		}
		fmt.Fprint(w, `{"choices":[{"finish_reason":"stop","message":{"content":"{\"category\":\"Recorded test category\",\"summary_zh\":\"隔离模型协议测试。\"}"}}]}`)
	}))
	defer model.Close()
	c := config.Config{Root: t.TempDir(), LLMKey: "fixture", LLMURL: model.URL}
	db, err := store.Open(filepath.Join(c.Root, "accounts"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	app, err := httpapi.New(c, db)
	if err != nil {
		t.Fatal(err)
	}
	assertCoverage := func(abstracts, summaries, stale int, state string) {
		t.Helper()
		recorder := httptest.NewRecorder()
		app.Handler().ServeHTTP(recorder, httptest.NewRequest("GET", "/api/coverage", nil))
		var result struct {
			Conferences []catalog.ConferenceCoverage `json:"conferences"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || recorder.Code != 200 || len(result.Conferences) != 1 {
			t.Fatal("coverage response", recorder.Code, recorder.Body.String(), err)
		}
		row := result.Conferences[0]
		if row.Papers != 2 || row.Abstracts != abstracts || row.Summaries != summaries || row.StaleSummaries != stale || row.Job == nil || row.Job.State != state || row.Job.LastSuccessAt == nil {
			t.Fatal("coverage did not follow persisted evidence", row)
		}
		if state == "failed" && (row.Job.ErrorKind != "source_http" || row.Job.HTTPStatus != 503) {
			t.Fatal("failure reason was lost", row.Job)
		}
	}
	args := []string{"--conference", "neurips", "--year", "2025"}
	ctx := context.Background()
	for _, command := range []string{"fetch-conf", "summarize-conf"} {
		if err := job(ctx, c, command, args); err != nil {
			t.Fatal(err)
		}
	}
	if models.Load() != 2 {
		t.Fatal(models.Load())
	}
	assertCoverage(0, 2, 0, "completed")
	if err := job(ctx, c, "enrich-abstracts", append(append([]string{}, args...), "--limit", "1")); err != nil {
		t.Fatal(err)
	}
	if first.Load() != 1 || second.Load() != 0 {
		t.Fatal("bounded enrichment exceeded its requested work", first.Load(), second.Load())
	}
	enrichArgs := append(append([]string{}, args...), "--all")
	if err := job(ctx, c, "enrich-abstracts", enrichArgs); err == nil {
		t.Fatal("interrupted enrichment succeeded")
	}
	assertCoverage(1, 1, 1, "failed")
	file := filepath.Join(c.Root, "top-conf/data/abstracts/neurips_2025.jsonl")
	checkpoints, err := catalog.Rows(file)
	if err != nil || len(checkpoints) != 1 {
		t.Fatal("first successful abstract not checkpointed", checkpoints, err)
	}
	failSecond.Store(false)
	for range 2 {
		if err := job(ctx, c, "enrich-abstracts", enrichArgs); err != nil {
			t.Fatal(err)
		}
	}
	if first.Load() != 1 || second.Load() != 2 {
		t.Fatal("completed papers were fetched again", first.Load(), second.Load())
	}
	assertCoverage(2, 0, 2, "completed")
	checkpoints, err = catalog.Rows(file)
	if err != nil || len(checkpoints) != 2 {
		t.Fatal("resume duplicated or lost abstracts", checkpoints, err)
	}
	for _, record := range checkpoints {
		if record["description"] != "We examine model efficiency with measured evidence." {
			t.Fatal("nested publisher paragraph was lost", record)
		}
		if catalog.Str(record, "description_source") == "" {
			t.Fatal("source URL lost")
		}
	}
	cat := &catalog.Catalog{Root: c.Root}
	papers, err := cat.Papers()
	if err != nil || len(papers) != 2 {
		t.Fatal("enriched sources should remain readable", papers, err)
	}
	for _, paper := range papers {
		if paper.SummaryStatus != "source" || paper.Summary != "We examine model efficiency with measured evidence." {
			t.Fatal("stale model summary exposed", paper)
		}
	}
	for range 2 {
		if err := job(ctx, c, "summarize-conf", args); err != nil {
			t.Fatal(err)
		}
	}
	if models.Load() != 4 {
		t.Fatal("source update did not refresh exactly the changed summaries", models.Load())
	}
	assertCoverage(2, 2, 0, "completed")
	cat.Invalidate()
	papers, err = cat.Papers()
	if err != nil || len(papers) != 2 {
		t.Fatal("fresh summaries missing or duplicated", papers, err)
	}
	if err := job(ctx, c, "conference-report", args); err != nil {
		t.Fatal(err)
	}
}

func TestNeuripsAbstractRejectsWrongIdentityOrMissingContent(t *testing.T) {
	index, err := os.ReadFile(filepath.Join("testdata", "neurips-2025-index.html"))
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"wrong-pdf", "wrong-volume", "missing-abstract", "verification-page"} {
		t.Run(mode, func(t *testing.T) {
			original := http.DefaultTransport
			http.DefaultTransport = newsTransport(func(r *http.Request) (*http.Response, error) {
				body := string(index)
				if strings.HasSuffix(r.URL.Path, ".html") {
					pdf := strings.Replace(strings.TrimSuffix(r.URL.Path, "-Abstract-Conference.html"), "/hash/", "/file/", 1) + "-Paper-Conference.pdf"
					volume := "38"
					content := `<p class="paper-abstract">Original abstract</p>`
					if mode == "wrong-pdf" {
						pdf = strings.Replace(pdf, "0010031a", "ffffffff", 1)
					}
					if mode == "wrong-volume" {
						volume = "37"
					}
					if mode == "missing-abstract" {
						content = ""
					}
					body = fmt.Sprintf(`<meta name="citation_title" content="Recorded paper"><meta name="citation_volume" content="%s"><meta name="citation_pdf_url" content="https://proceedings.neurips.cc%s"><section class="paper-section">%s</section>`, volume, pdf, content)
					if mode == "verification-page" {
						body = `<html><body>Verification required</body></html>`
					}
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}, Request: r}, nil
			})
			t.Cleanup(func() { http.DefaultTransport = original })
			c := config.Config{Root: t.TempDir()}
			args := []string{"--conference", "neurips", "--year", "2025"}
			if err := job(context.Background(), c, "fetch-conf", args); err != nil {
				t.Fatal(err)
			}
			if err := job(context.Background(), c, "enrich-abstracts", append(args, "--limit", "1")); err == nil {
				t.Fatal("invalid detail accepted", mode)
			}
			if _, err := os.Stat(filepath.Join(c.Root, "top-conf/data/abstracts/neurips_2025.jsonl")); !os.IsNotExist(err) {
				t.Fatal("invalid detail persisted", err)
			}
		})
	}
}
