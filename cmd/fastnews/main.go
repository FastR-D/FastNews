package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/FastR-D/FastNews/internal/config"
	"github.com/FastR-D/FastNews/internal/httpapi"
	"github.com/FastR-D/FastNews/internal/store"
	"golang.org/x/term"
)

func main() {
	if e := run(); e != nil {
		if errors.Is(e, flag.ErrHelp) {
			return
		}
		slog.Error("fastnews stopped", "error", e)
		os.Exit(1)
	}
}
func run() error {
	c, e := config.Load()
	if e != nil {
		return e
	}
	args := os.Args[1:]
	command := "serve"
	if len(args) > 0 {
		command = args[0]
		args = args[1:]
	}
	if command == "version" {
		fmt.Println("FastNews Go", runtime.Version())
		return nil
	}
	if command == "help" || command == "--help" || command == "-h" {
		fmt.Println("FastNews: Go API + React workspace")
		fmt.Println("Commands: serve, create, invite, recovery, version, index")
		fmt.Println("Data jobs: fetch-news, daily-summary, newspaper, weekly-report, fetch-conf, summarize-conf, conference-report, fetch-awards, enrich-metrics, update-range")
		fmt.Println("Research: search-papers, field-briefing, summary-brief")
		fmt.Println("Use fastnews <command> --help for options.")
		return nil
	}
	if command != "serve" && command != "create" && command != "invite" && command != "recovery" {
		return job(context.Background(), c, command, args)
	}
	fs := flag.NewFlagSet(command, flag.ContinueOnError)
	root := fs.String("root", c.DataDir, "account data directory")
	email := fs.String("email", "", "account email")
	name := fs.String("name", "", "display name")
	if e = fs.Parse(args); e != nil {
		return e
	}
	s, e := store.Open(*root)
	if e != nil {
		return e
	}
	defer s.Close()
	switch command {
	case "create":
		password := os.Getenv("FASTNEWS_INITIAL_PASSWORD")
		if password == "" {
			fmt.Fprint(os.Stderr, "Password: ")
			b, e := term.ReadPassword(int(os.Stdin.Fd()))
			fmt.Fprintln(os.Stderr)
			if e != nil {
				return e
			}
			password = string(b)
		}
		id, e := s.Create(*email, password, *name)
		if e == nil {
			fmt.Println(id)
		}
		return e
	case "invite", "recovery":
		token, e := s.Issue(command, *email)
		if e == nil {
			fmt.Println(token)
		}
		return e
	case "serve":
		app, e := httpapi.New(c, s)
		if e != nil {
			return e
		}
		server := &http.Server{Addr: c.Addr(), Handler: app.Handler(), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 5 * time.Minute, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		done := make(chan error, 1)
		go func() {
			slog.Info("FastNews listening", "address", c.Addr(), "base", c.PublicPath)
			done <- server.ListenAndServe()
		}()
		select {
		case e := <-done:
			if e == http.ErrServerClosed {
				return nil
			}
			return e
		case <-ctx.Done():
			shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			return server.Shutdown(shutdown)
		}
	default:
		return fmt.Errorf("unknown command %q (serve, create, invite, recovery)", command)
	}
}
