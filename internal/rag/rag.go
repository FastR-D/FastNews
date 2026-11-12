// Package rag performs vector retrieval. Remote embeddings are opt-in; the
// deterministic offline provider never turns a failed request into lexical ranking.
package rag

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/config"
	"golang.org/x/crypto/blake2b"
	"io"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var tokenRE = regexp.MustCompile(`[a-z0-9]+(?:[./_\-][a-z0-9]+)*|[\x{4e00}-\x{9fff}]`)

func Hash(text string) []float64 {
	v := make([]float64, 128)
	for _, token := range tokenRE.FindAllString(strings.ToLower(text), -1) {
		grams := []string{token}
		if len(token) > 3 && token[0] < 128 {
			for i := 0; i < len(token)-2; i++ {
				grams = append(grams, token[i:i+3])
			}
		}
		for _, g := range grams {
			h, _ := blake2b.New(8, nil)
			h.Write([]byte(g))
			b := h.Sum(nil)
			slot := binary.BigEndian.Uint32(b[:4]) % 128
			sign := 1.0
			if b[4]&1 == 1 {
				sign = -1
			}
			v[slot] += sign
		}
	}
	return normalize(v)
}
func normalize(v []float64) []float64 {
	norm := 0.0
	for _, x := range v {
		norm += x * x
	}
	if norm > 0 {
		norm = math.Sqrt(norm)
		for i := range v {
			v[i] /= norm
		}
	}
	return v
}
func cosine(a, b []float64) float64 {
	if len(a) != len(b) {
		return 0
	}
	v := 0.0
	for i := range a {
		v += a[i] * b[i]
	}
	return v
}
func Text(p catalog.Paper) string {
	return strings.Join([]string{p.Title, p.TitleZH, catalog.Clip(p.Summary, 700), catalog.Clip(p.SearchSummary, 1000), p.Author, p.Category, p.Venue}, "\n")
}

type cachedIndex struct {
	vectors  [][]float64
	provider string
}
type Retriever struct {
	cache    map[string]cachedIndex
	Config   config.Config
	mu       sync.Mutex
	key      string
	vectors  [][]float64
	provider string
}

func (r *Retriever) remote(ctx context.Context, texts []string) ([][]float64, error) {
	out := [][]float64{}
	endpoint := r.Config.EmbeddingURL
	if endpoint == "" {
		endpoint = r.Config.LLMURL
	}
	endpoint = strings.TrimRight(endpoint, "/")
	if !strings.HasSuffix(endpoint, "/embeddings") {
		endpoint += "/embeddings"
	}
	for start := 0; start < len(texts); start += 64 {
		end := min(start+64, len(texts))
		b, _ := json.Marshal(map[string]any{"model": r.Config.EmbeddingModel, "input": texts[start:end]})
		req, e := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(b))
		if e != nil {
			return nil, e
		}
		req.Header.Set("Authorization", "Bearer "+r.Config.LLMKey)
		req.Header.Set("Content-Type", "application/json")
		client := &http.Client{Timeout: 90 * time.Second}
		resp, e := client.Do(req)
		if e != nil {
			return nil, e
		}
		raw, e := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
		resp.Body.Close()
		if e != nil || resp.StatusCode != 200 {
			return nil, fmt.Errorf("embedding request failed")
		}
		var v struct {
			Data []struct {
				Index     int       `json:"index"`
				Embedding []float64 `json:"embedding"`
			} `json:"data"`
		}
		if json.Unmarshal(raw, &v) != nil || len(v.Data) != end-start {
			return nil, fmt.Errorf("invalid embeddings")
		}
		sort.Slice(v.Data, func(i, j int) bool { return v.Data[i].Index < v.Data[j].Index })
		for i, row := range v.Data {
			if row.Index != i || len(row.Embedding) == 0 || (len(out) > 0 && len(row.Embedding) != len(out[0])) {
				return nil, fmt.Errorf("invalid embedding index")
			}
			for _, x := range row.Embedding {
				if math.IsNaN(x) || math.IsInf(x, 0) {
					return nil, fmt.Errorf("invalid embedding value")
				}
			}
			out = append(out, normalize(row.Embedding))
		}
	}
	return out, nil
}
func (r *Retriever) Search(ctx context.Context, papers []catalog.Paper, query string, limit int) ([]catalog.Paper, string, error) {
	if len(papers) == 0 || strings.TrimSpace(query) == "" {
		return []catalog.Paper{}, "hash", nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	texts := make([]string, len(papers))
	all := strings.Builder{}
	for i, p := range papers {
		texts[i] = Text(p)
		all.WriteString(p.ID + texts[i])
	}
	digest := blake2b.Sum256([]byte(all.String()))
	key := hex.EncodeToString(digest[:])
	remote := r.Config.EmbeddingURL != "" || r.Config.EmbeddingProvider == "openai" || r.Config.EmbeddingProvider == "remote"
	if r.Config.EmbeddingProvider == "hash" || r.Config.EmbeddingProvider == "offline" || r.Config.EmbeddingProvider == "local" {
		remote = false
	}
	var q []float64
	if r.key != key {
		if r.cache == nil {
			r.cache = map[string]cachedIndex{}
		}
		if r.key != "" {
			if len(r.cache) >= 4 {
				for old := range r.cache {
					delete(r.cache, old)
					break
				}
			}
			r.cache[r.key] = cachedIndex{r.vectors, r.provider}
		}
		if hit, ok := r.cache[key]; ok {
			r.key = key
			r.vectors = hit.vectors
			r.provider = hit.provider
		}
	}
	if r.key != key {
		r.provider = "hash"
		r.vectors = nil
		if remote {
			v, e := r.remote(ctx, texts)
			if e == nil {
				r.vectors = v
				r.provider = "openai"
			}
		}
		if r.vectors == nil {
			for _, text := range texts {
				r.vectors = append(r.vectors, Hash(text))
			}
		}
		r.key = key
	}
	if r.provider == "openai" {
		v, e := r.remote(ctx, []string{query})
		if e == nil && len(v[0]) == len(r.vectors[0]) {
			q = v[0]
		} else { // Rebuild both sides together; never compare remote and offline vectors.
			r.provider = "hash"
			r.vectors = nil
			for _, text := range texts {
				r.vectors = append(r.vectors, Hash(text))
			}
		}
	}
	if q == nil {
		q = Hash(query)
	}
	out := append([]catalog.Paper(nil), papers...)
	for i := range out {
		out[i].Score = cosine(q, r.vectors[i])
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score == out[j].Score {
			return out[i].Year > out[j].Year
		}
		return out[i].Score > out[j].Score
	})
	return out[:min(max(limit, 0), len(out))], r.provider, nil
}
