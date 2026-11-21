package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
)

const repository = "FastR-D/FastNews"
const uploadPath = "/__fastnews/deploy"
const maxArchiveSize = 64 << 20

var (
	tagPattern    = regexp.MustCompile(`^v[0-9][A-Za-z0-9._-]{0,99}$`)
	shaPattern    = regexp.MustCompile(`^[a-f0-9]{40}$`)
	digestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
	runPattern    = regexp.MustCompile(`^[1-9][0-9]{0,18}$`)
)

type receiver struct {
	authorization string
	profile       json.RawMessage
	runtime       map[string]string
	launcher      []byte
	activate      func(string) error
	busy          chan struct{}
}

type deployment struct {
	App        string            `json:"app"`
	Profile    json.RawMessage   `json:"profile"`
	Repository string            `json:"repository"`
	Tag        string            `json:"tag"`
	SHA        string            `json:"sha"`
	RunID      int64             `json:"run_id"`
	Digest     string            `json:"archive_sha256"`
	Runtime    map[string]string `json:"env"`
}

func (s *receiver) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if req.URL.Path != uploadPath || req.URL.RawQuery != "" {
		http.NotFound(w, req)
		return
	}
	if req.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if subtle.ConstantTimeCompare([]byte(req.Header.Get("Authorization")), []byte(s.authorization)) != 1 {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if req.Header.Get("Content-Type") != "application/gzip" || req.Header.Get("Content-Encoding") != "" {
		http.Error(w, "expected an application/gzip release archive", http.StatusUnsupportedMediaType)
		return
	}
	if req.ContentLength <= 0 || req.ContentLength > maxArchiveSize {
		http.Error(w, "expected a non-empty archive of at most 64 MiB", http.StatusRequestEntityTooLarge)
		return
	}
	tag, sha := req.Header.Get("X-FastDeploy-Tag"), req.Header.Get("X-FastDeploy-Sha")
	digest, run := req.Header.Get("X-FastDeploy-Archive-Sha256"), req.Header.Get("X-FastDeploy-Run-Id")
	runID, err := strconv.ParseInt(run, 10, 64)
	if !tagPattern.MatchString(tag) || !shaPattern.MatchString(sha) || !digestPattern.MatchString(digest) || !runPattern.MatchString(run) || err != nil {
		http.Error(w, "invalid release metadata", http.StatusBadRequest)
		return
	}
	select {
	case s.busy <- struct{}{}:
		defer func() { <-s.busy }()
	default:
		http.Error(w, "another upload or activation is in progress", http.StatusConflict)
		return
	}
	input := deployment{"fastnews", s.profile, repository, tag, sha, runID, digest, s.runtime}
	body := http.MaxBytesReader(w, req.Body, maxArchiveSize)
	defer body.Close()
	status, err := s.deploy(body, req.ContentLength, input)
	if err != nil {
		slog.Warn("release rejected", "tag", tag, "run", runID, "status", status, "error", err)
		http.Error(w, http.StatusText(status), status)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, "release active and healthy\n")
}

func (s *receiver) deploy(body io.Reader, expected int64, input deployment) (int, error) {
	bundle, err := os.MkdirTemp("", "fastnews-release-")
	if err != nil {
		return http.StatusInternalServerError, err
	}
	defer os.RemoveAll(bundle)
	archive, err := os.OpenFile(filepath.Join(bundle, "release.tar.gz"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return http.StatusInternalServerError, err
	}
	hash := sha256.New()
	size, copyErr := io.Copy(io.MultiWriter(archive, hash), body)
	closeErr := archive.Close()
	if copyErr != nil || size != expected {
		return http.StatusBadRequest, errors.New("archive upload incomplete")
	}
	if closeErr != nil {
		return http.StatusInternalServerError, closeErr
	}
	if hex.EncodeToString(hash.Sum(nil)) != input.Digest {
		return http.StatusUnprocessableEntity, errors.New("archive checksum mismatch")
	}
	metadata, err := json.Marshal(input)
	if err != nil {
		return http.StatusInternalServerError, err
	}
	if err := os.WriteFile(filepath.Join(bundle, "request.json"), metadata, 0600); err != nil {
		return http.StatusInternalServerError, err
	}
	if err := os.WriteFile(filepath.Join(bundle, "launch.py"), s.launcher, 0600); err != nil {
		return http.StatusInternalServerError, err
	}
	slog.Info("archive received; activating", "tag", input.Tag, "run", input.RunID, "bytes", size)
	if err := s.activate(bundle); err != nil {
		return http.StatusBadGateway, err
	}
	slog.Info("release activated", "tag", input.Tag, "run", input.RunID)
	return http.StatusOK, nil
}
