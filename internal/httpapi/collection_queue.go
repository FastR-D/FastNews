package httpapi

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/store"
)

type collectionQueueItem struct {
	Transport   string    `json:"transport,omitempty"`
	ID          string    `json:"id"`
	Source      string    `json:"source"`
	Name        string    `json:"name"`
	State       string    `json:"state"`
	RequestedAt time.Time `json:"requestedAt"`
	RequestedBy string    `json:"requestedBy"`
}

func (m *collectionManager) queueFile() string {
	return filepath.Join(filepath.Dir(m.file), "collection-queue.json")
}
func (m *collectionManager) loadQueue() error {
	m.queue = []collectionQueueItem{}
	raw, err := os.ReadFile(m.queueFile())
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if err = json.Unmarshal(raw, &m.queue); err != nil {
		return err
	}
	// Run history is the durable claim. A crash between claim and queue removal
	// must not duplicate a collection (including a cancelled/interrupted one).
	next := []collectionQueueItem{}
	for _, item := range m.queue {
		if !m.queueClaimed(item.ID) {
			next = append(next, item)
		}
	}
	m.queue = next
	return saveCollectionJSON(m.queueFile(), m.queue)
}
func (m *collectionManager) queueClaimed(id string) bool {
	for _, run := range m.runs {
		if run.QueueID == id {
			return true
		}
	}
	return false
}
func (s *Server) enqueueCollection(w http.ResponseWriter, r *http.Request, actor string) error {
	var input struct {
		Source    string `json:"source"`
		Transport string `json:"transport"`
	}
	if err := decode(w, r, &input, 1024); err != nil {
		return err
	}
	if input.Transport != "" && input.Transport != "direct" && input.Transport != "relay" {
		return store.Fail(400, "请选择直连或新加坡采集")
	}
	if input.Transport == "relay" && s.Config.FetchRelaySSHConfig == "" {
		return store.Fail(409, "新加坡采集尚未配置，请选择直连或联系管理员")
	}
	directory, err := s.Catalog.SourceDirectory()
	if err != nil {
		return err
	}
	var found *catalog.DirectorySource
	for _, source := range directory.Sources {
		if source.ID == input.Source {
			copy := source
			found = &copy
			break
		}
	}
	if found == nil {
		return store.Fail(400, "请选择目录中的信源")
	}
	m := s.collection
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return store.Fail(503, "服务正在关闭")
	}
	for _, item := range m.queue {
		if item.Source == input.Source {
			reply(w, r, 202, item)
			return nil
		}
	}
	if len(m.queue) >= 100 {
		return store.Fail(409, "采集队列已满，请先处理现有任务")
	}
	// Existing disabled feeds have vetted configuration; enabling them preserves
	// their URL and settings. An unconfigured research candidate is never fetched
	// as if its homepage were an RSS feed.
	preset, available := catalog.NewsSourcePreset(input.Source)
	if (found.Configured && (found.Disabled || input.Transport != "")) || (!found.Configured && available) {
		sources, err := catalog.LoadNewsSources(s.Config.Root, "")
		if err != nil {
			return err
		}
		if !found.Configured {
			preset.Disabled = false
			sources = append(sources, preset)
		}
		for i := range sources {
			if sources[i].ID == input.Source {
				sources[i].Disabled = false
				if input.Transport != "" {
					sources[i].Transport = input.Transport
				}
			}
		}
		if err = saveCollectionJSON(filepath.Join(s.Config.Root, "config/news-sources.json"), sources); err != nil {
			return err
		}
		found.Configured = true
	}
	for _, run := range m.runs {
		if run.Status == "running" || run.Status == "stopping" {
			for _, source := range run.Sources {
				if source.Source == input.Source && (source.State == "running" || source.State == "queued") {
					reply(w, r, 202, collectionQueueItem{ID: run.ID, Source: input.Source, Name: found.Name, State: "running"})
					return nil
				}
			}
		}
	}
	state := "queued"
	if !found.Configured {
		state = "needs_configuration"
	}
	item := collectionQueueItem{Transport: input.Transport, ID: store.Random(), Source: input.Source, Name: found.Name, State: state, RequestedAt: time.Now().UTC(), RequestedBy: actor}
	previous := m.queue
	m.queue = append(append([]collectionQueueItem{}, previous...), item)
	if err = saveCollectionJSON(m.queueFile(), m.queue); err != nil {
		m.queue = previous
		return err
	}
	s.startQueuedCollectionLocked()
	if m.queueClaimed(item.ID) {
		item.State = "running"
	}
	reply(w, r, 202, item)
	return nil
}
func (s *Server) removeQueuedCollection(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		ID string `json:"id"`
	}
	if err := decode(w, r, &input, 1024); err != nil {
		return err
	}
	m := s.collection
	m.mu.Lock()
	defer m.mu.Unlock()
	next := []collectionQueueItem{}
	found := false
	for _, item := range m.queue {
		if item.ID == input.ID {
			found = true
		} else {
			next = append(next, item)
		}
	}
	if !found {
		return store.Fail(404, "排队任务已开始或不存在")
	}
	if err := saveCollectionJSON(m.queueFile(), next); err != nil {
		return err
	}
	m.queue = next
	reply(w, r, 200, map[string]bool{"removed": true})
	return nil
}
func (s *Server) drainCollectionQueue() {
	m := s.collection
	m.mu.Lock()
	defer m.mu.Unlock()
	s.startQueuedCollectionLocked()
}

