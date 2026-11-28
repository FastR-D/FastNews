package jobs

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/config"
)

func TestArxivQueryCoversMissedAnnouncements(t *testing.T) {
	source, _ := catalog.FindNewsSource("arxiv_cs_ai")
	query := arxivQuery(source, time.Date(2026, 11, 28, 5, 0, 0, 0, time.UTC))
	if query != "(cat:cs.AI OR cat:cs.CL) AND submittedDate:[202611140000 TO 202611282359]" {
		t.Fatal(query)
	}
	source.URL = "https://example.org/atom/cs.ai"
	if arxivQuery(source, time.Now()) != "" {
		t.Fatal("custom feed rewritten")
	}
	for _, link := range []string{"http://arxiv.org/abs/2611.12345v1", "https://arxiv.org/abs/2611.12345v2", "https://arxiv.org/abs/2611.12345?utm_source=rss"} {
		if newsLinkKey(link) != "arxiv:2611.12345" {
			t.Fatal("RSS/API duplicate", link)
		}
	}
}

func arxivPage(start, count, total int) []byte {
	var body strings.Builder
	fmt.Fprintf(&body, `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>%d</opensearch:totalResults><opensearch:startIndex>%d</opensearch:startIndex>`, total, start)
	for i := start; i < start+count; i++ {
		fmt.Fprintf(&body, `<entry><id>http://arxiv.org/abs/2611.%05dv1</id><title>Paper %d</title><summary>Research abstract</summary><published>2026-11-25T18:00:00Z</published><author><name>Alice Example</name></author><category term="cs.CR"/><link rel="alternate" href="http://arxiv.org/abs/2611.%05dv1"/></entry>`, i, i, i)
	}
	body.WriteString("</feed>")
	return []byte(body.String())
}

func TestArxivPaginationCacheAndErrors(t *testing.T) {
	source, _ := catalog.FindNewsSource("arxiv_cs_cr")
	p := New(config.Config{Root: t.TempDir()})
	calls := 0
	fetch := func(ctx context.Context, endpoint catalog.NewsSource) ([]byte, string, error) {
		calls++
		u, _ := url.Parse(endpoint.URL)
		if u.Host != "export.arxiv.org" || u.Query().Get("sortBy") != "submittedDate" {
			t.Fatal(u)
		}
		if u.Query().Get("start") == "0" {
			return arxivPage(0, 200, 201), "direct", nil
		}
		if u.Query().Get("start") != "200" {
			t.Fatal(u)
		}
		return arxivPage(200, 1, 201), "direct", nil
	}
	for range 2 {
		rows, transport, err := p.fetchArxivPages(context.Background(), source, "daily-query", fetch)
		if err != nil || len(rows) != 201 || transport != "direct" {
			t.Fatal(len(rows), transport, err)
		}
		if rows[0]["source"] != source.ID || rows[0]["author"] != "Alice Example" || rows[0]["description"] != "Research abstract" {
			t.Fatal(rows[0])
		}
	}
	if calls != 2 {
		t.Fatal("daily cache not reused", calls)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := p.fetchArxivPages(ctx, source, "daily-query", fetch); err == nil {
		t.Fatal("cancellation ignored")
	}
	for _, raw := range []string{`<html>failed</html>`, `<feed><entry><id>http://arxiv.org/api/errors#bad_query</id><summary>Invalid query</summary></entry></feed>`, string(arxivPage(0, 0, 12))} {
		if _, _, err := p.fetchArxivPages(context.Background(), source, raw, func(context.Context, catalog.NewsSource) ([]byte, string, error) { return []byte(raw), "direct", nil }); err == nil {
			t.Fatal("invalid API result accepted", raw)
		}
	}
}
