package httpapi

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"slices"
	"strings"

	fastcas "github.com/FastR-D/FastCAS/sdk/go"
	"github.com/FastR-D/FastNews/internal/store"
)

func (s *Server) readCASProvider() workspaceProvider {
	if s.workspaceCAS != nil {
		return s.workspaceCAS
	}
	if s.CAS != nil && s.CAS.Client != nil {
		return s.CAS.Client
	}
	return nil
}

func (s *Server) readCASAccount(ctx context.Context, subject string) (string, *fastcas.Link, error) {
	provider := s.readCASProvider()
	if provider == nil {
		return "", nil, store.Fail(503, "FastCAS 未配置")
	}
	var user, state, id string
	var version int64
	err := s.Store.DB.QueryRowContext(ctx, "SELECT user_id,state,id,version FROM cas_links WHERE issuer=? AND client_id=? AND subject=? ORDER BY version DESC LIMIT 1", s.Config.CASIssuer, s.Config.CASClientID, subject).Scan(&user, &state, &id, &version)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && state != "active") {
		return "", nil, store.Fail(403, "请先在 FastNews 认证同一 FastCAS 账号")
	}
	if err != nil {
		return "", nil, err
	}
	remote, err := provider.ResolveLink(ctx, subject)
	if err != nil {
		return "", nil, store.Fail(503, "暂时无法确认 FastCAS 账号绑定")
	}
	if remote == nil || remote.ID != id || remote.ClientID != s.Config.CASClientID || remote.LocalRef != user || remote.Subject != subject || remote.State != "active" || remote.Version != version {
		return "", nil, store.Fail(403, "FastCAS 绑定已更改")
	}
	var active int
	err = s.Store.DB.QueryRowContext(ctx, "SELECT count(*) FROM cas_links c JOIN users u ON u.id=c.user_id WHERE c.issuer=? AND c.id=? AND c.version=? AND c.state='active' AND u.status='active'", s.Config.CASIssuer, id, version).Scan(&active)
	if err != nil {
		return "", nil, err
	}
	if active != 1 {
		return "", nil, store.Fail(403, "账号或 FastCAS 绑定已停用")
	}
	return user, remote, nil
}

func (s *Server) connectReadCAS(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		return store.Fail(405, "Method not allowed")
	}
	provider := s.readCASProvider()
	if provider == nil {
		return store.Fail(503, "FastCAS 未配置")
	}
	authorization := strings.Fields(r.Header.Get("Authorization"))
	if len(authorization) != 2 || authorization[0] != "Bearer" {
		return store.Fail(401, "需要 FastCAS 服务令牌")
	}
	raw := authorization[1]
	claims, err := provider.VerifyAccessToken(r.Context(), raw, s.Config.CASClientID, "fastread:connect")
	if err != nil || claims == nil || !claims.Service || claims.Subject != "fastread-sync" || claims.ClientID != "fastread-sync" {
		return store.Fail(401, "FastRead 服务令牌无效")
	}
	live, err := provider.IntrospectToken(r.Context(), raw)
	if err != nil || live == nil || !live.Active || live.Subject != claims.Subject || live.ClientID != claims.ClientID || !slices.Contains(live.Audience, s.Config.CASClientID) || !slices.Contains(strings.Fields(live.Scope), "fastread:connect") {
		return store.Fail(403, "FastRead 联动权限不足")
	}
	var body struct {
		Subject string `json:"subject"`
	}
	if err = decode(w, r, &body, 4096); err != nil {
		return err
	}
	if body.Subject == "" || len(body.Subject) > 256 {
		return store.Fail(400, "CAS 身份无效")
	}
	user, link, err := s.readCASAccount(r.Context(), body.Subject)
	if err != nil {
		return err
	}
	token := "frn_" + store.Random()
	hash := store.Digest(token)
	tx, err := s.Store.DB.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var active int
	if err = tx.QueryRow("SELECT count(*) FROM cas_links c JOIN users u ON u.id=c.user_id WHERE c.issuer=? AND c.id=? AND c.version=? AND c.state='active' AND u.status='active'", s.Config.CASIssuer, link.ID, link.Version).Scan(&active); err != nil {
		return err
	}
	if active != 1 {
		return store.Fail(403, "FastCAS 绑定已更改")
	}
	if _, err = tx.Exec("DELETE FROM fastread_cas_credentials WHERE token_hash IN (SELECT token_hash FROM fastread_connections WHERE user_id=?)", user); err != nil {
		return err
	}
	if _, err = tx.Exec("INSERT INTO fastread_connections VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,created=excluded.created", user, hash, store.Now()); err != nil {
		return err
	}
	if _, err = tx.Exec("INSERT INTO fastread_cas_credentials VALUES(?,?,?,?,?)", hash, s.Config.CASIssuer, body.Subject, link.ID, link.Version); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store")
	reply(w, r, 201, map[string]any{"token": token, "subject": body.Subject, "mode": "cas"})
	return nil
}

func (s *Server) fastreadUser(r *http.Request) (string, error) {
	authorization := strings.Fields(r.Header.Get("Authorization"))
	if len(authorization) != 2 || !strings.EqualFold(authorization[0], "Bearer") {
		return "", store.Fail(401, "需要 FastRead 连接凭证")
	}
	hash := store.Digest(authorization[1])
	var user string
	err := s.Store.DB.QueryRowContext(r.Context(), "SELECT c.user_id FROM fastread_connections c JOIN users u ON u.id=c.user_id WHERE c.token_hash=? AND u.status='active'", hash).Scan(&user)
	if errors.Is(err, sql.ErrNoRows) {
		return "", store.Fail(401, "FastRead 连接已失效")
	}
	if err != nil {
		return "", err
	}
	var issuer, subject, linkID string
	var version int64
	err = s.Store.DB.QueryRowContext(r.Context(), "SELECT issuer,subject,link_id,version FROM fastread_cas_credentials WHERE token_hash=?", hash).Scan(&issuer, &subject, &linkID, &version)
	if errors.Is(err, sql.ErrNoRows) {
		return user, nil
	}
	if err != nil {
		return "", err
	}
	if issuer != s.Config.CASIssuer {
		return "", store.Fail(403, "CAS 连接已更改")
	}
	linked, link, err := s.readCASAccount(r.Context(), subject)
	if err != nil {
		return "", err
	}
	if linked != user || link.ID != linkID || link.Version != version {
		return "", store.Fail(403, "CAS 连接已更改，请重新连接")
	}
	var valid int
	err = s.Store.DB.QueryRowContext(r.Context(), "SELECT count(*) FROM fastread_connections WHERE token_hash=? AND user_id=?", hash, user).Scan(&valid)
	if err != nil {
		return "", err
	}
	if valid != 1 {
		return "", store.Fail(401, "连接已撤销")
	}
	return user, nil
}
