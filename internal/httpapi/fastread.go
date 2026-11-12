package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/FastR-D/FastNews/internal/store"
)

func (s *Server) fastreadIntegration(w http.ResponseWriter, r *http.Request, path string) error {
	if path == "/api/integrations/fastread/token" {
		session, err := s.require(r)
		if err != nil {
			return err
		}
		switch r.Method {
		case http.MethodGet:
			var created float64
			err = s.Store.DB.QueryRowContext(r.Context(), "SELECT created FROM fastread_connections WHERE user_id=?", session.UserID).Scan(&created)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			reply(w, r, http.StatusOK, map[string]any{"connected": err == nil, "created": created})
			return nil
		case http.MethodPost, http.MethodDelete:
			if err = s.csrf(r, session.CSRF); err != nil {
				return err
			}
			if r.Method == http.MethodDelete {
				_, err = s.Store.DB.ExecContext(r.Context(), "DELETE FROM fastread_connections WHERE user_id=?", session.UserID)
				if err != nil {
					return err
				}
				reply(w, r, http.StatusOK, map[string]bool{"connected": false})
				return nil
			}
			token := "frn_" + store.Random()
			_, err = s.Store.DB.ExecContext(r.Context(), "INSERT INTO fastread_connections VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,created=excluded.created", session.UserID, store.Digest(token), store.Now())
			if err != nil {
				return err
			}
			reply(w, r, http.StatusCreated, map[string]any{"token": token, "connected": true})
			return nil
		default:
			return store.Fail(405, "Method not allowed")
		}
	}
	if path != "/api/integrations/fastread/directions" {
		return store.Fail(404, "接口不存在")
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPut {
		return store.Fail(405, "Method not allowed")
	}
	authorization := strings.Fields(r.Header.Get("Authorization"))
	if len(authorization) != 2 || !strings.EqualFold(authorization[0], "Bearer") {
		return store.Fail(401, "需要 FastRead 连接码")
	}
	var user string
	err := s.Store.DB.QueryRowContext(r.Context(), "SELECT c.user_id FROM fastread_connections c JOIN users u ON u.id=c.user_id WHERE c.token_hash=? AND u.status='active'", store.Digest(authorization[1])).Scan(&user)
	if errors.Is(err, sql.ErrNoRows) {
		return store.Fail(401, "FastRead 连接码已失效")
	}
	if err != nil {
		return err
	}
	if r.Method == http.MethodGet {
		value := map[string]string{"text": ""}
		if err = s.Store.Personal(user, "impression", &value); err != nil {
			return err
		}
		reply(w, r, http.StatusOK, value)
		return nil
	}
	var input struct {
		Text string `json:"text"`
		Mode string `json:"mode"`
	}
	if err = decode(w, r, &input, 128<<10); err != nil {
		return err
	}
	input.Text = strings.TrimSpace(input.Text)
	if input.Text == "" || utf8.RuneCountInString(input.Text) > 4000 {
		return store.Fail(400, "研究方向需要 1–4000 字")
	}
	if input.Mode != "append" && input.Mode != "replace" {
		return store.Fail(400, "请选择追加或替换")
	}
	result := map[string]string{"text": input.Text, "updatedAt": time.Now().UTC().Format(time.RFC3339)}
	err = s.Store.Update(user, "impression", func(raw json.RawMessage) (any, error) {
		if input.Mode == "append" && len(raw) > 0 {
			var previous map[string]string
			if err := json.Unmarshal(raw, &previous); err != nil {
				return nil, err
			}
			if text := strings.TrimSpace(previous["text"]); text != "" {
				result["text"] = text + "\n\n" + input.Text
			}
		}
		if utf8.RuneCountInString(result["text"]) > 4000 {
			return nil, store.Fail(413, "研究印象累计不能超过 4000 字，请精简或选择替换")
		}
		return result, nil
	})
	if err != nil {
		return err
	}
	reply(w, r, http.StatusOK, result)
	return nil
}
