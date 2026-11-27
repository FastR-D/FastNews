package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/jobs"
	"github.com/FastR-D/FastNews/internal/store"
)

type collectionTarget struct {
	catalog.NewsSource
	Paper *paperCollection
}

type collectionSource struct {
	jobs.NewsProgress
	Name string `json:"name"`
}
type collectionRun struct {
	ID         string             `json:"id"`
	Selection  string             `json:"selection"`
	Status     string             `json:"status"`
	StartedAt  time.Time          `json:"startedAt"`
	FinishedAt *time.Time         `json:"finishedAt,omitempty"`
	StartedBy  string             `json:"startedBy"`
	Trigger    string             `json:"trigger"`
	Sources    []collectionSource `json:"sources"`
	Error      string             `json:"error,omitempty"`
}
type collectionManager struct {
	mu               sync.Mutex
	runs             []collectionRun
	cancel           context.CancelFunc
	done             chan struct{}
	file             string
	persistenceError string
	closed           bool
	schedule         collectionSchedule
	scheduleError    string
	schedulerCancel  context.CancelFunc
	schedulerDone    chan struct{}
}

func newCollectionManager(dir string) (*collectionManager, error) {
	m := &collectionManager{file: filepath.Join(dir, "collection-runs.json"), runs: []collectionRun{}}
	raw, err := os.ReadFile(m.file)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err == nil {
		if err := json.Unmarshal(raw, &m.runs); err != nil {
			return nil, fmt.Errorf("collection history: %w", err)
		}
		changed := false
		for i := range m.runs {
			run := &m.runs[i]
			if run.Status == "running" || run.Status == "stopping" {
				now := time.Now().UTC()
				run.Status, run.Error, run.FinishedAt = "interrupted", "服务重启，任务已中断；可重新采集，已有记录会自动去重。", &now
				for j := range run.Sources {
					if run.Sources[j].State == "running" || run.Sources[j].State == "queued" {
						run.Sources[j].State = "interrupted"
					}
				}
				changed = true
			}
		}
		if changed {
			if err := m.save(); err != nil {
				return nil, err
			}
		}
	}
	if err := m.loadSchedule(); err != nil {
		return nil, err
	}
	return m, nil
}

// Caller holds mu. Replace history atomically, with account-directory permissions.
func (m *collectionManager) save() (err error) {
	defer func() {
		m.persistenceError = ""
		if err != nil {
			m.persistenceError = "任务历史写入失败，请检查数据目录权限和磁盘空间。"
		}
	}()
	return saveCollectionJSON(m.file, m.runs)
}
func saveCollectionJSON(file string, value any) error {
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		return err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(file), ".collection-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(raw); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), file)
}

func (s *Server) Close() {
	m := s.collection
	m.mu.Lock()
	m.closed = true
	if m.schedulerCancel != nil {
		m.schedulerCancel()
	}
	schedulerDone := m.schedulerDone
	if m.cancel != nil {
		m.cancel()
	}
	done := m.done
	m.mu.Unlock()
	if done != nil {
		<-done
	}
	if schedulerDone != nil {
		<-schedulerDone
	}
}
func (s *Server) adminCollection(w http.ResponseWriter, r *http.Request, p string) error {
	current, err := s.require(r)
	if err != nil {
		return err
	}
	if current.Role != "admin" {
		return store.Fail(403, "需要管理员权限")
	}
	m := s.collection
	if p == "/api/admin/collection" && r.Method == http.MethodGet {
		sources, err := catalog.LoadNewsSources(s.Config.Root, "")
		sourceWarning := ""
		if err != nil {
			sourceWarning = "信源配置无法读取，请检查 config/news-sources.json。"
		}
		enabled := []map[string]string{}
		for _, source := range sources {
			if !source.Disabled {
				enabled = append(enabled, map[string]string{"id": source.ID, "name": source.Name, "channel": source.Channel})
			}
		}
		for _, paper := range paperCollections() {
			enabled = append(enabled, map[string]string{"id": paper.ID, "name": paper.Name, "channel": "papers"})
		}
		m.mu.Lock()
		defer m.mu.Unlock()
		reply(w, r, 200, map[string]any{"runs": m.runs, "sources": enabled, "warning": catalog.First(sourceWarning, m.persistenceError, m.scheduleError), "schedule": m.schedule, "schedulerRunning": m.schedulerCancel != nil && !m.closed})
		return nil
	}
	if r.Method != http.MethodPost {
		return store.Fail(405, "Method not allowed")
	}
	if err := s.csrf(r, current.CSRF); err != nil {
		return err
	}
	if p == "/api/admin/collection/schedule" {
		return s.updateCollectionSchedule(w, r)
	}
	if strings.HasSuffix(p, "/cancel") {
		id := strings.TrimSuffix(strings.TrimPrefix(p, "/api/admin/collection/"), "/cancel")
		m.mu.Lock()
		defer m.mu.Unlock()
		if len(m.runs) == 0 || m.runs[0].ID != id || m.cancel == nil {
			return store.Fail(409, "任务已结束或不存在")
		}
		m.runs[0].Status = "stopping"
		m.cancel()
		_ = m.save()
		reply(w, r, 202, m.runs[0])
		return nil
	}
	if p != "/api/admin/collection" {
		return store.Fail(404, "任务不存在")
	}
	var in struct {
		Source string `json:"source"`
	}
	if err := decode(w, r, &in, 1024); err != nil {
		return err
	}
	sources, err := s.selectedCollectionSources(in.Source)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	run, err := s.beginCollection(in.Source, "manual", current.UserID, sources)
	if err != nil {
		return err
	}
	reply(w, r, 202, run)
	return nil
}
func (s *Server) selectedCollectionSources(selection string) ([]collectionTarget, error) {
	sources, err := catalog.LoadNewsSources(s.Config.Root, "")
	if err != nil {
		return nil, err
	}
	selected := []collectionTarget{}
	for _, source := range sources {
		if !source.Disabled && (selection == "all" || selection == "all-research" || selection == source.Channel || selection == source.ID) {
			selected = append(selected, collectionTarget{NewsSource: source})
		}
	}
	for _, paper := range paperCollections() {
		if selection == "all-research" || selection == "papers" || selection == paper.ID || selection == "papers-"+paper.Domain {
			copy := paper
			selected = append(selected, collectionTarget{NewsSource: catalog.NewsSource{ID: paper.ID, Name: paper.Name, Channel: "papers"}, Paper: &copy})
		}
	}
	if len(selected) == 0 {
		return nil, store.Fail(400, "请选择已启用的采集信源")
	}
	return selected, nil
}

