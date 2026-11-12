package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/FastR-D/FastNews/internal/ai"
	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/config"
	"github.com/FastR-D/FastNews/internal/rag"
)

// searchPapers is the read-only evidence entry point used by the repository skill.
func searchPapers(ctx context.Context, c config.Config, args []string) error {
	fs := flag.NewFlagSet("search-papers", flag.ContinueOnError)
	query := fs.String("query", "", "research direction and aliases")
	source := fs.String("source", "all", "all, top-conf or arxiv")
	category := fs.String("category", "", "exact corpus category")
	conference := fs.String("conference", "", "usenix, ieee-sp, ndss or ccs")
	year := fs.Int("year", 0, "restrict to a conference year")
	limit := fs.Int("limit", 16, "maximum evidence records (1-100)")
	if e := fs.Parse(args); e != nil {
		return e
	}
	if strings.TrimSpace(*query) == "" {
		return fmt.Errorf("--query is required")
	}
	if *source != "all" && *source != "top-conf" && *source != "arxiv" {
		return fmt.Errorf("invalid --source")
	}
	if *conference != "" && catalog.Labels[*conference] == "" {
		return fmt.Errorf("invalid --conference")
	}
	if *year != 0 && (*year < 2000 || *year > 2100) {
		return fmt.Errorf("invalid --year")
	}
	cat := &catalog.Catalog{Root: c.Root}
	svc := &ai.Service{Catalog: cat}
	request := ai.Request{Source: *source, Category: *category, Conference: *conference}
	if *year != 0 {
		request.Years = []int{*year}
	}
	pool, e := svc.Candidates(request)
	if e != nil {
		return e
	}
	retriever := &rag.Retriever{Config: c}
	items, provider, e := retriever.Search(ctx, pool, *query, min(100, max(1, *limit)))
	if e != nil {
		return e
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(map[string]any{"query": *query, "corpus_size": len(pool), "hit_count": len(items), "embedding_provider": provider, "items": items})
}
