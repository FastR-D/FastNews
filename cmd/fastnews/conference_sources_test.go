package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/config"
	"github.com/FastR-D/FastNews/internal/httpapi"
	"github.com/FastR-D/FastNews/internal/store"
)

func TestConferenceSourcesThroughCLIClassificationCatalogAndReport(t *testing.T) {
	for _, conf := range []string{"iclr", "icse", "ase"} {
		t.Run(conf, func(t *testing.T) {
			var mode atomic.Int32
			var modelCalls atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/chat/completions" {
					modelCalls.Add(1)
					body, _ := io.ReadAll(r.Body)
					if !strings.Contains(string(body), "Study") {
						t.Error("model did not receive source paper evidence")
					}
					if conf == "iclr" {
						if !strings.Contains(string(body), "Official abstract") || !strings.Contains(string(body), "Declared keyword") {
							t.Error("available abstract or keywords were lost before classification")
						}
					}
					json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"content": `{"category":"Coding Agents / 评测","summary_zh":"基于提供的论文材料归纳研究问题与评测方法。"}`}}}})
					return
				}
				if mode.Load() == 3 {
					fmt.Fprint(w, `<html>Verification required</html>`)
					return
				}
				if mode.Load() == 4 {
					fmt.Fprint(w, `{}`)
					return
				}
				offset, _ := strconv.Atoi(catalog.First(r.URL.Query().Get("offset"), r.URL.Query().Get("f"), "0"))
				paperOffset := offset
				if mode.Load() == 6 {
					paperOffset = 0
				}
				if mode.Load() == 1 && offset > 0 {
					w.WriteHeader(503)
					return
				}
				if conf == "iclr" {
					venue := r.URL.Query().Get("content.venueid")
					if mode.Load() == 2 {
						venue = "Different.cc/2026/Conference"
					}
					note := map[string]any{"id": fmt.Sprintf("%s-%d-%d", conf, mode.Load(), paperOffset), "content": map[string]any{
						"title": map[string]any{"value": "Study shared title"}, "abstract": map[string]any{"value": "Official abstract"},
						"authors": map[string]any{"value": []string{"Alice", "Bob"}}, "keywords": map[string]any{"value": []string{"Declared keyword"}},
						"venueid": map[string]any{"value": venue}, "venue": map[string]any{"value": "Accepted paper"},
					}}
					notes, total := []any{note}, 2
					if mode.Load() == 5 && offset > 0 {
						notes = nil
					}
					if mode.Load() == 7 && offset > 0 {
						total++
					}
					json.NewEncoder(w).Encode(map[string]any{"count": total, "notes": notes})
				} else {
					stream := "icse"
					if conf == "ase" {
						stream = "kbse"
					}
					year := "2026"
					if mode.Load() == 2 {
						year = "2025"
					}
					author := any(map[string]string{"text": "Alice"})
					if offset > 0 {
						author = []any{map[string]string{"text": "Alice"}, map[string]string{"text": "Bob"}}
					}
					hit := map[string]any{"info": map[string]any{"key": fmt.Sprintf("conf/%s/paper-%d-%d", stream, mode.Load(), paperOffset),
						"title": "Study shared title", "year": year, "type": "Conference and Workshop Papers", "venue": "Published Track",
						"authors": map[string]any{"author": author}, "ee": "https://doi.org/10.1000/" + conf + strconv.Itoa(offset),
						"url": "https://dblp.org/rec/conf/" + stream + "/record"}}
					hits := []any{hit}
					if offset == 0 {
						hits = append(hits, map[string]any{"info": map[string]any{"type": "Editorship", "title": "Proceedings"}})
					}
					total := 3
					if mode.Load() == 5 && offset > 0 {
						hits = nil
					}
					if mode.Load() == 7 && offset > 0 {
						total++
					}
					json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"hits": map[string]any{"@total": strconv.Itoa(total), "hit": hits}}})
				}
			}))
			defer upstream.Close()
			local, _ := url.Parse(upstream.URL)
			original := http.DefaultTransport
			http.DefaultTransport = newsTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.Host == local.Host {
					return original.RoundTrip(r)
				}
				if r.URL.Host != "api2.openreview.net" && r.URL.Host != "dblp.org" {
					return nil, fmt.Errorf("unexpected upstream %s", r.URL)
				}
				copy := r.Clone(r.Context())
				address := *r.URL
				address.Scheme, address.Host = local.Scheme, local.Host
				copy.URL = &address
				return original.RoundTrip(copy)
			})
			t.Cleanup(func() { http.DefaultTransport = original })
			c := config.Config{Root: t.TempDir(), LLMKey: "fixture", LLMURL: upstream.URL}
			args := []string{"--conference", conf, "--year", "2026"}
			ctx := context.Background()
			for index := range 2 {
				fetchArgs := append([]string{}, args...)
				if index == 0 {
					fetchArgs = append(fetchArgs, "--url", upstream.URL+"?access_token=fixture-secret")
				}
				if err := job(ctx, c, "fetch-conf", fetchArgs); err != nil {
					t.Fatal(err)
				}
			}
			file := filepath.Join(c.Root, "top-conf/data/conferences", conf+"_2026.jsonl")
			rows, err := catalog.Rows(file)
			if err != nil || len(rows) != 2 {
				t.Fatalf("pagination/deduplication: %v rows, %v", len(rows), err)
			}
			for _, row := range rows {
				if strings.Contains(catalog.Str(row, "source_url"), "?") {
					t.Fatal("source provenance retained private query parameters", row["source_url"])
				}
			}
			for range 2 {
				if err := job(ctx, c, "summarize-conf", args); err != nil {
					t.Fatal(err)
				}
			}
			if modelCalls.Load() != 2 {
				t.Fatalf("repeated paid generation: %d", modelCalls.Load())
			}
			if err := job(ctx, c, "conference-report", args); err != nil {
				t.Fatal(err)
			}
			report, err := os.ReadFile(filepath.Join(c.Root, "top-conf/data/report", strings.ToUpper(conf)+"_2026_Report.json"))
			if err != nil || !strings.Contains(string(report), catalog.Str(rows[0], "link")) || !strings.Contains(string(report), catalog.Str(rows[1], "link")) {
				t.Fatalf("report lost papers: %v", err)
			}
			database, err := store.Open(filepath.Join(c.Root, "accounts"))
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()
			app, err := httpapi.New(c, database)
			if err != nil {
				t.Fatal(err)
			}
			recorder := httptest.NewRecorder()
			app.Handler().ServeHTTP(recorder, httptest.NewRequest("GET", "/api/papers?source=top-conf&conference="+conf+"&year=2026", nil))
			var result struct {
				Papers []catalog.Paper `json:"papers"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || recorder.Code != 200 || len(result.Papers) != 2 {
				t.Fatalf("catalog response %d: %s", recorder.Code, recorder.Body.String())
			}
			for _, paper := range result.Papers {
				if paper.Category != "Coding Agents / 评测" {
					t.Fatal("model category was lost", paper)
				}
			}
			before, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			for _, invalid := range []int32{1, 2, 3, 4, 5, 6, 7} {
				mode.Store(invalid)
				if err := job(ctx, c, "fetch-conf", args); err == nil {
					t.Fatalf("invalid/incomplete source mode %d succeeded", invalid)
				}
				after, err := os.ReadFile(file)
				if err != nil || string(before) != string(after) {
					t.Fatalf("failed source mode %d changed historical corpus: %v", invalid, err)
				}
			}
		})
	}
}
