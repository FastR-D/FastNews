package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Root, WebDir, DataDir, Host, Port, PublicPath, PublicOrigin, ResearchURL, FastReadURL string
	ResearchCookie                                                                        string
	CookieSecure, RequireLogin                                                            bool
	CASIssuer, CASClientID, CASSecret, CASRedirect, VaultKey                              string
	CASEnabled, CASLogin, CASLink, CASLoopback, ResearchConnect                           bool
	LLMKey, LLMURL, LLMModel, EmbeddingURL, EmbeddingModel, EmbeddingProvider             string
}

func Env(key, fallback string) string {
	if s, ok := os.LookupEnv(key); ok && strings.TrimSpace(s) != "" {
		return strings.TrimSpace(s)
	}
	return fallback
}
func Load() (Config, error) {
	_ = godotenv.Load()
	root, err := filepath.Abs(Env("FASTNEWS_ROOT", "."))
	if err != nil {
		return Config{}, err
	}
	c := Config{
		ResearchCookie:    Env("FASTRESEARCH_COOKIE_NAME", "fr_session"),
		Root:              root,
		WebDir:            Env("FASTNEWS_WEB_DIR", "web/dist"),
		DataDir:           Env("FASTNEWS_DATA_DIR", ".fastnews-data"),
		Host:              Env("FASTNEWS_HOST", "127.0.0.1"),
		Port:              Env("FASTNEWS_PORT", "4173"),
		PublicPath:        strings.TrimRight(Env("FASTNEWS_PUBLIC_PATH", ""), "/"),
		PublicOrigin:      strings.TrimRight(Env("FASTNEWS_PUBLIC_ORIGIN", ""), "/"),
		ResearchURL:       strings.TrimRight(Env("FASTRESEARCH_API_URL", "http://127.0.0.1:8787"), "/"),
		FastReadURL:       strings.TrimRight(Env("FASTREAD_URL", "http://127.0.0.1:3015"), "/"),
		CookieSecure:      Env("FASTNEWS_COOKIE_SECURE", "true") == "true",
		RequireLogin:      Env("FASTNEWS_REQUIRE_LOGIN", "false") == "true",
		CASIssuer:         Env("FASTNEWS_FASTCAS_ISSUER", ""),
		CASClientID:       Env("FASTNEWS_FASTCAS_CLIENT_ID", ""),
		CASSecret:         Env("FASTNEWS_FASTCAS_CLIENT_SECRET", ""),
		CASRedirect:       Env("FASTNEWS_FASTCAS_REDIRECT_URI", ""),
		VaultKey:          Env("FASTNEWS_FASTCAS_VAULT_KEY", ""),
		CASLogin:          Env("FASTNEWS_FASTCAS_LOGIN_ENABLED", "true") != "false",
		CASLink:           Env("FASTNEWS_FASTCAS_LINK_ENABLED", "true") != "false",
		CASLoopback:       Env("FASTNEWS_FASTCAS_ALLOW_LOOPBACK_HTTP", "false") == "true",
		ResearchConnect:   Env("FASTNEWS_FASTCAS_RESEARCH_CONNECT", "false") == "true",
		LLMKey:            Env("OPENAI_API_KEY", ""),
		LLMURL:            strings.TrimRight(Env("OPENAI_BASE_URL", "https://api.openai.com/v1"), "/"),
		LLMModel:          Env("LLM_MODEL", "gemini-3-flash-preview"),
		EmbeddingURL:      Env("RAG_EMBEDDING_URL", ""),
		EmbeddingModel:    Env("EMBEDDING_MODEL", "text-embedding-3-small"),
		EmbeddingProvider: Env("RAG_EMBEDDING_PROVIDER", "auto"),
	}
	if c.PublicPath != "" && !strings.HasPrefix(c.PublicPath, "/") {
		c.PublicPath = "/" + c.PublicPath
	}
	if strings.Contains(c.PublicPath, "..") || strings.ContainsAny(c.PublicPath, "?#\\") {
		return c, fmt.Errorf("invalid FASTNEWS_PUBLIC_PATH")
	}
	if !filepath.IsAbs(c.WebDir) {
		c.WebDir = filepath.Join(root, c.WebDir)
	}
	if !filepath.IsAbs(c.DataDir) {
		c.DataDir = filepath.Join(root, c.DataDir)
	}
	fields := []string{c.CASIssuer, c.CASClientID, c.CASSecret, c.CASRedirect}
	n := 0
	for _, s := range fields {
		if s != "" {
			n++
		}
	}
	if Env("FASTNEWS_FASTCAS_ENABLED", "true") != "false" {
		if n > 0 && n < 4 {
			return c, fmt.Errorf("FastCAS requires all four connection settings")
		}
		c.CASEnabled = n == 4
	}
	if err := Origin(c.ResearchURL); err != nil {
		return c, fmt.Errorf("FASTRESEARCH_API_URL: %w", err)
	}
	u, e := url.Parse(c.FastReadURL)
	if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return c, fmt.Errorf("invalid FASTREAD_URL")
	}
	for _, segment := range strings.Split(u.EscapedPath(), "/") {
		if segment == "" {
			continue
		}
		decoded, err := url.PathUnescape(segment)
		if err != nil || decoded == "." || decoded == ".." || strings.ContainsAny(decoded, "/\\") {
			return c, fmt.Errorf("invalid FASTREAD_URL path")
		}
	}
	return c, nil
}
func Origin(raw string) error {
	u, e := url.Parse(raw)
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" {
		return fmt.Errorf("origin required")
	}
	ip := net.ParseIP(u.Hostname())
	loop := u.Hostname() == "localhost" || (ip != nil && ip.IsLoopback())
	if u.Scheme != "https" && !(u.Scheme == "http" && loop) {
		return fmt.Errorf("HTTPS required outside loopback")
	}
	return nil
}
func (c Config) Addr() string { return net.JoinHostPort(c.Host, c.Port) }
