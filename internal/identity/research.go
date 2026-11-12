package identity

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/FastR-D/FastNews/internal/store"
	"io"
	"net/http"
	"time"
)

func Research(ctx context.Context, base, method, path, token string, body any) (map[string]any, int, error) {
	var reader io.Reader
	if body != nil {
		b, e := json.Marshal(body)
		if e != nil {
			return nil, 0, e
		}
		reader = bytes.NewReader(b)
	}
	req, e := http.NewRequestWithContext(ctx, method, base+path, reader)
	if e != nil {
		return nil, 0, e
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, e := client.Do(req)
	if e != nil {
		return nil, 0, store.Fail(503, "无法连接 FastResearch")
	}
	defer resp.Body.Close()
	b, e := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if e != nil {
		return nil, 0, e
	}
	if len(b) > 1<<20 {
		return nil, 413, store.Fail(413, "Research 内容过大")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		status := 502
		if resp.StatusCode == 401 || resp.StatusCode == 403 {
			status = 401
		}
		return nil, resp.StatusCode, store.Fail(status, "Research 认证或内容读取失败")
	}
	v := map[string]any{}
	if e = json.Unmarshal(b, &v); e != nil {
		return nil, 502, store.Fail(502, "Research 返回内容无效")
	}
	return v, resp.StatusCode, nil
}
func Snapshot(ctx context.Context, base, key string) (string, string, map[string]any, error) {
	if len(key) < 8 || len(key) > 256 {
		return "", "", nil, store.Fail(400, "请输入有效 Research Key")
	}
	proof, _, e := Research(ctx, base, "POST", "/api/content/unlock", "", map[string]string{"key": key})
	if e != nil {
		return "", "", nil, e
	}
	token, _ := proof["session"].(string)
	id, _ := proof["accountId"].(string)
	keyID, _ := proof["keyId"].(string)
	if token == "" || id == "" || keyID == "" {
		return "", "", nil, store.Fail(502, "Research 身份证明不完整")
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _, _ = Research(cleanup, base, "POST", "/api/content/logout", token, map[string]any{})
	}()
	me, _, e := Research(ctx, base, "GET", "/api/content/me", token, nil)
	if e != nil {
		return "", "", nil, e
	}
	if me["accountId"] != id || me["keyId"] != keyID {
		return "", "", nil, store.Fail(409, "Research 身份在读取期间发生变化")
	}
	a, _, e := Research(ctx, base, "GET", "/api/content/authors", token, nil)
	if e != nil {
		return "", "", nil, e
	}
	im, _, e := Research(ctx, base, "GET", "/api/content/impression", token, nil)
	if e != nil {
		return "", "", nil, e
	}
	in, _, e := Research(ctx, base, "GET", "/api/content/inbox", token, nil)
	if e != nil {
		return "", "", nil, e
	}
	return id, keyID, map[string]any{"authors": map[string]any{"authors": a["authors"], "customTags": a["customTags"]}, "impression": im["impression"], "inbox": in["items"]}, nil
}
