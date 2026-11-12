// Package identity adapts the official FastCAS SDK to FastNews-owned accounts.
package identity

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	fastcas "github.com/FastR-D/FastCAS/sdk/go"
	"github.com/FastR-D/FastNews/internal/config"
	"github.com/FastR-D/FastNews/internal/store"
	"golang.org/x/oauth2"
)

type CAS struct {
	Config config.Config
	Store  *store.Store
	Client *fastcas.Client
	cipher cipher.AEAD
}

func New(c config.Config, s *store.Store) (*CAS, error) {
	v := &CAS{Config: c, Store: s}
	if !c.CASEnabled {
		return v, nil
	}
	client, e := fastcas.New(fastcas.Config{Issuer: c.CASIssuer, ClientID: c.CASClientID, ClientSecret: c.CASSecret, RedirectURI: c.CASRedirect, AllowLoopbackHTTP: c.CASLoopback}, v)
	if e != nil {
		return nil, e
	}
	v.Client = client
	if c.ResearchConnect {
		key, e := base64.RawURLEncoding.DecodeString(strings.TrimRight(c.VaultKey, "="))
		if e != nil || len(key) != 32 {
			return nil, fmt.Errorf("FASTNEWS_FASTCAS_VAULT_KEY must encode 32 bytes")
		}
		block, e := aes.NewCipher(key)
		if e != nil {
			return nil, e
		}
		v.cipher, e = cipher.NewGCM(block)
		if e != nil {
			return nil, e
		}
		_, e = s.DB.Exec(`CREATE TABLE IF NOT EXISTS cas_token_vault(session_hash TEXT PRIMARY KEY REFERENCES sessions(hash) ON DELETE CASCADE,subject TEXT NOT NULL,access_cipher BLOB NOT NULL,refresh_cipher BLOB NOT NULL,access_expires REAL NOT NULL,updated REAL NOT NULL)`)
		if e != nil {
			return nil, e
		}
	}
	return v, nil
}
func (c *CAS) Put(ctx context.Context, t fastcas.Transaction) error {
	b, e := json.Marshal(t)
	if e != nil {
		return e
	}
	_, e = c.Store.DB.ExecContext(ctx, `INSERT INTO cas_transactions VALUES(?,?,?)`, t.State, string(b), float64(t.ExpiresAt.Unix()))
	return e
}
func (c *CAS) Take(ctx context.Context, state string) (*fastcas.Transaction, error) {
	var raw string
	e := c.Store.DB.QueryRowContext(ctx, `DELETE FROM cas_transactions WHERE state=? RETURNING payload`, state).Scan(&raw)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	var t fastcas.Transaction
	if e = json.Unmarshal([]byte(raw), &t); e != nil {
		return nil, store.Fail(400, "认证流程已更新，请重新发起登录")
	}
	return &t, nil
}
func (c *CAS) Current(ctx context.Context, user string) (*fastcas.Link, error) {
	var raw string
	e := c.Store.DB.QueryRowContext(ctx, `SELECT payload FROM cas_links WHERE issuer=? AND client_id=? AND user_id=? AND state!='revoked'`, c.Config.CASIssuer, c.Config.CASClientID, user).Scan(&raw)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	var link fastcas.Link
	e = json.Unmarshal([]byte(raw), &link)
	return &link, e
}
func same(a, b *fastcas.Link) bool {
	return a != nil && b != nil && a.ID == b.ID && a.ClientID == b.ClientID && a.Subject == b.Subject && a.LocalRef == b.LocalRef
}
func (c *CAS) save(tx *sql.Tx, link *fastcas.Link) error {
	if link == nil || link.ID == "" || link.LocalRef == "" || link.Subject == "" || link.ClientID != c.Config.CASClientID || link.Version < 1 || (link.State != "prepared" && link.State != "active" && link.State != "revoked") {
		return store.Fail(400, "认证关系无效")
	}
	var raw string
	e := tx.QueryRow(`SELECT payload FROM cas_links WHERE issuer=? AND id=?`, c.Config.CASIssuer, link.ID).Scan(&raw)
	if e == nil {
		var prev fastcas.Link
		if e = json.Unmarshal([]byte(raw), &prev); e != nil {
			return e
		}
		if !same(&prev, link) {
			return store.Fail(409, "认证身份发生变化")
		}
		if prev.Version >= link.Version || prev.State == "revoked" {
			return nil
		}
	} else if !errors.Is(e, sql.ErrNoRows) {
		return e
	}
	b, e := json.Marshal(link)
	if e != nil {
		return e
	}
	_, e = tx.Exec(`INSERT INTO cas_links VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(issuer,id) DO UPDATE SET state=excluded.state,version=excluded.version,payload=excluded.payload`, c.Config.CASIssuer, link.ID, link.ClientID, link.LocalRef, link.Subject, link.State, link.Version, string(b))
	return e
}
func (c *CAS) Accept(link *fastcas.Link) error {
	tx, e := c.Store.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if e = c.save(tx, link); e != nil {
		return e
	}
	if link.State == "revoked" {
		_, e = tx.Exec(`DELETE FROM sessions WHERE source='fastcas' AND json_extract(provider,'$.issuer')=? AND json_extract(provider,'$.link_id')=? AND json_extract(provider,'$.link_version')<=?`, c.Config.CASIssuer, link.ID, link.Version)
		if e != nil {
			return e
		}
	}
	var state string
	var version int64
	e = tx.QueryRow(`SELECT state,version FROM cas_links WHERE issuer=? AND id=?`, c.Config.CASIssuer, link.ID).Scan(&state, &version)
	if e != nil {
		return e
	}
	if state != link.State || version != link.Version {
		return store.Fail(409, "认证状态已改变")
	}
	return tx.Commit()
}
func (c *CAS) Reconcile(ctx context.Context, user string) error {
	local, e := c.Current(ctx, user)
	if e != nil {
		return e
	}
	if local == nil {
		return store.Fail(404, "没有待处理的认证")
	}
	remote, e := c.Client.GetLink(ctx, local.ID)
	if e != nil {
		return e
	}
	if !same(local, remote) {
		return store.Fail(403, "认证关系不匹配")
	}
	if remote.State == "prepared" {
		if !c.Config.CASLink {
			return store.Fail(403, "此实例已关闭新的认证")
		}
		remote, e = c.Client.ActivateLink(ctx, remote.ID)
		if e != nil {
			return e
		}
	}
	return c.Accept(remote)
}
func (c *CAS) Validate(ctx context.Context, s *store.Session) error {
	if s == nil || s.Source != "fastcas" {
		return nil
	}
	if !c.Config.CASEnabled {
		return store.Fail(401, "FastCAS 会话已失效，请使用本地登录")
	}
	var p struct {
		Issuer  string  `json:"issuer"`
		LinkID  string  `json:"link_id"`
		Version int64   `json:"link_version"`
		Checked float64 `json:"checked"`
	}
	if json.Unmarshal([]byte(s.Provider), &p) != nil {
		return store.Fail(401, "FastCAS 会话无效")
	}
	local, e := c.Current(ctx, s.UserID)
	if e != nil {
		return e
	}
	if local == nil || p.Issuer != c.Config.CASIssuer || local.ID != p.LinkID || local.Version != p.Version || local.State != "active" {
		return store.Fail(401, "FastCAS 认证已更改")
	}
	if p.Checked+300 > store.Now() {
		return nil
	}
	remote, e := c.Client.ResolveLink(ctx, local.Subject)
	if e != nil || !same(local, remote) || remote.State != "active" || remote.Version != local.Version {
		return store.Fail(401, "无法确认 FastCAS 认证，请使用本地登录")
	}
	result, e := c.Store.DB.Exec(`UPDATE sessions SET provider=json_set(provider,'$.checked',?) WHERE hash=? AND expires>? AND EXISTS(SELECT 1 FROM cas_links WHERE issuer=? AND id=? AND state='active' AND version=?)`, store.Now(), s.Hash, store.Now(), c.Config.CASIssuer, local.ID, local.Version)
	if e != nil {
		return e
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return store.Fail(401, "会话已失效")
	}
	return nil
}
func (c *CAS) Begin(ctx context.Context, binding string, s *store.Session) (string, error) {
	options := fastcas.BeginOptions{BrowserBinding: binding}
	if s != nil {
		if !c.Config.CASLink {
			return "", store.Fail(403, "此实例已关闭新的认证")
		}
		options.LocalAccountRef = s.UserID
		options.LocalSessionID = s.Hash
		return c.Client.BeginLink(ctx, options)
	}
	if !c.Config.CASLogin {
		return "", store.Fail(403, "此实例已关闭 FastCAS 登录")
	}
	if c.Config.ResearchConnect {
		options.Scopes = []string{"openid", "profile", "email", "offline_access", "research:read"}
	}
	return c.Client.BeginLogin(ctx, options)
}
func (c *CAS) Finish(ctx context.Context, callback, binding, raw string) (string, error) {
	s, e := c.Store.Session(raw)
	if e != nil {
		return "", e
	}
	options := fastcas.FinishOptions{BrowserBinding: binding}
	if s != nil {
		options.LocalAccountRef = s.UserID
		options.LocalSessionID = s.Hash
	}
	result, e := c.Client.FinishLogin(ctx, callback, options)
	if e != nil {
		return "", e
	}
	if result.Transaction.Purpose == "register" {
		return c.finishRegistration(ctx, binding, result)
	}
	if result.Transaction.Purpose == "link" {
		if !c.Config.CASLink || s == nil {
			return "", store.Fail(403, "无法绑定账号")
		}
		link, e := c.Client.PrepareLink(ctx, result)
		if e != nil {
			return "", e
		}
		tx, e := c.Store.DB.Begin()
		if e != nil {
			return "", e
		}
		defer tx.Rollback()
		var user string
		e = tx.QueryRow(`SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>? AND u.status='active'`, s.Hash, store.Now()).Scan(&user)
		if e != nil || user != link.LocalRef {
			return "", store.Fail(401, "原登录会话已失效")
		}
		if e = c.save(tx, link); e != nil {
			return "", e
		}
		if e = tx.Commit(); e != nil {
			return "", e
		}
		link, e = c.Client.ActivateLink(ctx, link.ID)
		if e != nil {
			return "", e
		}
		if e = c.Accept(link); e != nil {
			return "", e
		}
		if result.Identity.Role == "admin" {
			_, e = c.Store.DB.Exec(`UPDATE users SET role='admin' WHERE id=? AND status='active'`, link.LocalRef)
		}
		return "", e
	}
	if result.Transaction.Purpose != "login" || !c.Config.CASLogin {
		return "", store.Fail(403, "此实例已关闭 FastCAS 登录")
	}
	var user string
	e = c.Store.DB.QueryRow(`SELECT user_id FROM cas_links WHERE issuer=? AND client_id=? AND subject=? AND state!='revoked'`, c.Config.CASIssuer, c.Config.CASClientID, result.Identity.Subject).Scan(&user)
	if errors.Is(e, sql.ErrNoRows) {
		return "", c.promptRegistration(ctx, binding, result)
	}
	if e != nil {
		return "", e
	}
	local, e := c.Current(ctx, user)
	if e != nil {
		return "", e
	}
	if local.State == "prepared" {
		if e = c.Reconcile(ctx, user); e != nil {
			return "", e
		}
	}
	remote, e := c.Client.ResolveLink(ctx, result.Identity.Subject)
	if e != nil {
		return "", e
	}
	return c.issue(remote, result)
}
func (c *CAS) issue(link *fastcas.Link, result *fastcas.LoginResult) (string, error) {
	if link.State != "active" || result.Identity.Issuer != c.Config.CASIssuer || result.Identity.Subject != link.Subject {
		return "", store.Fail(403, "认证关系无效")
	}
	tx, e := c.Store.DB.Begin()
	if e != nil {
		return "", e
	}
	defer tx.Rollback()
	var payload string
	e = tx.QueryRow(`SELECT l.payload FROM cas_links l JOIN users u ON u.id=l.user_id WHERE l.issuer=? AND l.id=? AND l.state='active' AND l.version=? AND u.status='active'`, c.Config.CASIssuer, link.ID, link.Version).Scan(&payload)
	if e != nil {
		return "", store.Fail(403, "本地认证关系不可用")
	}
	var local fastcas.Link
	if json.Unmarshal([]byte(payload), &local) != nil || !same(&local, link) {
		return "", store.Fail(403, "认证关系不匹配")
	}
	if result.Identity.Role == "admin" {
		if _, e = tx.Exec(`UPDATE users SET role='admin' WHERE id=? AND status='active'`, link.LocalRef); e != nil {
			return "", e
		}
	}
	raw := store.Random()
	provider, _ := json.Marshal(map[string]any{"issuer": c.Config.CASIssuer, "sid": result.Identity.SessionID, "link_id": link.ID, "link_version": link.Version, "checked": store.Now()})
	_, e = tx.Exec(`INSERT INTO sessions VALUES(?,?,?,?,?,?,?)`, store.Digest(raw), link.LocalRef, store.Random(), store.Now()+7*86400, "fastcas", store.Now(), string(provider))
	if e != nil {
		return "", e
	}
	if c.cipher != nil && result.Token != nil && result.Token.RefreshToken != "" {
		if e = c.saveToken(tx, store.Digest(raw), link.Subject, result.Token); e != nil {
			return "", e
		}
	}
	return raw, tx.Commit()
}
func (c *CAS) Revoke(ctx context.Context, s *store.Session) error {
	local, e := c.Current(ctx, s.UserID)
	if e != nil || local == nil {
		return e
	}
	remote, e := c.Client.GetLink(ctx, local.ID)
	if e != nil {
		return e
	}
	if !same(local, remote) {
		return store.Fail(403, "认证关系不匹配")
	}
	if remote.State != "revoked" {
		remote, e = c.Client.RevokeLink(ctx, remote)
		if e != nil {
			return e
		}
	}
	return c.Accept(remote)
}
func (c *CAS) Notification(ctx context.Context, event fastcas.Notification) error {
	return c.apply(event.ID, func(tx *sql.Tx) error {
		if event.Type == "account_link.revoked" {
			if e := c.save(tx, event.Link); e != nil {
				return e
			}
			_, e := tx.Exec(`DELETE FROM sessions WHERE source='fastcas' AND json_extract(provider,'$.issuer')=? AND json_extract(provider,'$.link_id')=? AND json_extract(provider,'$.link_version')<=?`, c.Config.CASIssuer, event.Link.ID, event.Link.Version)
			return e
		}
		if event.Status == "disabled" {
			return c.deleteSubject(tx, event.Subject, "")
		}
		return nil
	})
}
func (c *CAS) Logout(n *fastcas.LogoutNotice) error {
	return c.apply(n.ID, func(tx *sql.Tx) error { return c.deleteSubject(tx, n.Subject, n.SessionID) })
}
func (c *CAS) deleteSubject(tx *sql.Tx, subject, sid string) error {
	_, e := tx.Exec(`DELETE FROM sessions WHERE source='fastcas' AND json_extract(provider,'$.issuer')=? AND json_extract(provider,'$.link_id') IN (SELECT id FROM cas_links WHERE issuer=? AND client_id=? AND subject=?) AND (?='' OR json_extract(provider,'$.sid')=?)`, c.Config.CASIssuer, c.Config.CASIssuer, c.Config.CASClientID, subject, sid, sid)
	return e
}
func (c *CAS) apply(id string, fn func(*sql.Tx) error) error {
	if id == "" {
		return store.Fail(400, "无效事件")
	}
	tx, e := c.Store.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var found int
	e = tx.QueryRow(`SELECT 1 FROM cas_events WHERE issuer=? AND id=?`, c.Config.CASIssuer, id).Scan(&found)
	if e == nil {
		return nil
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return e
	}
	if e = fn(tx); e != nil {
		return e
	}
	if _, e = tx.Exec(`INSERT INTO cas_events VALUES(?,?,?)`, c.Config.CASIssuer, id, store.Now()); e != nil {
		return e
	}
	return tx.Commit()
}
func (c *CAS) aad(hash, subject string) []byte {
	return []byte(c.Config.CASIssuer + "\n" + c.Config.CASClientID + "\n" + hash + "\n" + subject)
}
func (c *CAS) seal(value, hash, subject string) ([]byte, error) {
	nonce := make([]byte, c.cipher.NonceSize())
	if _, e := io.ReadFull(rand.Reader, nonce); e != nil {
		return nil, e
	}
	return c.cipher.Seal(nonce, nonce, []byte(value), c.aad(hash, subject)), nil
}
func (c *CAS) open(value []byte, hash, subject string) (string, error) {
	n := c.cipher.NonceSize()
	if len(value) < n {
		return "", store.Fail(409, "授权存储不可读，请重新登录")
	}
	b, e := c.cipher.Open(nil, value[:n], value[n:], c.aad(hash, subject))
	if e != nil {
		return "", store.Fail(409, "授权存储不可读，请重新登录")
	}
	return string(b), nil
}
func (c *CAS) saveToken(tx *sql.Tx, hash, subject string, token *oauth2.Token) error {
	a, e := c.seal(token.AccessToken, hash, subject)
	if e != nil {
		return e
	}
	r, e := c.seal(token.RefreshToken, hash, subject)
	if e != nil {
		return e
	}
	_, e = tx.Exec(`INSERT INTO cas_token_vault VALUES(?,?,?,?,?,?) ON CONFLICT(session_hash) DO UPDATE SET subject=excluded.subject,access_cipher=excluded.access_cipher,refresh_cipher=excluded.refresh_cipher,access_expires=excluded.access_expires,updated=excluded.updated`, hash, subject, a, r, float64(token.Expiry.Unix()), store.Now())
	return e
}
func (c *CAS) Access(ctx context.Context, s *store.Session) (string, string, error) {
	if !c.Config.ResearchConnect {
		return "", "", store.Fail(404, "未启用 Research 连接")
	}
	if s.Source != "fastcas" {
		return "", "", store.Fail(401, "请先使用 FastCAS 登录")
	}
	if e := c.Validate(ctx, s); e != nil {
		return "", "", e
	}
	link, e := c.Current(ctx, s.UserID)
	if e != nil {
		return "", "", e
	}
	tx, e := c.Store.DB.Begin()
	if e != nil {
		return "", "", e
	}
	defer tx.Rollback()
	var subject string
	var a, r []byte
	var expires float64
	e = tx.QueryRow(`SELECT subject,access_cipher,refresh_cipher,access_expires FROM cas_token_vault WHERE session_hash=?`, s.Hash).Scan(&subject, &a, &r, &expires)
	if e != nil || subject != link.Subject {
		return "", "", store.Fail(409, "请重新使用 FastCAS 登录以启用 Research 连接")
	}
	access, e := c.open(a, s.Hash, subject)
	if e != nil {
		return "", "", e
	}
	if expires < store.Now()+30 {
		refresh, e := c.open(r, s.Hash, subject)
		if e != nil {
			return "", "", e
		}
		token, e := c.Client.Refresh(ctx, &oauth2.Token{RefreshToken: refresh})
		if e != nil {
			return "", "", store.Fail(401, "授权已失效，请重新登录")
		}
		if token.RefreshToken == "" {
			token.RefreshToken = refresh
		}
		if e = c.saveToken(tx, s.Hash, subject, token); e != nil {
			return "", "", e
		}
		access = token.AccessToken
	}
	if e = tx.Commit(); e != nil {
		return "", "", e
	}
	claims, e := c.Client.VerifyAccessToken(ctx, access, c.Config.CASClientID, "research:read")
	if e != nil || claims.Subject != subject || claims.Service {
		return "", "", store.Fail(401, "授权身份无效")
	}
	delegated, e := c.Client.ExchangeToken(ctx, access, "research-api", []string{"research:read"})
	if e != nil {
		return "", "", store.Fail(403, "FastCAS 尚未授权访问 Research")
	}
	return delegated.AccessToken, subject, nil
}
