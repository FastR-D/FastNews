package identity

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	fastcas "github.com/FastR-D/FastCAS/sdk/go"
	"github.com/FastR-D/FastNews/internal/store"
)

var ErrRegistrationRequired = errors.New("fastcas registration required")

type signup struct {
	Subject  string           `json:"-"`
	Email    string           `json:"email"`
	Name     string           `json:"name"`
	Prepared *preparedAccount `json:"-"`
}
type preparedAccount struct {
	User     store.User
	Password string
}

func (c *CAS) signup(binding string) (*signup, error) {
	if !c.Config.CASLogin || !c.Config.CASLink {
		return nil, store.Fail(403, "FastCAS 注册已关闭")
	}
	var p signup
	var prepared sql.NullString
	err := c.Store.DB.QueryRow(`SELECT subject,email,name,prepared FROM cas_signups WHERE binding=? AND issuer=? AND expires>?`, store.Digest(binding), c.Config.CASIssuer, store.Now()).Scan(&p.Subject, &p.Email, &p.Name, &prepared)
	if err != nil || binding == "" {
		return nil, store.Fail(401, "FastCAS 验证已过期，请重新登录")
	}
	if prepared.Valid {
		p.Prepared = new(preparedAccount)
		if err = json.Unmarshal([]byte(prepared.String), p.Prepared); err != nil {
			return nil, err
		}
	}
	return &p, nil
}
func (c *CAS) RegistrationStatus(binding string) (*signup, error) {
	p, err := c.signup(binding)
	if err != nil {
		return nil, err
	}
	if p.Prepared != nil {
		return nil, store.Fail(409, "请完成 FastCAS 认证")
	}
	return p, nil
}
func (c *CAS) promptRegistration(ctx context.Context, binding string, result *fastcas.LoginResult) error {
	if !c.Config.CASLink {
		return store.Fail(403, "FastCAS 注册已关闭")
	}
	var count int
	if err := c.Store.DB.QueryRow(`SELECT count(*) FROM cas_links WHERE issuer=? AND subject=?`, c.Config.CASIssuer, result.Identity.Subject).Scan(&count); err != nil {
		return err
	}
	if count != 0 {
		return store.Fail(409, "原绑定已失效，请登录原账号后重新绑定")
	}
	_, err := c.Client.ResolveLink(ctx, result.Identity.Subject)
	var apiErr *fastcas.APIError
	if !errors.As(err, &apiErr) || !(apiErr.Status == 404 || apiErr.Status == 401 && apiErr.Code == "authentication_required") {
		if err != nil {
			return err
		}
		return store.Fail(409, "已有账号绑定，请联系管理员")
	}
	email := ""
	if result.Identity.EmailVerified {
		email = result.Identity.Email
	}
	if _, err = c.Store.DB.Exec(`DELETE FROM cas_signups WHERE expires<=?`, store.Now()); err != nil {
		return err
	}
	_, err = c.Store.DB.Exec(`INSERT OR REPLACE INTO cas_signups VALUES(?,?,?,?,?,?,NULL)`, store.Digest(binding), c.Config.CASIssuer, result.Identity.Subject, email, result.Identity.Name, store.Now()+300)
	if err != nil {
		return err
	}
	return ErrRegistrationRequired
}
func (c *CAS) BeginRegistration(ctx context.Context, binding string, in store.UserInput) (string, string, error) {
	p, err := c.RegistrationStatus(binding)
	if err != nil {
		return "", "", err
	}
	in.Role = "user"
	in.Status = "active"
	user, hash, err := store.PrepareUser(in)
	if err != nil {
		return "", "", err
	}
	if hash == "" {
		return "", "", store.Fail(400, "请设置本地密码")
	}
	var n int
	if err = c.Store.DB.QueryRow(`SELECT count(*) FROM users WHERE email=?`, user.Email).Scan(&n); err != nil {
		return "", "", err
	}
	if n > 0 {
		return "", "", store.Fail(409, "此邮箱已有账号，请登录后绑定 FastCAS")
	}
	next := store.Random()
	target, err := c.Client.BeginRegistration(ctx, user.ID, fastcas.BeginOptions{BrowserBinding: next})
	if err != nil {
		return "", "", err
	}
	prepared, _ := json.Marshal(preparedAccount{user, hash})
	update, err := c.Store.DB.Exec(`UPDATE cas_signups SET binding=?,prepared=? WHERE binding=? AND issuer=? AND subject=? AND expires>? AND prepared IS NULL`, store.Digest(next), string(prepared), store.Digest(binding), c.Config.CASIssuer, p.Subject, store.Now())
	if err != nil {
		return "", "", err
	}
	nrows, _ := update.RowsAffected()
	if nrows != 1 {
		return "", "", store.Fail(401, "请重新使用 FastCAS 登录")
	}
	return next, target, nil
}
func (c *CAS) finishRegistration(ctx context.Context, binding string, result *fastcas.LoginResult) (string, error) {
	p, err := c.signup(binding)
	if err != nil {
		return "", err
	}
	if p.Prepared == nil || p.Subject != result.Identity.Subject || p.Prepared.User.ID != result.Transaction.LocalAccountRef {
		return "", store.Fail(401, "FastCAS 身份已改变，请重新登录")
	}
	link, err := c.Client.PrepareLink(ctx, result)
	if err != nil {
		return "", err
	}
	if link.Subject != p.Subject || link.LocalRef != p.Prepared.User.ID || link.ClientID != c.Config.CASClientID {
		return "", store.Fail(409, "认证关系不匹配")
	}
	tx, err := c.Store.DB.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if err = store.InsertUser(tx, p.Prepared.User, p.Prepared.Password); err != nil {
		return "", err
	}
	if err = c.save(tx, link); err != nil {
		return "", err
	}
	if _, err = tx.Exec(`DELETE FROM cas_signups WHERE binding=?`, store.Digest(binding)); err != nil {
		return "", err
	}
	if err = tx.Commit(); err != nil {
		return "", err
	}
	link, err = c.Client.ActivateLink(ctx, link.ID)
	if err != nil {
		return "", err
	}
	if err = c.Accept(link); err != nil {
		return "", err
	}
	return c.issue(link, result)
}
