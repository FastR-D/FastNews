package httpapi

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestArxivNewsPaginationSearchAndFacets(t *testing.T) {
	h := fixture(t)
	var data strings.Builder
	for i := 0; i < 63; i++ {
		category := "cs.AI"
		if i%2 == 0 {
			category = "cs.SE"
		}
		row := map[string]any{"_id": fmt.Sprintf("paper-%02d", i), "source": "arxiv_cs_ai", "title": fmt.Sprintf("Paper %02d", i), "categories": []string{category}}
		if i == 62 {
			row["author"] = "Alice Researcher"
			row["summary_zh"] = "智能体安全"
		}
		raw, _ := json.Marshal(row)
		data.Write(raw)
		data.WriteByte('\n')
	}
	data.WriteString(`{"_id":"non-cs","source":"arxiv_cs_ai","title":"Biology cross-list","primary_category":"q-bio.QM","categories":["cs.AI"]}` + "\n")
	dir := filepath.Join(h.app.Config.Root, "secnews/data/articles")
	if err := os.WriteFile(filepath.Join(dir, "2026-11-28.jsonl"), []byte(data.String()), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "2026-11-27.jsonl"), []byte(`{"source":"arxiv_cs_ai","categories":["cs.AI"],"title":"older-only"}`), 0600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		query                     string
		count, total, page, pages int
		first                     string
	}{
		{"", 12, 63, 1, 6, "paper-00"},
		{"&page=2", 12, 63, 2, 6, "paper-12"},
		{"&page_size=50", 50, 63, 1, 2, "paper-00"},
		{"&page=999", 3, 63, 6, 6, "paper-60"},
		{"&category=cs.SE&page=2", 12, 32, 2, 3, "paper-24"},
		{"&q=" + url.QueryEscape("ALICE 智能体"), 1, 1, 1, 1, "paper-62"},
		{"&q=older-only", 0, 0, 1, 1, ""},
		{"&category=missing", 0, 0, 1, 1, ""},
	} {
		status, body, _ := h.request(t, "GET", "/api/news?source=arxiv"+tc.query, nil, "", false)
		if status != 200 {
			t.Fatalf("%s: %d %v", tc.query, status, body)
		}
		rows := body["articles"].([]any)
		if len(rows) != tc.count || body["total"] != float64(tc.total) || body["page"] != float64(tc.page) || body["pages"] != float64(tc.pages) || body["date"] != "2026-11-28" {
			t.Fatalf("%s: unexpected page %v", tc.query, body)
		}
		if tc.first != "" && rows[0].(map[string]any)["_id"] != tc.first {
			t.Fatal(tc.query, rows[0])
		}
		facets := body["categories"].([]any)
		if len(facets) != 2 || facets[0] != "cs.AI" || facets[1] != "cs.SE" {
			t.Fatal("facets lost on filtering", body)
		}
	}
	for _, query := range []string{"page=0", "page=-1", "page=1.5", "page_size=0", "page_size=51", "page_size=all", "q=" + strings.Repeat("a", 201)} {
		status, _, _ := h.request(t, "GET", "/api/news?source=arxiv&"+query, nil, "", false)
		if status != 400 {
			t.Fatal(query, status)
		}
	}
	status, body, _ := h.request(t, "GET", "/api/news?date=2026-11-28", nil, "", false)
	if status != 200 || len(body["articles"].([]any)) != 63 {
		t.Fatal("other news clients changed", status)
	}
}

func TestArxivPaginationOrdersNewestFirst(t *testing.T) {
	h := fixture(t)
	rows := `{"_id":"old","source":"arxiv_cs_ai","categories":["cs.AI"],"published":"2026-11-20T00:00:00Z"}
{"_id":"new","source":"arxiv_cs_ai","categories":["cs.AI"],"published":"2026-11-25T00:00:00Z"}`
	if err := os.WriteFile(filepath.Join(h.app.Config.Root, "secnews/data/articles/2026-11-28.jsonl"), []byte(rows), 0600); err != nil {
		t.Fatal(err)
	}
	status, body, _ := h.request(t, "GET", "/api/news?source=arxiv&page_size=1", nil, "", false)
	if status != 200 || body["articles"].([]any)[0].(map[string]any)["_id"] != "new" {
		t.Fatal(status, body)
	}
}

func TestHomeNewsPreviewIsBoundedAndRecent(t *testing.T) {
	h := fixture(t)
	dir := filepath.Join(h.app.Config.Root, "secnews/data/articles")
	var data strings.Builder
	for i := 0; i < 12; i++ {
		raw, _ := json.Marshal(map[string]any{"_id": fmt.Sprintf("news-%02d", i), "source": "openai", "title": fmt.Sprintf("News %02d", i), "published": fmt.Sprintf("2026-11-28T%02d:00:00Z", i)})
		data.Write(raw)
		data.WriteByte('\n')
	}
	if err := os.WriteFile(filepath.Join(dir, "2026-11-28.jsonl"), []byte(data.String()), 0600); err != nil {
		t.Fatal(err)
	}
	status, res, _ := h.request(t, "GET", "/api/news?source=articles&preview=3", nil, "", false)
	if status != 200 {
		t.Fatal(status, res)
	}
	rows := res["articles"].([]any)
	if len(rows) != 3 || rows[0].(map[string]any)["_id"] != "news-11" {
		t.Fatal(rows)
	}
	for _, value := range []string{"0", "11", "x"} {
		if status, _, _ := h.request(t, "GET", "/api/news?source=articles&preview="+value, nil, "", false); status != 400 {
			t.Fatal(value, status)
		}
	}
}
