package httpapi

import (
	"context"
	"fmt"
	fastcas "github.com/FastR-D/FastCAS/sdk/go"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"

	"github.com/FastR-D/FastNews/internal/store"
)

func (s *Server) casHTTP(w http.ResponseWriter, r *http.Request, p string) error {
	action := strings.TrimPrefix(p, "/api/auth/fastcas/")
	if action == "available" && r.Method == "GET" {
		reply(w, r, 200, map[string]bool{"enabled": s.Config.CASEnabled, "login_enabled": s.Config.CASEnabled && s.Config.CASLogin, "link_enabled": s.Config.CASEnabled && s.Config.CASLink})
		return nil
	}
	if !s.Config.CASEnabled {
		return store.Fail(404, "未启用 FastCAS")
	}
	if action == "events" || action == "backchannel-logout" {
		if r.Method != "POST" {
			return store.Fail(405, "Method not allowed")
		}
		kind, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		want := "application/jwt"
		if action == "backchannel-logout" {
			want = "application/x-www-form-urlencoded"
		}
		if kind != want {
			return store.Fail(415, "需要签名通知")
		}
		body, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 65536))
		if e != nil {
			return store.Fail(413, "请求过大")
		}
		if action == "events" {
			applied := false
			e = s.CAS.Client.HandleNotification(r.Context(), string(body), func(ctx context.Context, event fastcas.Notification) error {
				applied = true
				return s.CAS.Notification(ctx, event)
			})
			if e != nil && !applied {
				return store.Fail(401, "签名验证失败")
			}
		} else {
			fields, err := url.ParseQuery(string(body))
			if err != nil || len(fields) != 1 || len(fields["logout_token"]) != 1 {
				return store.Fail(400, "退出通知格式无效")
			}
			notice, err := s.CAS.Client.VerifyLogout(r.Context(), fields.Get("logout_token"))
			if err != nil {
				return store.Fail(401, "签名验证失败")
			}
			e = s.CAS.Logout(notice)
		}
		if e != nil {
			return store.Fail(503, "通知未提交，请重试")
		}
		reply(w, r, 200, map[string]bool{"ok": true})
		return nil
	}
	if action == "login" && r.Method == "GET" {
		binding := store.Random()
		target, e := s.CAS.Begin(r.Context(), binding, nil)
		if e != nil {
			return e
		}
		s.setCookie(w, "fastnews_cas_binding", binding, 300)
		http.Redirect(w, r, target, 302)
		return nil
	}
	if action == "callback" && r.Method == "GET" {
		callback := strings.Split(s.Config.CASRedirect, "?")[0] + "?" + r.URL.RawQuery
		token, e := s.CAS.Finish(r.Context(), callback, cookie(r, "fastnews_cas_binding"), cookie(r, "fastnews_session"))
		s.setCookie(w, "fastnews_cas_binding", "", -1)
		status := "complete"
		if e != nil {
			status = "failed"
		} else if token != "" {
			s.setCookie(w, "fastnews_session", token, 7*86400)
		}
		w.Header().Set("Referrer-Policy", "no-referrer")
		http.Redirect(w, r, s.Config.PublicPath+"/login?fastcas="+status, 302)
		return nil
	}
	current, e := s.require(r)
	if e != nil {
		return e
	}
	if action == "status" && r.Method == "GET" {
		link, e := s.CAS.Current(r.Context(), current.UserID)
		if e != nil {
			return e
		}
		reply(w, r, 200, map[string]any{"enabled": true, "link_enabled": s.Config.CASLink, "link": link})
		return nil
	}
	if r.Method != "POST" {
		return store.Fail(405, "Method not allowed")
	}
	target, e := url.Parse(s.Config.CASRedirect)
	if e != nil {
		return e
	}
	if r.Header.Get("Origin") != target.Scheme+"://"+target.Host {
		return store.Fail(403, "不允许跨站认证操作")
	}
	if e = s.csrf(r, current.CSRF); e != nil {
		return e
	}
	var body struct {
		Password string `json:"password"`
	}
	if e = decode(w, r, &body, 8192); e != nil {
		return e
	}
	switch action {
	case "link", "revoke":
		if e = s.Store.Prove(current, body.Password, peer(r)); e != nil {
			return e
		}
		if action == "link" {
			binding := store.Random()
			target, e := s.CAS.Begin(r.Context(), binding, current)
			if e != nil {
				return e
			}
			s.setCookie(w, "fastnews_cas_binding", binding, 300)
			reply(w, r, 200, map[string]string{"url": target})
		} else {
			if e = s.CAS.Revoke(r.Context(), current); e != nil {
				return e
			}
			reply(w, r, 200, map[string]bool{"ok": true})
		}
	case "reconcile":
		if e = s.CAS.Reconcile(r.Context(), current.UserID); e != nil {
			return e
		}
		reply(w, r, 200, map[string]bool{"ok": true})
	default:
		return store.Fail(404, fmt.Sprintf("接口不存在: %s", action))
	}
	return nil
}
