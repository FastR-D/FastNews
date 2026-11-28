package httpapi

import (
	"errors"
	"github.com/FastR-D/FastNews/internal/ai"
	"github.com/FastR-D/FastNews/internal/modelconfig"
	"github.com/FastR-D/FastNews/internal/rag"
	"github.com/FastR-D/FastNews/internal/store"
	"net/http"
)

func (s *Server) adminModels(w http.ResponseWriter, r *http.Request, path string) error {
	current, err := s.require(r)
	if err != nil {
		return err
	}
	if current.Role != "admin" {
		return store.Fail(403, "需要管理员权限")
	}
	settings, err := modelconfig.Load(s.Config)
	if err != nil {
		return store.Fail(503, "无法读取大模型配置")
	}
	if path == "/api/admin/models" && r.Method == http.MethodGet {
		environment := map[string]any{}
		for _, kind := range []string{"chat", "embedding"} {
			m := modelconfig.Environment(s.Config, kind)
			environment[kind] = map[string]any{"model": m.Model, "baseUrl": m.BaseURL, "enabled": m.Enabled, "hasKey": m.APIKey != ""}
		}
		reply(w, r, 200, map[string]any{"settings": modelconfig.Redact(settings), "scenes": modelconfig.Scenes, "environment": environment})
		return nil
	}
	if (path == "/api/admin/models" && r.Method != http.MethodPut) || (path == "/api/admin/models/test" && r.Method != http.MethodPost) {
		return store.Fail(405, "Method not allowed")
	}
	if err = s.csrf(r, current.CSRF); err != nil {
		return err
	}
	if path == "/api/admin/models/test" {
		var input modelconfig.Profile
		if err = decode(w, r, &input, 32<<10); err != nil {
			return err
		}
		merged, err := modelconfig.MergeProfile(input, settings.Profiles)
		if err != nil {
			return store.Fail(400, err.Error())
		}
		model := modelconfig.FromProfile(merged)
		model.TimeoutSeconds = min(model.TimeoutSeconds, 30)
		model.MaxTokens = 128
		if merged.Kind == "embedding" {
			err = rag.TestModel(r.Context(), model)
		} else {
			var out map[string]any
			err = ai.CompleteModel(r.Context(), model, "Return a JSON object.", `Reply with {"ok":true}.`, &out)
		}
		if err != nil {
			return store.Fail(502, "连接测试失败，请检查 API 地址、模型名称和密钥")
		}
		reply(w, r, 200, map[string]bool{"ok": true})
		return nil
	}
	var input modelconfig.Settings
	if err = decode(w, r, &input, 256<<10); err != nil {
		return err
	}
	// Validate without copying stored keys; Save merges keys under its file lock.
	for i, p := range input.Profiles {
		input.Profiles[i], err = modelconfig.MergeProfile(p, nil)
		if err != nil {
			return store.Fail(400, err.Error())
		}
		input.Profiles[i].ClearKey = p.ClearKey
	}
	if err = modelconfig.Validate(input); err != nil {
		return store.Fail(400, err.Error())
	}
	saved, err := modelconfig.Save(s.Config, input)
	if errors.Is(err, modelconfig.ErrConflict) {
		return store.Fail(409, err.Error())
	}
	if err != nil {
		return store.Fail(500, "无法保存大模型配置")
	}
	reply(w, r, 200, modelconfig.Redact(saved))
	return nil
}
