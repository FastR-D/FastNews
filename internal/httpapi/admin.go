package httpapi

import (
	"github.com/FastR-D/FastNews/internal/store"
	"net/http"
	"strings"
)

func (s *Server) adminUsers(w http.ResponseWriter, r *http.Request, p string) error {
	current, err := s.require(r)
	if err != nil {
		return err
	}
	if current.Role != "admin" {
		return store.Fail(403, "需要管理员权限")
	}
	id := strings.TrimPrefix(p, "/api/admin/users")
	id = strings.TrimPrefix(id, "/")
	if r.Method == "GET" && id == "" {
		users, err := s.Store.Users()
		if err != nil {
			return err
		}
		reply(w, r, 200, users)
		return nil
	}
	if (r.Method != "POST" || id != "") && ((r.Method != "PATCH" && r.Method != "DELETE") || id == "" || strings.Contains(id, "/")) {
		return store.Fail(405, "Method not allowed")
	}
	if err = s.csrf(r, current.CSRF); err != nil {
		return err
	}
	var in store.UserInput
	if err = decode(w, r, &in, 8192); err != nil {
		return err
	}
	user, err := s.Store.ManageUser(current.UserID, id, r.Method, in)
	if err != nil {
		return err
	}
	status := 200
	if r.Method == "POST" {
		status = 201
	}
	reply(w, r, status, user)
	return nil
}
