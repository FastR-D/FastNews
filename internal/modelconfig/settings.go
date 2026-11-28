// Package modelconfig stores administrator model choices outside the release tree.
// Each request resolves an immutable snapshot; HTTP workers and CLI jobs share it.
package modelconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"

	"github.com/FastR-D/FastNews/internal/config"
)

type Scene struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Offline string `json:"offline"`
}

var Scenes = []Scene{
	{"field-briefing", "领域导读", "chat", "本地证据整理"},
	{"summary-brief", "总结汇报", "chat", "本地统计与证据整理"},
	{"related-work", "相关论文排序", "chat", "停用模型排序"},
	{"paper-summary", "会议论文摘要", "chat", "停用摘要生成"},
	{"news-summary", "资讯翻译与摘要", "chat", "停用摘要生成"},
	{"news-selection", "每日资讯筛选", "chat", "使用原始资讯"},
	{"daily-paper", "每日论文推荐", "chat", "本地检索推荐"},
	{"embedding", "向量检索", "embedding", "本地向量检索"},
}

type Profile struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Kind           string  `json:"kind"`
	BaseURL        string  `json:"baseUrl"`
	Model          string  `json:"model"`
	APIKey         string  `json:"apiKey,omitempty"`
	HasKey         bool    `json:"hasKey"`
	ClearKey       bool    `json:"clearKey,omitempty"`
	Temperature    float64 `json:"temperature"`
	MaxTokens      int     `json:"maxTokens"`
	TimeoutSeconds int     `json:"timeoutSeconds"`
}
type Settings struct {
	Revision    int64             `json:"revision"`
	Default     string            `json:"default"`
	Profiles    []Profile         `json:"profiles"`
	Assignments map[string]string `json:"assignments"`
}
type Resolved struct {
	BaseURL        string
	Model          string
	APIKey         string
	Enabled        bool
	Temperature    float64
	MaxTokens      int
	TimeoutSeconds int
}

var ErrConflict = errors.New("配置已被其他管理员修改，请刷新后重试")
var profileID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)

