package httpapi

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/store"
)

func newsPageNumber(r *http.Request, key string, fallback, maximum int) (int, error) {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > maximum {
		return 0, store.Fail(400, "分页参数无效")
	}
	return n, nil
}

// arXiv responses are bounded by default, including direct API links without
// explicit page parameters. Filter the complete day's corpus before slicing.
func (s *Server) replyNews(w http.ResponseWriter, r *http.Request, day string, rows []map[string]any) error {
	if r.URL.Query().Get("source") != "arxiv" {
		if r.URL.Query().Has("preview") {
			limit, err := newsPageNumber(r, "preview", 3, 10)
			if err != nil {
				return err
			}
			rows = append([]map[string]any{}, rows...)
			sort.SliceStable(rows, func(i, j int) bool { return catalog.Str(rows[i], "published") > catalog.Str(rows[j], "published") })
			rows = rows[:min(limit, len(rows))]
		}
		reply(w, r, 200, map[string]any{"date": day, "articles": rows})
		return nil
	}
	page, err := newsPageNumber(r, "page", 1, 1000000000)
	if err != nil {
		return err
	}
	size, err := newsPageNumber(r, "page_size", 12, 50)
	if err != nil {
		return err
	}
	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	if utf8.RuneCountInString(query) > 200 {
		return store.Fail(400, "搜索关键词最多 200 字")
	}
	terms := strings.Fields(query)
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	facets := map[string]bool{}
	filtered := []map[string]any{}
	for _, row := range rows {
		categories := newsCategories(row["categories"])
		matchesCategory := category == ""
		for _, name := range categories {
			facets[name] = true
			if name == category {
				matchesCategory = true
			}
		}
		if !matchesCategory {
			continue
		}
		text := strings.ToLower(strings.Join([]string{catalog.Str(row, "title"), catalog.Str(row, "title_zh"), catalog.Str(row, "author"), catalog.Str(row, "description"), catalog.Str(row, "summary_zh"), catalog.Str(row, "link"), strings.Join(categories, " ")}, " "))
		matches := true
		for _, term := range terms {
			if !strings.Contains(text, term) {
				matches = false
				break
			}
		}
		if matches {
			filtered = append(filtered, row)
		}
	}
	sort.SliceStable(filtered, func(i, j int) bool {
		return catalog.Str(filtered[i], "published") > catalog.Str(filtered[j], "published")
	})
	categories := make([]string, 0, len(facets))
	for name := range facets {
		categories = append(categories, name)
	}
	sort.Strings(categories)
	total := len(filtered)
	pages := max(1, (total+size-1)/size)
	page = min(page, pages)
	start := (page - 1) * size
	reply(w, r, 200, map[string]any{"date": day, "articles": filtered[start:min(start+size, total)], "total": total, "page": page, "pageSize": size, "pages": pages, "categories": categories})
	return nil
}

func newsCategories(value any) []string {
	out := []string{}
	switch values := value.(type) {
	case []string:
		return values
	case []any:
		for _, value := range values {
			if name, ok := value.(string); ok && name != "" {
				out = append(out, name)
			}
		}
	}
	return out
}
