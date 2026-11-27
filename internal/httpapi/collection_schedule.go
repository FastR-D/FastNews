package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/FastR-D/FastNews/internal/store"
)

type collectionSchedule struct {
	Enabled       bool       `json:"enabled"`
	IntervalHours int        `json:"intervalHours"`
	Source        string     `json:"source"`
	NextRunAt     time.Time  `json:"nextRunAt"`
	LastRunAt     *time.Time `json:"lastRunAt,omitempty"`
	Error         string     `json:"error,omitempty"`
}

func (m *collectionManager) scheduleFile() string {
	return filepath.Join(filepath.Dir(m.file), "collection-schedule.json")
}
func (m *collectionManager) loadSchedule() error {
	m.schedule = collectionSchedule{Enabled: true, IntervalHours: 6, Source: "all", NextRunAt: time.Now().UTC()}
	raw, err := os.ReadFile(m.scheduleFile())
	if os.IsNotExist(err) {
		return m.saveSchedule()
	}
	if err != nil {
		return err
	}
	if err = json.Unmarshal(raw, &m.schedule); err != nil {
		return fmt.Errorf("collection schedule: %w", err)
	}
	if m.schedule.IntervalHours < 1 || m.schedule.IntervalHours > 168 || m.schedule.Source == "" {
		return fmt.Errorf("invalid collection schedule")
	}
	// A crash between starting a scheduled run and saving its next date must not
	// immediately replay that run. Recover from the persisted history instead.
	for _, run := range m.runs {
		if run.Trigger == "scheduled" && (m.schedule.LastRunAt == nil || run.StartedAt.After(*m.schedule.LastRunAt)) {
			started := run.StartedAt
			m.schedule.LastRunAt = &started
			m.schedule.NextRunAt = started.Add(time.Duration(m.schedule.IntervalHours) * time.Hour)
			return m.saveSchedule()
		}
	}
	return nil
}
func (m *collectionManager) saveSchedule() error {
	err := saveCollectionJSON(m.scheduleFile(), m.schedule)
	m.scheduleError = ""
	if err != nil {
		m.scheduleError = "定时配置写入失败，请检查数据目录权限和磁盘空间。"
	}
	return err
}
func (s *Server) updateCollectionSchedule(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		Enabled       bool   `json:"enabled"`
		IntervalHours int    `json:"intervalHours"`
		Source        string `json:"source"`
	}
	if err := decode(w, r, &input, 1024); err != nil {
		return err
	}
	if input.IntervalHours < 1 || input.IntervalHours > 168 {
		return store.Fail(400, "采集间隔应为 1 至 168 小时")
	}
	if _, err := s.selectedCollectionSources(input.Source); err != nil {
		return err
	}
	m := s.collection
	m.mu.Lock()
	defer m.mu.Unlock()
	previous := m.schedule
	m.schedule.Enabled, m.schedule.IntervalHours, m.schedule.Source = input.Enabled, input.IntervalHours, input.Source
	// Manual collections never move this clock; editing the schedule starts a new interval.
	m.schedule.NextRunAt = time.Now().UTC().Add(time.Duration(input.IntervalHours) * time.Hour)
	m.schedule.Error = ""
	if err := m.saveSchedule(); err != nil {
		m.schedule = previous
		return err
	}
	reply(w, r, 200, m.schedule)
	return nil
}

// StartCollectionScheduler runs only in the long-lived server, never the CLI or
// API test constructors. Closing the server cancels both scheduling and its job.
func (s *Server) StartCollectionScheduler() {
	if s.Config.DisableCollectionScheduler {
		return
	}
	m := s.collection
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || m.schedulerCancel != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.schedulerCancel, m.schedulerDone = cancel, make(chan struct{})
	go func() {
		defer close(m.schedulerDone)
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			s.collectIfDue(time.Now().UTC())
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}
func (s *Server) collectIfDue(now time.Time) {
	m := s.collection
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || !m.schedule.Enabled || m.schedule.NextRunAt.After(now) || m.cancel != nil {
		return
	}
	sources, err := s.selectedCollectionSources(m.schedule.Source)
	if err == nil {
		var run collectionRun
		run, err = s.beginCollection(m.schedule.Source, "scheduled", "scheduler", sources)
		if err == nil {
			started := run.StartedAt
			m.schedule.LastRunAt = &started
			// After downtime run once, rather than enqueueing every missed interval.
			m.schedule.NextRunAt = now.Add(time.Duration(m.schedule.IntervalHours) * time.Hour)
			m.schedule.Error = ""
		}
	}
	if err != nil {
		m.schedule.Error = err.Error()
		m.schedule.NextRunAt = now.Add(5 * time.Minute)
	}
	_ = m.saveSchedule()
}