// beginCollection is called with the manager lock held by either trigger.
func (s *Server) beginCollection(selection, trigger, actor string, selected []collectionTarget) (collectionRun, error) {
	m := s.collection
	if m.closed {
		return collectionRun{}, store.Fail(503, "服务正在关闭")
	}
	if m.cancel != nil {
		return collectionRun{}, store.Fail(409, "已有采集任务运行中")
	}
	run := collectionRun{ID: store.Random(), Selection: selection, Trigger: trigger, Status: "running", StartedAt: time.Now().UTC(), StartedBy: actor, Sources: []collectionSource{}}
	for _, source := range selected {
		run.Sources = append(run.Sources, collectionSource{NewsProgress: jobs.NewsProgress{Source: source.ID, State: "queued"}, Name: source.Name})
	}
	previous := m.runs
	m.runs = append([]collectionRun{run}, m.runs...)
	if len(m.runs) > 50 {
		m.runs = m.runs[:50]
	}
	if err := m.save(); err != nil {
		m.runs = previous
		return collectionRun{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	m.cancel, m.done = cancel, make(chan struct{})
	go s.runCollection(ctx, cancel, selected)
	return run, nil
}

func (s *Server) runCollection(ctx context.Context, cancel context.CancelFunc, sources []collectionTarget) {
	m := s.collection
	pipeline := jobs.New(s.Config)
	pipeline.NewsProgress = func(event jobs.NewsProgress) {
		m.mu.Lock()
		defer m.mu.Unlock()
		for i := range m.runs[0].Sources {
			if m.runs[0].Sources[i].Source == event.Source {
				m.runs[0].Sources[i].NewsProgress = event
			}
		}
		_ = m.save()
	}
	var err error
	for _, target := range sources {
		if ctx.Err() != nil {
			err = errors.Join(err, ctx.Err())
			break
		}
		if target.Paper == nil {
			err = errors.Join(err, pipeline.FetchNewsSources(ctx, []catalog.NewsSource{target.NewsSource}))
			continue
		}
		paper := target.Paper
		event := jobs.NewsProgress{Source: paper.ID, State: "running"}
		pipeline.NewsProgress(event)
		before, _ := pipeline.Catalog.ConferenceRows(paper.Conference, paper.Year)
		pipeline.Provider, pipeline.Topic = paper.Provider, "coding-agents"
		jobErr := pipeline.RunConferenceJob(ctx, "fetch-conf", paper.Conference, paper.Year, 0, "")
		if jobErr == nil && (paper.Conference == "neurips" || paper.Conference == "iclr") {
			jobErr = pipeline.RunConferenceJob(ctx, "enrich-abstracts", paper.Conference, paper.Year, 30, "")
		}
		after, _ := pipeline.Catalog.ConferenceRows(paper.Conference, paper.Year)
		event.Fetched, event.Added = len(after), max(0, len(after)-len(before))
		event.State = "completed"
		if jobErr != nil {
			event.State = "failed"
			event.Error = "论文采集或摘要补全失败；已保存的论文仍可阅读，请查看覆盖情况。"
			err = errors.Join(err, fmt.Errorf("%s: %s", paper.Name, event.Error))
		}
		pipeline.NewsProgress(event)
	}
	s.Catalog.Invalidate()
	m.mu.Lock()
	defer m.mu.Unlock()
	run := &m.runs[0]
	now := time.Now().UTC()
	run.FinishedAt, run.Status = &now, "completed"
	if err != nil {
		run.Status, run.Error = "failed", err.Error()
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		run.Status, run.Error = "cancelled", "采集已停止，已保存的数据会保留。"
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		run.Status, run.Error = "failed", "任务超过 30 分钟，已停止。"
	}
	if run.Status == "failed" {
		for _, source := range run.Sources {
			if source.State == "completed" {
				run.Status = "partial"
				break
			}
		}
	}
	for i := range run.Sources {
		if run.Sources[i].State == "running" || run.Sources[i].State == "queued" {
			run.Sources[i].State = "cancelled"
		}
	}
	_ = m.save()
	cancel()
	m.cancel = nil
	close(m.done)
}
