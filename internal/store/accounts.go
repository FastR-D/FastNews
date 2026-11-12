package store

import (
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"strings"
	"unicode/utf8"
)

type User struct {
	ID     string `json:"id"`
	Email  string `json:"email"`
	Name   string `json:"name"`
	Role   string `json:"role"`
	Status string `json:"status"`
}
type UserInput struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
	Role     string `json:"role"`
	Status   string `json:"status"`
	Reason   string `json:"reason"`
}

func (s *Store) initAccounts() error {
	rows, err := s.DB.Query(`PRAGMA table_info(users)`)
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var id, required, primary int
		var name, kind string
		var defaultValue any
		if err = rows.Scan(&id, &name, &kind, &required, &defaultValue, &primary); err != nil {
			rows.Close()
			return err
		}
		if name == "role" {
			found = true
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if !found {
		if _, err = s.DB.Exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`); err != nil {
			return err
		}
	}
	_, err = s.DB.Exec(`CREATE TABLE IF NOT EXISTS cas_signups(binding TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL, expires REAL NOT NULL, prepared TEXT)`)
	return err
}
func (s *Store) Users() ([]User, error) {
	rows, err := s.DB.Query(`SELECT id,email,name,role,status FROM users WHERE status!='deleted' ORDER BY email`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []User{}
	for rows.Next() {
		var u User
		if err = rows.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.Status); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}
func PrepareUser(in UserInput) (User, string, error) {
	email, err := Email(in.Email)
	if err != nil {
		return User{}, "", err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = email
	}
	if utf8.RuneCountInString(name) > 120 {
		return User{}, "", Fail(400, "姓名最长 120 字")
	}
	if in.Role == "" {
		in.Role = "user"
	}
	if in.Status == "" {
		in.Status = "active"
	}
	if (in.Role != "user" && in.Role != "admin") || (in.Status != "active" && in.Status != "disabled") {
		return User{}, "", Fail(400, "角色或状态无效")
	}
	hash := ""
	if in.Password != "" {
		hash, err = Password(in.Password)
	}
	return User{uuid.NewString(), email, name, in.Role, in.Status}, hash, err
}
func InsertUser(tx *sql.Tx, u User, hash string) error {
	var count int
	if err := tx.QueryRow(`SELECT count(*) FROM users WHERE email=?`, u.Email).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return Fail(409, "此邮箱已有账号，请登录后绑定 FastCAS")
	}
	_, err := tx.Exec(`INSERT INTO users(id,email,name,password,role,status) VALUES(?,?,?,?,?,?)`, u.ID, u.Email, u.Name, hash, u.Role, u.Status)
	return err
}
func (s *Store) ManageUser(actor, id, method string, in UserInput) (*User, error) {
	if strings.TrimSpace(in.Reason) == "" {
		return nil, Fail(400, "请填写操作原因")
	}
	var u User
	var hash string
	var err error
	if method != "DELETE" {
		u, hash, err = PrepareUser(in)
		if err != nil {
			return nil, err
		}
		if method == "POST" && hash == "" {
			return nil, Fail(400, "请设置初始密码")
		}
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var role string
	if tx.QueryRow(`SELECT role FROM users WHERE id=? AND status='active'`, actor).Scan(&role) != nil || role != "admin" {
		return nil, Fail(403, "需要管理员权限")
	}
	if method == "POST" {
		if err = InsertUser(tx, u, hash); err != nil {
			return nil, err
		}
		id = u.ID
	} else {
		var old User
		if tx.QueryRow(`SELECT id,email,name,role,status FROM users WHERE id=? AND status!='deleted'`, id).Scan(&old.ID, &old.Email, &old.Name, &old.Role, &old.Status) != nil {
			return nil, Fail(404, "用户不存在")
		}
		removing := method == "DELETE" || u.Status != "active" || u.Role != "admin"
		if removing && id == actor {
			return nil, Fail(409, "不能删除、停用或降级当前管理员")
		}
		if removing && old.Role == "admin" && old.Status == "active" {
			var n int
			if err = tx.QueryRow(`SELECT count(*) FROM users WHERE role='admin' AND status='active'`).Scan(&n); err != nil {
				return nil, err
			}
			if n <= 1 {
				return nil, Fail(409, "必须保留至少一名启用的管理员")
			}
		}
		if method == "DELETE" {
			u = old
			u.Status = "deleted"
			_, err = tx.Exec(`UPDATE users SET status='deleted',password='',email=?,name='已删除用户',role='user' WHERE id=?`, id+"@deleted.invalid", id)
		} else {
			u.ID = id
			var count int
			if err = tx.QueryRow(`SELECT count(*) FROM users WHERE email=? AND id!=?`, u.Email, id).Scan(&count); err != nil {
				return nil, err
			}
			if count > 0 {
				return nil, Fail(409, "邮箱已使用")
			}
			_, err = tx.Exec(`UPDATE users SET email=?,name=?,role=?,status=?,password=CASE WHEN ?='' THEN password ELSE ? END WHERE id=?`, u.Email, u.Name, u.Role, u.Status, hash, hash, id)
		}
		if err != nil {
			return nil, err
		}
		if method == "DELETE" || hash != "" || u.Email != old.Email || u.Role != old.Role || u.Status != old.Status {
			if _, err = tx.Exec(`DELETE FROM sessions WHERE user_id=?`, id); err != nil {
				return nil, err
			}
		}
	}
	detail, _ := json.Marshal(map[string]string{"actor": actor, "target": id, "method": method, "reason": in.Reason})
	if _, err = tx.Exec(`INSERT INTO audit VALUES(?,?,?,?)`, uuid.NewString(), actor, "admin.user:"+string(detail), Now()); err != nil {
		return nil, err
	}
	return &u, tx.Commit()
}
