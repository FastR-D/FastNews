package httpapi

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/identity"
	"github.com/FastR-D/FastNews/internal/store"
	"golang.org/x/net/html"
)

// Dial only publicly routable addresses and repeat the check for every redirect.
// DNS is resolved in DialContext, so validation cannot be bypassed by rebinding.
func publicDial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, e := net.SplitHostPort(address)
	if e != nil {
		return nil, e
	}
	ips, e := net.DefaultResolver.LookupIPAddr(ctx, host)
	if e != nil {
		return nil, e
	}
	blocked := []*net.IPNet{}
	for _, cidr := range []string{"100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4"} {
		_, block, _ := net.ParseCIDR(cidr)
		blocked = append(blocked, block)
	}
	for _, ip := range ips {
		for _, block := range blocked {
			if block.Contains(ip.IP) {
				return nil, store.Fail(400, "作者主页必须是公开网站")
			}
		}
		if !ip.IP.IsGlobalUnicast() || ip.IP.IsPrivate() || ip.IP.IsLoopback() || ip.IP.IsLinkLocalUnicast() {
			return nil, store.Fail(400, "作者主页必须是公开网站")
		}
	}
	if len(ips) == 0 {
		return nil, store.Fail(400, "无法解析主页地址")
	}
	return (&net.Dialer{Timeout: 8 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
}
func (s *Server) authorPreview(w http.ResponseWriter, r *http.Request) error {
	if r.Method != "POST" {
		return store.Fail(405, "Method not allowed")
	}
	v, e := s.require(r)
	if e != nil && cookie(r, "fastnews_session") == "" {
		token := cookie(r, s.researchCookie())
		if token != "" {
			profile, _, err := identity.Research(r.Context(), s.Config.ResearchURL, "GET", "/api/content/me", token, nil)
			if err != nil {
				return err
			}
			id := catalog.First(catalog.Str(profile, "accountId"), catalog.Str(profile, "keyId"))
			if id != "" {
				v = &store.Session{UserID: "research:" + id, CSRF: store.Digest("research-csrf:" + token)}
				e = nil
			}
		}
	}
	if e != nil {
		return e
	}
	if e = s.csrf(r, v.CSRF); e != nil {
		return e
	}
	if e = s.Store.Limit("author-fetch", v.UserID); e != nil {
		return e
	}
	var body struct {
		URL string `json:"url"`
	}
	if e = decode(w, r, &body, 4096); e != nil {
		return e
	}
	u, e := url.Parse(body.URL)
	if e != nil || u.Host == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return store.Fail(400, "主页地址无效")
	}
	client := &http.Client{Timeout: 12 * time.Second, Transport: &http.Transport{DialContext: publicDial}, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 || req.URL.User != nil || (req.URL.Scheme != "https" && req.URL.Scheme != "http") {
			return store.Fail(400, "主页重定向无效")
		}
		return nil
	}}
	req, e := http.NewRequestWithContext(r.Context(), "GET", body.URL, nil)
	if e != nil {
		return e
	}
	resp, e := client.Do(req)
	if e != nil {
		return store.Fail(502, "无法抓取作者主页，请检查地址或手动填写")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return store.Fail(502, "作者主页返回错误")
	}
	raw, e := io.ReadAll(io.LimitReader(resp.Body, (2<<20)+1))
	if e != nil {
		return e
	}
	if len(raw) > 2<<20 {
		return store.Fail(413, "作者主页过大")
	}
	doc, e := html.Parse(strings.NewReader(string(raw)))
	if e != nil {
		return e
	}
	title, description := "", ""
	links := []map[string]string{}
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			attrs := map[string]string{}
			for _, a := range n.Attr {
				attrs[a.Key] = a.Val
			}
			switch n.Data {
			case "title":
				if n.FirstChild != nil {
					title = n.FirstChild.Data
				}
			case "meta":
				if attrs["name"] == "description" || attrs["property"] == "og:description" {
					description = attrs["content"]
				}
			case "a":
				href := attrs["href"]
				if strings.Contains(href, ".pdf") || strings.Contains(href, "arxiv.org/abs/") {
					if ref, e := url.Parse(href); e == nil {
						absolute := resp.Request.URL.ResolveReference(ref)
						if absolute.Scheme == "http" || absolute.Scheme == "https" {
							links = append(links, map[string]string{"url": absolute.String(), "title": textContent(n)})
						}
					}
				}
			}
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(doc)
	reply(w, r, 200, map[string]any{"title": title, "description": description, "papers": links[:min(30, len(links))]})
	return nil
}
func textContent(n *html.Node) string {
	if n.Type == html.TextNode {
		return n.Data
	}
	s := ""
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		s += textContent(c)
	}
	return strings.TrimSpace(s)
}
