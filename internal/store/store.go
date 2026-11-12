// Package store owns FastNews identities and personal data. The schema remains
// compatible with the original SQLite store, including Werkzeug scrypt hashes.
package store

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/scrypt"
)

type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string              { return e.Message }
func Fail(status int, message string) error { return &Error{status, message} }

type Store struct{ DB *sql.DB }
type Session struct {
	Hash     string `json:"-"`
	UserID   string `json:"user_id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	CSRF     string `json:"csrf"`
	Source   string `json:"source"`
	Provider string `json:"-"`
}

func Random() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func Digest(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func Now() float64           { return float64(time.Now().UnixMilli()) / 1000 }
func Open(root string) (*Store, error) {
	if e := os.MkdirAll(root, 0700); e != nil {
		return nil, e
	}
	p := filepath.Join(root, "accounts.sqlite")
	f, e := os.OpenFile(p, os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	_ = f.Close()
	if e = os.Chmod(p, 0600); e != nil {
		return nil, e
	}
	db, e := sql.Open("sqlite3", p+"?_foreign_keys=on&_busy_timeout=10000&_journal_mode=WAL&_txlock=immediate")
	if e != nil {
		return nil, e
	}
	db.SetMaxOpenConns(1)
	s := &Store{db}
	_, e = db.Exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active');
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires REAL NOT NULL,source TEXT NOT NULL,authenticated REAL NOT NULL,provider TEXT NOT NULL DEFAULT '{}');
 CREATE TABLE IF NOT EXISTS credentials(hash TEXT PRIMARY KEY,kind TEXT NOT NULL,email TEXT NOT NULL,user_id TEXT REFERENCES users(id),expires REAL NOT NULL,consumed REAL);
 CREATE TABLE IF NOT EXISTS limits(id TEXT PRIMARY KEY,attempts INTEGER NOT NULL,expires REAL NOT NULL);
 CREATE TABLE IF NOT EXISTS personal(user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,content TEXT NOT NULL,PRIMARY KEY(user_id,kind));
 CREATE TABLE IF NOT EXISTS research_connections(user_id TEXT PRIMARY KEY REFERENCES users(id),research_account_id TEXT NOT NULL UNIQUE,key_id TEXT NOT NULL,imported REAL NOT NULL,snapshot_hash TEXT NOT NULL,counts TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,user_id TEXT,action TEXT NOT NULL,created REAL NOT NULL);
 CREATE TABLE IF NOT EXISTS fastread_connections(user_id TEXT PRIMARY KEY REFERENCES users(id),token_hash TEXT UNIQUE NOT NULL,created REAL NOT NULL);
 CREATE TABLE IF NOT EXISTS cas_transactions(state TEXT PRIMARY KEY,payload TEXT NOT NULL,expires REAL NOT NULL);
 CREATE TABLE IF NOT EXISTS cas_links(issuer TEXT NOT NULL,id TEXT NOT NULL,client_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),subject TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('prepared','active','revoked')),version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(issuer,id));
 CREATE UNIQUE INDEX IF NOT EXISTS cas_local_live ON cas_links(issuer,client_id,user_id) WHERE state!='revoked';
 CREATE UNIQUE INDEX IF NOT EXISTS cas_subject_live ON cas_links(issuer,client_id,subject) WHERE state!='revoked';
 CREATE TABLE IF NOT EXISTS cas_events(issuer TEXT NOT NULL,id TEXT NOT NULL,created REAL NOT NULL,PRIMARY KEY(issuer,id));`)
	if e != nil {
		db.Close()
		return nil, e
	}
	if e = s.initAccounts(); e != nil {
		db.Close()
		return nil, e
	}
	return s, nil
}
func (s *Store) Close() error { return s.DB.Close() }

var emailRE = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

