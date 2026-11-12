package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"encoding/json"
	"github.com/FastR-D/FastNews/internal/ai"
	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/config"
	"github.com/FastR-D/FastNews/internal/jobs"
	"github.com/FastR-D/FastNews/internal/rag"
)

func job(ctx context.Context, c config.Config, command string, args []string) error {
	if command == "search-papers" {
		return searchPapers(ctx, c, args)
	}
	fs := flag.NewFlagSet(command, flag.ContinueOnError)
	source := fs.String("source", "bleepingcomputer", "RSS source or RAG source")
	day := fs.String("date", "", "article date")
	conf := fs.String("conference", "usenix", "conference identifier")
	year := fs.Int("year", 2026, "conference year")
	rawURL := fs.String("url", "", "override official source URL")
	days := fs.Int("days", 7, "weekly report window")
	all := fs.Bool("all", false, "process every article date")
	pdf := fs.Bool("pdf", false, "also export PDF using Chromium")
	format := fs.String("format", "json", "output: json or text")
	query := fs.String("query", "", "research direction")
	limit := fs.Int("limit", 12, "recommended paper count")
	since := fs.Int("since", 2023, "first conference year")
	until := fs.Int("until", 2026, "last conference year")
	if e := fs.Parse(args); e != nil {
		return e
	}
	p := jobs.New(c)
	switch command {
	case "fetch-awards":
		return p.Awards(ctx, *conf, *year, *rawURL)
	case "enrich-metrics":
		return p.Metrics(ctx, *conf, *year, *limit)
	case "fetch-news":
		return p.FetchNews(ctx, *source, *rawURL)
	case "daily-summary":
		if *all {
			return p.DailyAll(ctx)
		}
		return p.Daily(ctx, *day)
	case "newspaper":
		return p.Newspaper(ctx, *day)
	case "weekly-report":
		return p.Weekly(*days, *pdf)
	case "fetch-conf":
		return p.FetchConference(ctx, *conf, *year, *rawURL)
	case "summarize-conf":
		return p.SummarizeConference(ctx, *conf, *year)
	case "conference-report":
		return p.ConferenceReport(*conf, *year, *pdf)
	case "update-range":
		if *since > *until || *until-*since > 20 {
			return fmt.Errorf("invalid year range")
		}
		for y := *since; y <= *until; y++ {
			for _, conference := range []string{"usenix", "ieee-sp", "ndss", "ccs"} {
				fmt.Fprintln(os.Stderr, conference, strconv.Itoa(y))
				if e := p.FetchConference(ctx, conference, y, ""); e != nil {
					return e
				}
				if e := p.SummarizeConference(ctx, conference, y); e != nil {
					return e
				}
				p.Catalog.Invalidate()
				if e := p.ConferenceReport(conference, y, *pdf); e != nil {
					return e
				}
			}
		}
		return nil
	case "field-briefing", "summary-brief":
		cat := &catalog.Catalog{Root: c.Root}
		svc := &ai.Service{Config: c, Catalog: cat, RAG: &rag.Retriever{Config: c}}
		src := *source
		if src == "bleepingcomputer" {
			src = "all"
			if command == "summary-brief" {
				src = "top-conf"
			}
		}
		v, e := svc.Run(ctx, command, ai.Request{Query: *query, Source: src, Limit: *limit})
		if e != nil {
			return e
		}
		if *format == "text" {
			fmt.Fprintln(os.Stdout, v["query"])
			fmt.Fprintln(os.Stdout, v["coverage"])
			if warning, ok := v["warning"]; ok {
				fmt.Fprintln(os.Stdout, warning)
			}
			if papers, ok := v["papers"].([]catalog.Paper); ok {
				for i, p := range papers {
					fmt.Fprintf(os.Stdout, "%d. %s\n   %s\n   %s\n", i+1, p.Title, p.Summary, p.Link)
				}
			}
			return nil
		}
		if *format != "json" {
			return fmt.Errorf("format must be json or text")
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(v)
	case "index":
		reports, e := p.Catalog.Reports()
		if e != nil {
			return e
		}
		papers, e := p.Catalog.Papers()
		if e != nil {
			return e
		}
		fmt.Fprintf(os.Stdout, "%d reports, %d papers; React index: %s\n", len(reports), len(papers), filepath.Join(c.WebDir, "index.html"))
		return nil
	}
	return fmt.Errorf("unknown job %q", command)
}
