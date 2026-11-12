package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"slices"
	"sort"
	"strings"
	"time"

	fastcas "github.com/FastR-D/FastCAS/sdk/go"
	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/store"
)

type workspaceProvider interface {
	VerifyAccessToken(context.Context, string, string, ...string) (*fastcas.AccessClaims, error)
	IntrospectToken(context.Context, string) (*fastcas.Introspection, error)
	ResolveLink(context.Context, string) (*fastcas.Link, error)
}

func (s *Server) workspaceHTTP(w http.ResponseWriter, r *http.Request) error {
	if r.Method != "POST" {
		return store.Fail(405, "只允许读取个人摘要")
	}
	provider := s.workspaceCAS
	if provider == nil && s.CAS != nil && s.CAS.Client != nil {
		provider = s.CAS.Client
	}
	if provider == nil {
		return store.Fail(503, "FastCAS 未配置")
	}
	authorization := r.Header.Get("Authorization")
	if !strings.HasPrefix(authorization, "Bearer ") {
		return store.Fail(401, "需要 FastCAS 服务令牌")
	}
	raw := strings.TrimPrefix(authorization, "Bearer ")
	claims, e := provider.VerifyAccessToken(r.Context(), raw, s.Config.CASClientID, "workspace:read")
	if e != nil || claims == nil || !claims.Service || claims.Subject != "fastresearch" || claims.ClientID != "fastresearch" {
		return store.Fail(401, "个人摘要服务凭证无效")
	}
	live, e := provider.IntrospectToken(r.Context(), raw)
	if e != nil || live == nil || !live.Active || live.Subject != claims.Subject || live.ClientID != claims.ClientID || !slices.Contains(live.Audience, s.Config.CASClientID) || !slices.Contains(strings.Fields(live.Scope), "workspace:read") {
		return store.Fail(401, "个人摘要服务凭证已失效")
	}
	var b struct {
		Subject string `json:"subject"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if e = decoder.Decode(&b); e != nil || decoder.Decode(&struct{}{}) != io.EOF {
		return store.Fail(400, "请求格式无效")
	}
	if b.Subject == "" || len(b.Subject) > 256 {
		return store.Fail(400, "需要有效的 CAS 身份")
	}
	result := map[string]any{"schemaVersion": "fastresearch.workspace.v1", "appId": "fast-news", "accountState": "missing", "updatedAt": time.Now().UTC().Format(time.RFC3339), "metrics": []any{}, "items": []any{}}
	var account, state, linkID string
	var version int64
	e = s.Store.DB.QueryRowContext(r.Context(), `SELECT user_id,state,id,version FROM cas_links WHERE issuer=? AND client_id=? AND subject=? ORDER BY version DESC LIMIT 1`, s.Config.CASIssuer, s.Config.CASClientID, b.Subject).Scan(&account, &state, &linkID, &version)
	if e == sql.ErrNoRows {
		reply(w, r, 200, result)
		return nil
	}
	if e != nil {
		return e
	}
	if state != "active" {
		result["accountState"] = "inactive"
		reply(w, r, 200, result)
		return nil
	}
	remote, e := provider.ResolveLink(r.Context(), b.Subject)
	if e != nil {
		return store.Fail(503, "暂时无法确认 FastCAS 账号绑定")
	}
	if remote == nil || remote.ID != linkID || remote.ClientID != s.Config.CASClientID || remote.Subject != b.Subject || remote.LocalRef != account || remote.Version != version || remote.State != "active" {
		result["accountState"] = "inactive"
		reply(w, r, 200, result)
		return nil
	}
	var status string
	if e = s.Store.DB.QueryRowContext(r.Context(), `SELECT status FROM users WHERE id=?`, account).Scan(&status); e != nil {
		return e
	}
	if status != "active" {
		result["accountState"] = "inactive"
		reply(w, r, 200, result)
		return nil
	}
	var inbox []map[string]any
	if e = s.Store.Personal(account, "inbox", &inbox); e != nil {
		return e
	}
	papers, e := s.Catalog.Papers()
	if e != nil {
		return e
	}
	reports, e := s.Catalog.Reports()
	if e != nil {
		return e
	}
	items := []any{}
	for _, item := range inbox {
		if item["read"] == true {
			continue
		}
		items = append(items, map[string]any{"id": catalog.Str(item, "id"), "kind": "subscription", "title": catalog.Clip(catalog.First(catalog.Str(item, "title"), "订阅更新"), 180), "description": "未读订阅动态", "path": "/inbox", "occurredAt": catalog.Str(item, "createdAt")})
		if len(items) == 4 {
			break
		}
	}
	// Published corpus entries are offered separately from personal unread counts.
	sort.SliceStable(papers, func(i, j int) bool {
		if papers[i].Year != papers[j].Year {
			return papers[i].Year > papers[j].Year
		}
		return papers[i].Date > papers[j].Date
	})
	for _, p := range papers {
		if len(items) >= 6 {
			break
		}
		items = append(items, map[string]any{"id": "paper:" + p.ID, "kind": "paper", "title": catalog.Clip(catalog.First(p.TitleZH, p.Title), 180), "description": "近期论文 · " + p.Conference, "path": "/top-conf/?q=" + url.QueryEscape(p.Title), "occurredAt": p.Date})
	}
	if len(reports) > 0 && len(items) < 7 {
		report := reports[0]
		items = append(items, map[string]any{"id": "report:" + report.Title, "kind": "briefing", "title": catalog.Clip(report.Title, 180), "description": "最新研究简报", "path": "/summary-brief", "occurredAt": report.Updated})
	}
	result["accountState"] = "active"
	result["metrics"] = []any{map[string]any{"id": "unread", "label": "未读订阅", "value": unread(inbox)}, map[string]any{"id": "papers", "label": "收录论文", "value": len(papers)}, map[string]any{"id": "reports", "label": "研究简报", "value": len(reports)}}
	result["items"] = items
	// Recheck local revocation after upstream calls without mutating personal data.
	var liveVersion int64
	e = s.Store.DB.QueryRowContext(r.Context(), `SELECT version FROM cas_links WHERE issuer=? AND id=? AND state='active'`, s.Config.CASIssuer, linkID).Scan(&liveVersion)
	if e != nil || liveVersion != version {
		return store.Fail(409, "账号绑定已更改，请重试")
	}
	reply(w, r, 200, result)
	return nil
}
