package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func main() {
	configDir := flag.String("config-dir", "", "directory containing token and runtime.json")
	fastDeploy := flag.String("fastdeploy-dir", "", "trusted FastDeploy checkout on the server")
	flag.Parse()
	if err := serve(*configDir, *fastDeploy); err != nil {
		slog.Error("deployment receiver stopped", "error", err)
		os.Exit(1)
	}
}

func serve(configDir, fastDeploy string) error {
	if !filepath.IsAbs(configDir) || !filepath.IsAbs(fastDeploy) {
		return errors.New("config-dir and fastdeploy-dir must be absolute paths")
	}
	tokenBytes, err := os.ReadFile(filepath.Join(configDir, "token"))
	if err != nil {
		return err
	}
	token := strings.TrimSpace(string(tokenBytes))
	if !digestPattern.MatchString(token) {
		return errors.New("deployment token must be 64 lowercase hexadecimal characters")
	}
	var profiles map[string]json.RawMessage
	if err := readJSON(filepath.Join(fastDeploy, "config", "apps.json"), &profiles); err != nil {
		return err
	}
	profile := profiles["fastnews"]
	var rules struct {
		Repository string            `json:"repository"`
		Unit       string            `json:"unit"`
		LegacyApp  string            `json:"legacy_app"`
		Required   []string          `json:"required_env"`
		Fixed      map[string]string `json:"fixed_env"`
		Postgres   string            `json:"postgres_env"`
	}
	if err := json.Unmarshal(profile, &rules); err != nil || rules.Repository != repository || rules.Unit != "fastnews.service" || rules.LegacyApp != "news" {
		return errors.New("FastDeploy checkout does not contain the expected FastNews profile")
	}
	var runtime map[string]string
	if err := readJSON(filepath.Join(configDir, "runtime.json"), &runtime); err != nil {
		return err
	}
	if rules.Postgres != "" && runtime[rules.Postgres] != "" {
		return errors.New("PostgreSQL credentials belong in the FastDeploy server credential directory")
	}
	for _, name := range rules.Required {
		if name != rules.Postgres && runtime[name] == "" {
			return fmt.Errorf("missing runtime variable %s", name)
		}
	}
	for name, value := range rules.Fixed {
		if runtime[name] != value {
			return fmt.Errorf("runtime variable %s must match FastDeploy profile", name)
		}
	}
	if runtime["FASTNEWS_FASTCAS_ENABLED"] != "false" && (runtime["FASTNEWS_FASTCAS_CLIENT_SECRET"] == "" || runtime["FASTNEWS_FASTCAS_ISSUER"] == "" || runtime["FASTNEWS_FASTCAS_CLIENT_ID"] == "" || runtime["FASTNEWS_FASTCAS_REDIRECT_URI"] == "") {
		return errors.New("FastCAS requires all four connection settings; explicitly disable it if unused")
	}
	scripts := filepath.Join(fastDeploy, "scripts")
	launcher, err := os.ReadFile(filepath.Join(scripts, "launch.py"))
	if err != nil {
		return err
	}
	remote := filepath.Join(scripts, "remote.py")
	if _, err := os.Stat(remote); err != nil {
		return err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	receiver := &receiver{
		authorization: "Bearer " + token,
		profile:       profile,
		runtime:       runtime,
		launcher:      launcher,
		activate: func(bundle string) error {
			ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
			defer cancel()
			command := exec.CommandContext(ctx, "/usr/bin/python3", "-B", remote, bundle)
			command.Env = []string{"HOME=" + home, "PATH=/usr/bin:/bin", "LANG=C.UTF-8"}
			command.Stdout, command.Stderr = os.Stdout, os.Stderr
			command.Cancel = func() error { return command.Process.Signal(syscall.SIGTERM) }
			command.WaitDelay = 90 * time.Second
			err := command.Run()
			if ctx.Err() != nil {
				return fmt.Errorf("activation timed out: %w", ctx.Err())
			}
			return err
		},
		busy: make(chan struct{}, 1),
	}
	server := &http.Server{
		Addr:              "127.0.0.1:8790",
		Handler:           receiver,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       5 * time.Minute,
		WriteTimeout:      20 * time.Minute,
		IdleTimeout:       15 * time.Second,
		MaxHeaderBytes:    8 << 10,
	}
	slog.Info("deployment receiver listening", "address", server.Addr)
	stop, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	started := make(chan error, 1)
	go func() { started <- server.ListenAndServe() }()
	select {
	case err := <-started:
		return err
	case <-stop.Done():
		shutdown, done := context.WithTimeout(context.Background(), 20*time.Minute)
		defer done()
		return server.Shutdown(shutdown)
	}
}

func readJSON(path string, value any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, value); err != nil {
		return fmt.Errorf("invalid JSON in %s", filepath.Base(path))
	}
	return nil
}