// Caller holds the manager lock; the same worker serializes manual, scheduled
// and queued collection. Pending integrations remain visible across restarts.
func (s *Server) startQueuedCollectionLocked() bool {
	m := s.collection
	if m.closed || m.cancel != nil {
		return false
	}
	for i, item := range m.queue {
		if m.queueClaimed(item.ID) {
			continue
		}
		targets, err := s.selectedCollectionSources(item.Source)
		if err != nil {
			continue
		}
		if item.Transport != "" {
			sources, loadErr := catalog.LoadNewsSources(s.Config.Root, "")
			if loadErr != nil {
				continue
			}
			for j := range sources {
				if sources[j].ID == item.Source {
					sources[j].Transport = item.Transport
				}
			}
			if saveCollectionJSON(filepath.Join(s.Config.Root, "config/news-sources.json"), sources) != nil {
				continue
			}
			for j := range targets {
				targets[j].Transport = item.Transport
			}
		}
		if _, err = s.beginCollection(item.Source, "manual", item.RequestedBy, targets, item.ID); err != nil {
			m.persistenceError = "队列启动失败，请重试。"
			return false
		}
		m.queue = append(m.queue[:i:i], m.queue[i+1:]...)
		if err = saveCollectionJSON(m.queueFile(), m.queue); err != nil {
			m.persistenceError = "队列状态写入失败，请检查存储。"
		}
		return true
	}
	return false
}

// Removing a subscription disables future scheduled/manual selection and drops
// its pending queue item. An already-running HTTP request may finish normally.
func (s *Server) disableCollectionSource(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		Source string `json:"source"`
	}
	if err := decode(w, r, &input, 1024); err != nil {
		return err
	}
	m := s.collection
	m.mu.Lock()
	defer m.mu.Unlock()
	sources, err := catalog.LoadNewsSources(s.Config.Root, "")
	if err != nil {
		return err
	}
	found := false
	for i := range sources {
		if sources[i].ID == input.Source {
			sources[i].Disabled = true
			found = true
		}
	}
	next := []collectionQueueItem{}
	for _, item := range m.queue {
		if item.Source == input.Source {
			found = true
		} else {
			next = append(next, item)
		}
	}
	if !found {
		return store.Fail(404, "信源未纳入采集")
	}
	if err = saveCollectionJSON(filepath.Join(s.Config.Root, "config/news-sources.json"), sources); err != nil {
		return err
	}
	if err = saveCollectionJSON(m.queueFile(), next); err != nil {
		return err
	}
	m.queue = next
	reply(w, r, 200, map[string]bool{"disabled": true})
	return nil
}