func File(c config.Config) string {
	dir := c.DataDir
	if dir == "" {
		if c.Root == "" {
			return ""
		}
		dir = filepath.Join(c.Root, ".fastnews-data")
	}
	return filepath.Join(dir, "model-settings.json")
}
func Load(c config.Config) (Settings, error) {
	settings := Settings{Profiles: []Profile{}, Assignments: map[string]string{}}
	file := File(c)
	if file == "" {
		return settings, nil
	}
	f, err := os.Open(file)
	if os.IsNotExist(err) {
		return settings, nil
	}
	if err != nil {
		return settings, fmt.Errorf("无法读取大模型配置")
	}
	defer f.Close()
	dec := json.NewDecoder(io.LimitReader(f, 256<<10))
	if dec.Decode(&settings) != nil {
		return settings, fmt.Errorf("大模型配置文件无效")
	}
	if err := Validate(settings); err != nil {
		return settings, fmt.Errorf("大模型配置文件无效")
	}
	return settings, nil
}
func ValidateProfile(p Profile) error {
	if !profileID.MatchString(p.ID) || p.ID == "disabled" || p.ID == "environment" {
		return fmt.Errorf("模型标识无效")
	}
	if strings.TrimSpace(p.Name) == "" || len(p.Name) > 120 {
		return fmt.Errorf("请填写模型连接名称（最多 120 字节）")
	}
	if p.Kind != "chat" && p.Kind != "embedding" {
		return fmt.Errorf("模型类型无效")
	}
	u, err := url.Parse(p.BaseURL)
	if err != nil || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(p.BaseURL) > 2048 {
		return fmt.Errorf("API 地址须为不带凭据或查询参数的 HTTP(S) 地址")
	}
	if strings.TrimSpace(p.Model) == "" || len(p.Model) > 200 {
		return fmt.Errorf("请填写有效的模型名称")
	}
	if len(p.APIKey) > 8192 || strings.ContainsAny(p.APIKey, "\r\n") {
		return fmt.Errorf("API 密钥格式无效")
	}
	if p.ClearKey && p.APIKey != "" {
		return fmt.Errorf("不能同时填写和清除密钥")
	}
	if math.IsNaN(p.Temperature) || math.IsInf(p.Temperature, 0) || p.Temperature < 0 || p.Temperature > 2 {
		return fmt.Errorf("温度须在 0 到 2 之间")
	}
	if p.MaxTokens < 128 || p.MaxTokens > 128000 {
		return fmt.Errorf("输出上限须在 128 到 128000 之间")
	}
	if p.TimeoutSeconds < 5 || p.TimeoutSeconds > 300 {
		return fmt.Errorf("超时须在 5 到 300 秒之间")
	}
	return nil
}
func Validate(settings Settings) error {
	if settings.Revision < 0 || len(settings.Profiles) > 32 {
		return fmt.Errorf("模型连接最多 32 个")
	}
	byID := map[string]Profile{}
	for _, p := range settings.Profiles {
		if err := ValidateProfile(p); err != nil {
			return err
		}
		if _, exists := byID[p.ID]; exists {
			return fmt.Errorf("模型标识重复")
		}
		byID[p.ID] = p
	}
	if settings.Default != "" && byID[settings.Default].Kind != "chat" {
		return fmt.Errorf("默认模型须选择聊天模型")
	}
	kinds := map[string]string{}
	for _, scene := range Scenes {
		kinds[scene.ID] = scene.Kind
	}
	for scene, id := range settings.Assignments {
		kind, exists := kinds[scene]
		if !exists {
			return fmt.Errorf("未知的使用场景")
		}
		if id != "" && id != "disabled" && byID[id].Kind != kind {
			return fmt.Errorf("场景 %s 的模型不存在或类型不匹配", scene)
		}
	}
	return nil
}
func MergeProfile(input Profile, existing []Profile) (Profile, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Model = strings.TrimSpace(input.Model)
	input.BaseURL = strings.TrimRight(strings.TrimSpace(input.BaseURL), "/")
	if err := ValidateProfile(input); err != nil {
		return input, err
	}
	if input.APIKey == "" && !input.ClearKey {
		for _, p := range existing {
			if p.ID == input.ID {
				input.APIKey = p.APIKey
				break
			}
		}
	}
	input.ClearKey = false
	input.HasKey = false
	return input, nil
}
func Save(c config.Config, input Settings) (Settings, error) {
	file := File(c)
	if file == "" {
		return Settings{}, fmt.Errorf("未配置模型存储目录")
	}
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		return Settings{}, fmt.Errorf("无法保存大模型配置")
	}
	lock, err := os.OpenFile(file+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return Settings{}, fmt.Errorf("无法锁定大模型配置")
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return Settings{}, fmt.Errorf("无法锁定大模型配置")
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	previous, err := Load(c)
	if err != nil {
		return Settings{}, err
	}
	if input.Revision != previous.Revision {
		return Settings{}, ErrConflict
	}
	for i, p := range input.Profiles {
		input.Profiles[i], err = MergeProfile(p, previous.Profiles)
		if err != nil {
			return Settings{}, err
		}
	}
	if err = Validate(input); err != nil {
		return Settings{}, err
	}
	if input.Profiles == nil {
		input.Profiles = []Profile{}
	}
	if input.Assignments == nil {
		input.Assignments = map[string]string{}
	}
	input.Revision++
	raw, err := json.MarshalIndent(input, "", "  ")
	if err != nil {
		return Settings{}, err
	}
	if len(raw) > 256<<10 {
		return Settings{}, fmt.Errorf("模型配置过大")
	}
	f, err := os.CreateTemp(filepath.Dir(file), ".model-settings-*")
	if err != nil {
		return Settings{}, fmt.Errorf("无法保存大模型配置")
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(raw); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(name, file)
	}
	if err != nil {
		return Settings{}, fmt.Errorf("无法保存大模型配置")
	}
	return input, nil
}
func Redact(settings Settings) Settings {
	settings.Profiles = append([]Profile{}, settings.Profiles...)
	for i := range settings.Profiles {
		settings.Profiles[i].HasKey = settings.Profiles[i].APIKey != ""
		settings.Profiles[i].APIKey = ""
		settings.Profiles[i].ClearKey = false
	}
	return settings
}
func FromProfile(p Profile) Resolved {
	return Resolved{p.BaseURL, p.Model, p.APIKey, true, p.Temperature, p.MaxTokens, p.TimeoutSeconds}
}
func Environment(c config.Config, kind string) Resolved {
	m := Resolved{c.LLMURL, c.LLMModel, c.LLMKey, c.LLMKey != "", 0.3, 10000, 90}
	if kind == "embedding" {
		m.Model = c.EmbeddingModel
		if c.EmbeddingURL != "" {
			m.BaseURL = c.EmbeddingURL
		}
		m.Enabled = c.EmbeddingURL != "" || c.EmbeddingProvider == "openai" || c.EmbeddingProvider == "remote"
		if c.EmbeddingProvider == "hash" || c.EmbeddingProvider == "offline" || c.EmbeddingProvider == "local" {
			m.Enabled = false
		}
	}
	return m
}
func Resolve(c config.Config, scene string) (Resolved, error) {
	settings, err := Load(c)
	if err != nil {
		return Resolved{}, err
	}
	kind := ""
	for _, s := range Scenes {
		if s.ID == scene {
			kind = s.Kind
		}
	}
	if kind == "" {
		return Resolved{}, fmt.Errorf("未知的模型场景")
	}
	id := settings.Assignments[scene]
	if id == "disabled" {
		return Resolved{TimeoutSeconds: 90}, nil
	}
	if id == "" && kind == "chat" {
		id = settings.Default
	}
	if id == "" {
		return Environment(c, kind), nil
	}
	for _, p := range settings.Profiles {
		if p.ID == id {
			return FromProfile(p), nil
		}
	}
	return Resolved{}, fmt.Errorf("场景模型配置无效")
}
