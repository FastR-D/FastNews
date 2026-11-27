package store

import (
	"github.com/google/uuid"
)

type ProfileInput struct {
	Name            string `json:"name"`
	Email           string `json:"email"`
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (s *Store) UpdateProfile(current *Session, in ProfileInput, peer string) (*User, error) {
	if current == nil {
		return nil, Fail(401, "请先登录")
	}
	if err := s.Limit("profile-change", peer); err != nil {
		return nil, err
	}
	proposed, hash, err := PrepareUser(UserInput{Name: in.Name, Email: in.Email, Password: in.NewPassword})
	if err != nil {
		return nil, err
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var user User
	var existing string
	err = tx.QueryRow(`SELECT u.id,u.email,u.name,u.role,u.status,u.password FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND u.status='active' AND s.hash=? AND s.expires>?`, current.UserID, current.Hash, Now()).Scan(&user.ID, &user.Email, &user.Name, &user.Role, &user.Status, &existing)
	if err != nil {
		return nil, Fail(401, "当前会话已失效")
	}
	if !Check(existing, in.CurrentPassword) {
		return nil, Fail(403, "当前密码不正确")
	}
	var count int
	if err = tx.QueryRow(`SELECT count(*) FROM users WHERE email=? AND id!=?`, proposed.Email, user.ID).Scan(&count); err != nil {
		return nil, err
	}
	if count > 0 {
		return nil, Fail(409, "邮箱已使用")
	}
	if _, err = tx.Exec(`UPDATE users SET name=?,email=?,password=CASE WHEN ?='' THEN password ELSE ? END WHERE id=?`, proposed.Name, proposed.Email, hash, hash, user.ID); err != nil {
		return nil, err
	}
	if hash != "" || user.Email != proposed.Email {
		if _, err = tx.Exec(`DELETE FROM sessions WHERE user_id=? AND hash!=?`, user.ID, current.Hash); err != nil {
			return nil, err
		}
	}
	if _, err = tx.Exec(`INSERT INTO audit VALUES(?,?,?,?)`, uuid.NewString(), user.ID, "account.profile", Now()); err != nil {
		return nil, err
	}
	user.Name, user.Email = proposed.Name, proposed.Email
	return &user, tx.Commit()
}