func Email(v string) (string, error) {
	v = strings.ToLower(strings.TrimSpace(v))
	if len(v) > 254 || !emailRE.MatchString(v) {
		return "", Fail(400, "请输入有效邮箱")
	}
	return v, nil
}
func Password(v string) (string, error) {
	if n := utf8.RuneCountInString(v); n < 12 || n > 256 {
		return "", Fail(400, "密码需要 12–256 个字符")
	}
	salt := Random()[:16]
	key, e := scrypt.Key([]byte(v), []byte(salt), 32768, 8, 1, 64)
	if e != nil {
		return "", e
	}
	return "scrypt:32768:8:1$" + salt + "$" + hex.EncodeToString(key), nil
}
func Check(encoded, password string) bool {
	if utf8.RuneCountInString(password) > 256 {
		return false
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 3 {
		return false
	}
	m := strings.Split(parts[0], ":")
	if len(m) != 4 || m[0] != "scrypt" {
		return false
	}
	n, _ := strconv.Atoi(m[1])
	r, _ := strconv.Atoi(m[2])
	p, _ := strconv.Atoi(m[3])
	if n != 32768 || r != 8 || p != 1 {
		return false
	}
	key, e := scrypt.Key([]byte(password), []byte(parts[1]), n, r, p, 64)
	return e == nil && subtle.ConstantTimeCompare([]byte(hex.EncodeToString(key)), []byte(parts[2])) == 1
}
func (s *Store) Create(email, password, name string) (string, error) {
	email, e := Email(email)
	if e != nil {
		return "", e
	}
	hash, e := Password(password)
	if e != nil {
		return "", e
	}
	if name == "" {
		name = email
	}
	id := uuid.NewString()
	_, e = s.DB.Exec(`INSERT INTO users(id,email,password,name) VALUES(?,?,?,?)`, id, email, hash, name)
	if e != nil {
		return "", Fail(409, "账号已存在")
	}
	return id, nil
}
func (s *Store) Limit(action, peer string) error {
	var n int
	key := Digest(action + ":" + peer)
	now := Now()
	e := s.DB.QueryRow(`INSERT INTO limits VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN expires>? THEN attempts+1 ELSE 1 END,expires=CASE WHEN expires>? THEN expires ELSE excluded.expires END RETURNING attempts`, key, now+900, now, now).Scan(&n)
	if e != nil {
		return e
	}
	if n > 12 {
		return Fail(429, "操作频繁，请稍后重试")
	}
	return nil
}
func (s *Store) Login(email, password, peer string) (string, string, error) {
	email, e := Email(email)
	if e != nil {
		return "", "", e
	}
	if e = s.Limit("login:"+email, peer); e != nil {
		return "", "", e
	}
	var id, hash, status string
	e = s.DB.QueryRow(`SELECT id,password,status FROM users WHERE email=?`, email).Scan(&id, &hash, &status)
	if e != nil {
		hash = "scrypt:32768:8:1$dummy01234567890$" + strings.Repeat("0", 128)
	}
	if !Check(hash, password) || e != nil || status != "active" {
		return "", "", Fail(401, "邮箱或密码错误")
	}
	tx, e := s.DB.Begin()
	if e != nil {
		return "", "", e
	}
	defer tx.Rollback()
	var actual string
	if e = tx.QueryRow(`SELECT password FROM users WHERE id=? AND status='active'`, id).Scan(&actual); e != nil || actual != hash {
		return "", "", Fail(401, "账号状态已更改，请重新登录")
	}
	raw, csrf := Random(), Random()
	_, e = tx.Exec(`INSERT INTO sessions(hash,user_id,csrf,expires,source,authenticated) VALUES(?,?,?,?,?,?)`, Digest(raw), id, csrf, Now()+7*86400, "local", Now())
	if e != nil {
		return "", "", e
	}
	_, e = tx.Exec(`DELETE FROM limits WHERE id=?`, Digest("login:"+email+":"+peer))
	if e != nil {
		return "", "", e
	}
	return raw, csrf, tx.Commit()
}
func (s *Store) Session(raw string) (*Session, error) {
	if raw == "" {
		return nil, nil
	}
	v := new(Session)
	e := s.DB.QueryRow(`SELECT s.hash,s.user_id,s.csrf,s.source,s.provider,u.email,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>? AND u.status='active'`, Digest(raw), Now()).Scan(&v.Hash, &v.UserID, &v.CSRF, &v.Source, &v.Provider, &v.Email, &v.Name, &v.Role)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (s *Store) Logout(raw string) error {
	_, e := s.DB.Exec(`DELETE FROM sessions WHERE hash=?`, Digest(raw))
	return e
}
func (s *Store) Prove(current *Session, password, peer string) error {
	if e := s.Limit("cas-proof", peer); e != nil {
		return e
	}
	if current == nil {
		return Fail(401, "请先登录")
	}
	var hash string
	e := s.DB.QueryRow(`SELECT password FROM users WHERE id=? AND status='active'`, current.UserID).Scan(&hash)
	if e != nil || !Check(hash, password) {
		return Fail(403, "请验证当前账号的本地密码")
	}
	return nil
}
func (s *Store) Issue(kind, email string) (string, error) {
	email, e := Email(email)
	if e != nil {
		return "", e
	}
	if kind != "invite" && kind != "recovery" {
		return "", Fail(400, "凭证类型无效")
	}
	tx, e := s.DB.Begin()
	if e != nil {
		return "", e
	}
	defer tx.Rollback()
	var id, status string
	e = tx.QueryRow(`SELECT id,status FROM users WHERE email=?`, email).Scan(&id, &status)
	if (kind == "invite" && e == nil) || (kind == "recovery" && (e != nil || status != "active")) {
		return "", Fail(409, "账号不符合凭证条件")
	}
	now := Now()
	_, e = tx.Exec(`UPDATE credentials SET consumed=? WHERE kind=? AND email=? AND consumed IS NULL`, now, kind, email)
	if e != nil {
		return "", e
	}
	var user any
	if id != "" {
		user = id
	}
	raw := Random()
	_, e = tx.Exec(`INSERT INTO credentials VALUES(?,?,?,?,?,NULL)`, Digest(raw), kind, email, user, now+3600)
	if e != nil {
		return "", e
	}
	return raw, tx.Commit()
}
func (s *Store) Redeem(kind, raw, password, peer string) error {
	if e := s.Limit("redeem", peer); e != nil {
		return e
	}
	if len(raw) < 32 || len(raw) > 256 {
		return Fail(400, "凭证无效或已过期")
	}
	hash, e := Password(password)
	if e != nil {
		return e
	}
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var email string
	var user sql.NullString
	e = tx.QueryRow(`SELECT email,user_id FROM credentials WHERE hash=? AND kind=? AND expires>? AND consumed IS NULL`, Digest(raw), kind, Now()).Scan(&email, &user)
	if e != nil {
		return Fail(400, "凭证无效或已过期")
	}
	id := user.String
	if kind == "invite" {
		id = uuid.NewString()
		_, e = tx.Exec(`INSERT INTO users(id,email,password,name) VALUES(?,?,?,?)`, id, email, hash, email)
	} else {
		var result sql.Result
		result, e = tx.Exec(`UPDATE users SET password=? WHERE id=? AND status='active'`, hash, id)
		if e == nil {
			n, _ := result.RowsAffected()
			if n == 0 {
				return Fail(400, "凭证无效或已过期")
			}
			_, e = tx.Exec(`DELETE FROM sessions WHERE user_id=?`, id)
		}
	}
	if e != nil {
		return e
	}
	_, e = tx.Exec(`UPDATE credentials SET consumed=? WHERE hash=?`, Now(), Digest(raw))
	if e != nil {
		return e
	}
	_, e = tx.Exec(`INSERT INTO audit VALUES(?,?,?,?)`, uuid.NewString(), id, "account."+kind, Now())
	if e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) Personal(user, kind string, out any) error {
	var raw string
	e := s.DB.QueryRow(`SELECT content FROM personal WHERE user_id=? AND kind=?`, user, kind).Scan(&raw)
	if errors.Is(e, sql.ErrNoRows) {
		return nil
	}
	if e != nil {
		return e
	}
	return json.Unmarshal([]byte(raw), out)
}
func (s *Store) Update(user, kind string, transform func(json.RawMessage) (any, error)) error {
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var active int
	if e = tx.QueryRow(`SELECT 1 FROM users WHERE id=? AND status='active'`, user).Scan(&active); e != nil {
		return Fail(401, "账号不可用")
	}
	var raw string
	e = tx.QueryRow(`SELECT content FROM personal WHERE user_id=? AND kind=?`, user, kind).Scan(&raw)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return e
	}
	v, e := transform(json.RawMessage(raw))
	if e != nil {
		return e
	}
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	if len(b) > 256*1024 {
		return Fail(413, "个人资料过大")
	}
	_, e = tx.Exec(`INSERT INTO personal VALUES(?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET content=excluded.content`, user, kind, string(b))
	if e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) Set(user, kind string, v any) error {
	return s.Update(user, kind, func(json.RawMessage) (any, error) { return v, nil })
}
func (s *Store) Connection(user string) (map[string]any, error) {
	var id, key, hash, counts string
	var imported float64
	e := s.DB.QueryRow(`SELECT research_account_id,key_id,imported,snapshot_hash,counts FROM research_connections WHERE user_id=?`, user).Scan(&id, &key, &imported, &hash, &counts)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	var c any
	if e = json.Unmarshal([]byte(counts), &c); e != nil {
		return nil, e
	}
	return map[string]any{"researchAccountId": id, "keyId": key, "importedAt": imported, "snapshotHash": hash, "counts": c}, nil
}
func (s *Store) Import(user, id, key string, sections map[string]any, replace bool) (map[string]any, error) {
	if id == "" || len(id) > 128 || len(key) > 128 || len(sections) != 3 {
		return nil, Fail(400, "Research 快照无效")
	}
	// Decode through a typed boundary before persisting untrusted remote content.
	var a struct {
		Authors []json.RawMessage `json:"authors"`
		Tags    []string          `json:"customTags"`
	}
	var im struct {
		Text *string `json:"text"`
	}
	var inbox []json.RawMessage
	ab, _ := json.Marshal(sections["authors"])
	ib, _ := json.Marshal(sections["impression"])
	nb, _ := json.Marshal(sections["inbox"])
	if json.Unmarshal(ab, &a) != nil || a.Authors == nil || a.Tags == nil || json.Unmarshal(ib, &im) != nil || im.Text == nil || json.Unmarshal(nb, &inbox) != nil || inbox == nil || len(inbox) > 1000 {
		return nil, Fail(400, "Research 快照无效")
	}
	tx, e := s.DB.Begin()
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	var connected string
	e = tx.QueryRow(`SELECT research_account_id FROM research_connections WHERE user_id=?`, user).Scan(&connected)
	if e == nil && connected != id {
		return nil, Fail(409, "已连接另一个 Research 账号")
	}
	var owner string
	e = tx.QueryRow(`SELECT user_id FROM research_connections WHERE research_account_id=?`, id).Scan(&owner)
	if e == nil && owner != user {
		return nil, Fail(409, "此 Research 账号已连接其他 FastNews 账号")
	}
	for _, kind := range []string{"authors", "impression", "inbox"} {
		var exists int
		e = tx.QueryRow(`SELECT 1 FROM personal WHERE user_id=? AND kind=?`, user, kind).Scan(&exists)
		if !replace && e == nil {
			return nil, Fail(409, "本地已有个人内容；如需覆盖请明确选择替换")
		}
		b, e := json.Marshal(sections[kind])
		if e != nil {
			return nil, e
		}
		if len(b) > 256*1024 {
			return nil, Fail(413, "Research 快照过大")
		}
		if _, e = tx.Exec(`INSERT INTO personal VALUES(?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET content=excluded.content`, user, kind, string(b)); e != nil {
			return nil, e
		}
	}
	b, _ := json.Marshal(sections)
	hash := Digest(string(b))
	counts := map[string]int{"authors": len(a.Authors), "inbox": len(inbox)}
	cb, _ := json.Marshal(counts)
	now := Now()
	_, e = tx.Exec(`INSERT INTO research_connections VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET key_id=excluded.key_id,imported=excluded.imported,snapshot_hash=excluded.snapshot_hash,counts=excluded.counts`, user, id, key, now, hash, string(cb))
	if e != nil {
		return nil, Fail(409, "Research 账号已连接其他 FastNews 账号")
	}
	_, e = tx.Exec(`INSERT INTO audit VALUES(?,?,?,?)`, uuid.NewString(), user, "research.snapshot.import", now)
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"researchAccountId": id, "keyId": key, "importedAt": now, "snapshotHash": hash, "counts": counts}, nil
}
