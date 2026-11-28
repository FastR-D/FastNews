package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/FastR-D/FastNews/internal/catalog"
)

var arxivCategoryPattern = regexp.MustCompile(`^[a-zA-Z-]+\.[a-zA-Z]+$`)

// The daily RSS can legitimately be empty. Query a rolling submission window
// instead so weekends and missed announcements do not leave permanent gaps.
func arxivQuery(source catalog.NewsSource, now time.Time) string {
	u, err := url.Parse(source.URL)
	if err != nil || source.Channel != "arxiv" || u.Hostname() != "rss.arxiv.org" {
		return ""
	}
	parts := strings.Split(strings.TrimPrefix(strings.TrimPrefix(u.Path, "/atom/"), "/rss/"), "+")
	terms := []string{}
	for _, category := range parts {
		if !arxivCategoryPattern.MatchString(category) {
			return ""
		}
		sections := strings.Split(category, ".")
		terms = append(terms, "cat:"+strings.ToLower(sections[0])+"."+strings.ToUpper(sections[1]))
	}
	days := source.MaxAgeDays
	if days <= 0 {
		days = 14
	}
	if days > 30 {
		days = 30
	}
	return "(" + strings.Join(terms, " OR ") + ") AND submittedDate:[" + now.UTC().AddDate(0, 0, -days).Format("20060102") + "0000 TO " + now.UTC().Format("20060102") + "2359]"
}

var arxivRequests struct {
	sync.Mutex
	next time.Time
}

func (p *Pipeline) fetchArxiv(ctx context.Context, source catalog.NewsSource, query string) ([]map[string]any, string, error) {
	return p.fetchArxivPages(ctx, source, query, func(ctx context.Context, endpoint catalog.NewsSource) ([]byte, string, error) {
		// Serial requests and at least three seconds between calls, including across
		// different categories/pipelines. Cancellation never starts an extra request.
		arxivRequests.Lock()
		defer arxivRequests.Unlock()
		if delay := time.Until(arxivRequests.next); delay > 0 {
			timer := time.NewTimer(delay)
			defer timer.Stop()
			select {
			case <-ctx.Done():
				return nil, "", ctx.Err()
			case <-timer.C:
			}
		}
		if err := ctx.Err(); err != nil {
			return nil, "", err
		}
		raw, transport, err := p.fetchSource(ctx, endpoint)
		arxivRequests.next = time.Now().Add(3 * time.Second)
		return raw, transport, err
	})
}

type arxivCachedPage struct {
	Raw       []byte
	Transport string
}

func (p *Pipeline) fetchArxivPages(ctx context.Context, source catalog.NewsSource, query string, fetch func(context.Context, catalog.NewsSource) ([]byte, string, error)) ([]map[string]any, string, error) {
	cacheRoot := filepath.Join(catalog.First(p.Config.DataDir, filepath.Join(p.Config.Root, ".fastnews-data")), "arxiv-cache")
	entries, _ := os.ReadDir(cacheRoot)
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			if info, err := entry.Info(); err == nil && time.Since(info.ModTime()) > 72*time.Hour {
				_ = os.Remove(filepath.Join(cacheRoot, entry.Name()))
			}
		}
	}
	rows := []map[string]any{}
	transport := catalog.First(source.Transport, "direct")
	for start := 0; start < 10000; start += 200 {
		if err := ctx.Err(); err != nil {
			return nil, transport, err
		}
		endpoint := source
		endpoint.URL = "https://export.arxiv.org/api/query?" + url.Values{
			"search_query": {query}, "sortBy": {"submittedDate"}, "sortOrder": {"descending"}, "start": {strconv.Itoa(start)}, "max_results": {"200"},
		}.Encode()
		hash := sha256.Sum256([]byte(endpoint.URL + "|" + source.Transport))
		cache := filepath.Join(cacheRoot, fmt.Sprintf("%x.json", hash))
		page := arxivCachedPage{}
		cached := false
		if raw, err := os.ReadFile(cache); err == nil && json.Unmarshal(raw, &page) == nil {
			cached = len(page.Raw) > 0
		}
		if !cached {
			var err error
			page.Raw, page.Transport, err = fetch(ctx, endpoint)
			if err != nil {
				return nil, page.Transport, fmt.Errorf("arXiv 官方 API 采集失败: %w", err)
			}
		}
		transport = page.Transport
		var feed struct {
			XMLName xml.Name
			Total   *int       `xml:"totalResults"`
			Start   *int       `xml:"startIndex"`
			Entries []FeedItem `xml:"entry"`
		}
		if err := xml.Unmarshal(page.Raw, &feed); err != nil || feed.XMLName.Local != "feed" {
			return nil, transport, fmt.Errorf("arXiv API 返回了无效的 Atom 文档")
		}
		for _, entry := range feed.Entries {
			if strings.Contains(entry.ID, "/api/errors") {
				return nil, transport, fmt.Errorf("arXiv API 错误: %s", entry.Summary)
			}
		}
		if feed.Total == nil || feed.Start == nil || *feed.Start != start || *feed.Total < start || len(feed.Entries) != min(200, *feed.Total-start) {
			return nil, transport, fmt.Errorf("arXiv API 分页不完整，请重试")
		}
		parsed, err := parseFeed(page.Raw, source)
		if err != nil {
			return nil, transport, err
		}
		if len(parsed) != len(feed.Entries) {
			return nil, transport, fmt.Errorf("arXiv API 论文解析不完整")
		}
		rows = append(rows, parsed...)
		// Cache each valid page by the daily query, so six-hour schedules do not
		// repeatedly download identical results. Errors never poison the cache.
		if !cached {
			if err := os.MkdirAll(filepath.Dir(cache), 0700); err != nil {
				return nil, transport, err
			}
			raw, _ := json.Marshal(page)
			file, err := os.CreateTemp(filepath.Dir(cache), ".page-*")
			if err != nil {
				return nil, transport, err
			}
			name := file.Name()
			_, err = file.Write(raw)
			closeErr := file.Close()
			if err == nil {
				err = closeErr
			}
			if err == nil {
				err = os.Rename(name, cache)
			}
			os.Remove(name)
			if err != nil {
				return nil, transport, err
			}
		}
		if start+len(feed.Entries) >= *feed.Total {
			return rows, transport, nil
		}
	}
	return nil, transport, fmt.Errorf("arXiv 结果超过 10000 篇，请缩小采集时间范围")
}
