package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const archiveFixture = "test release archive"

func newReceiver(activate func(string) error) *receiver {
	return &receiver{
		authorization: "Bearer " + strings.Repeat("a", 64),
		profile:       json.RawMessage(`{"repository":"FastR-D/FastNews"}`),
		runtime:       map[string]string{"FASTNEWS_PORT": "8788"},
		launcher:      []byte("trusted launcher"),
		activate:      activate,
		busy:          make(chan struct{}, 1),
	}
}

func uploadRequest(url string) *http.Request {
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(archiveFixture))
	if err != nil {
		panic(err)
	}
	req.Header.Set("Authorization", "Bearer "+strings.Repeat("a", 64))
	req.Header.Set("Content-Type", "application/gzip")
	req.Header.Set("X-FastDeploy-Tag", "v2026.11.19.2")
	req.Header.Set("X-FastDeploy-Sha", strings.Repeat("b", 40))
	req.Header.Set("X-FastDeploy-Run-Id", "44523949907")
	req.Header.Set("X-FastDeploy-Archive-Sha256", fmt.Sprintf("%x", sha256.Sum256([]byte(archiveFixture))))
	return req
}

func TestUploadRejectsInvalidRequests(t *testing.T) {
	receiver := newReceiver(func(string) error { t.Fatal("invalid upload triggered activation"); return nil })
	for _, test := range []struct {
		name   string
		change func(*http.Request)
		status int
	}{
		{"other route", func(req *http.Request) { req.URL.Path = "/api/health" }, 404},
		{"method", func(req *http.Request) { req.Method = http.MethodGet }, 405},
		{"no token", func(req *http.Request) { req.Header.Del("Authorization") }, 401},
		{"wrong token", func(req *http.Request) { req.Header.Set("Authorization", "Bearer wrong") }, 401},
		{"media type", func(req *http.Request) { req.Header.Set("Content-Type", "application/json") }, 415},
		{"oversize", func(req *http.Request) { req.ContentLength = maxArchiveSize + 1 }, 413},
		{"chunked", func(req *http.Request) { req.ContentLength = -1 }, 413},
		{"invalid tag", func(req *http.Request) { req.Header.Set("X-FastDeploy-Tag", "../outside") }, 400},
		{"overflowing run ID", func(req *http.Request) { req.Header.Set("X-FastDeploy-Run-Id", "9999999999999999999") }, 400},
		{"truncated body", func(req *http.Request) { req.ContentLength++ }, 400},
		{"checksum mismatch", func(req *http.Request) { req.Header.Set("X-FastDeploy-Archive-Sha256", strings.Repeat("f", 64)) }, 422},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := uploadRequest(uploadPath)
			test.change(req)
			reply := httptest.NewRecorder()
			receiver.ServeHTTP(reply, req)
			if reply.Code != test.status {
				t.Errorf("HTTP %d, want %d: %s", reply.Code, test.status, reply.Body)
			}
		})
	}
}

func TestHTTPSUploadUsesServerConfigurationAndCleansBundle(t *testing.T) {
	bundles := make(chan string, 1)
	receiver := newReceiver(func(bundle string) error {
		bundles <- bundle
		var request deployment
		if err := readJSON(filepath.Join(bundle, "request.json"), &request); err != nil {
			return err
		}
		if request.App != "fastnews" || request.Repository != repository || request.RunID != 44523949907 || request.Runtime["FASTNEWS_PORT"] != "8788" || string(request.Profile) != `{"repository":"FastR-D/FastNews"}` {
			return errors.New("unexpected deployment parameters")
		}
		for name, expected := range map[string]string{"launch.py": "trusted launcher", "release.tar.gz": archiveFixture} {
			data, err := os.ReadFile(filepath.Join(bundle, name))
			if err != nil || string(data) != expected {
				return fmt.Errorf("unexpected %s: %v", name, err)
			}
		}
		return nil
	})
	server := httptest.NewTLSServer(receiver)
	defer server.Close()
	response, err := server.Client().Do(uploadRequest(server.URL + uploadPath))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal(response.Status)
	}
	select {
	case bundle := <-bundles:
		if _, err := os.Stat(bundle); !os.IsNotExist(err) {
			t.Fatalf("temporary bundle not cleaned: %v", err)
		}
	default:
		t.Fatal("activation did not receive a bundle")
	}
}

func TestConcurrentUploadAndActivationError(t *testing.T) {
	started, finish, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	receiver := newReceiver(func(string) error {
		close(started)
		<-finish
		return errors.New("private diagnostics")
	})
	first := httptest.NewRecorder()
	go func() { defer close(done); receiver.ServeHTTP(first, uploadRequest(uploadPath)) }()
	<-started
	second := httptest.NewRecorder()
	receiver.ServeHTTP(second, uploadRequest(uploadPath))
	close(finish)
	<-done
	if second.Code != 409 || first.Code != 502 {
		t.Fatalf("unexpected upload responses: %d, %d", first.Code, second.Code)
	}
	body, err := io.ReadAll(first.Result().Body)
	if err != nil || strings.Contains(string(body), "private diagnostics") {
		t.Fatalf("unexpected error body: %q, %v", body, err)
	}
}
