package jobs

import (
	"context"
	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/config"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRelayTransportFallbackAndAccessRejection(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "ssh"), []byte("#!/bin/sh\n/bin/cat >/dev/null\nprintf relay-response\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	p := New(config.Config{FetchRelaySSHConfig: "/private/ssh_config"})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/blocked" {
			w.WriteHeader(403)
		} else {
			w.WriteHeader(502)
		}
	}))
	defer server.Close()
	data, route, err := p.fetchSource(context.Background(), catalog.NewsSource{URL: server.URL, Transport: "auto"})
	if err != nil || string(data) != "relay-response" || route != "relay" {
		t.Fatal(string(data), route, err)
	}
	_, route, err = p.fetchSource(context.Background(), catalog.NewsSource{URL: server.URL + "/blocked", Transport: "auto"})
	if err == nil || route != "direct" {
		t.Fatal("access restriction was retried", route, err)
	}
	if _, err = relayFetch(context.Background(), "", server.URL); err == nil {
		t.Fatal("missing relay configuration accepted")
	}
}
func TestRelayCancellation(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "ssh"), []byte("#!/bin/sh\nexec /bin/sleep 20\n"), 0700)
	t.Setenv("PATH", dir)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := relayFetch(ctx, "/private/config", "https://example.org/feed"); err == nil || time.Since(start) > time.Second {
		t.Fatal("relay cancellation failed", err)
	}
}
