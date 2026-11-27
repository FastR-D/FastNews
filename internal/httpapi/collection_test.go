package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/FastR-D/FastNews/internal/catalog"
)

func collectionAdmin(t *testing.T) *harness {
	h := fixture(t)
	h.login(t, "collector@example.com")
	current, _ := h.app.Store.Session(h.cookie.Value)
	if _, err := h.app.Store.DB.Exec(`UPDATE users SET role='admin' WHERE id=?`, current.UserID); err != nil {
		t.Fatal(err)
	}
	return h
}
func configureCollection(t *testing.T, h *harness, sources ...catalog.NewsSource) {
	t.Helper()
	all := []catalog.NewsSource{}
	for _, source := range catalog.NewsSources {
		source.Disabled = true
		all = append(all, source)
	}
	all = append(all, sources...)
	raw, _ := json.Marshal(all)
	if err := os.MkdirAll(filepath.Join(h.app.Config.Root, "config"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(h.app.Config.Root, "config/news-sources.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
}
func awaitCollection(t *testing.T, h *harness) map[string]any {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		status, body, _ := h.request(t, "GET", "/api/admin/collection", nil, "", true)
		if status != 200 {
			t.Fatal(status, body)
		}
		runs := body["runs"].([]any)
		if len(runs) > 0 {
			run := runs[0].(map[string]any)
			if run["status"] != "running" && run["status"] != "stopping" {
				return run
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("collection did not finish")
	return nil
}
func TestCollectionAuthorization(t *testing.T) {
	h := fixture(t)
	if status, _, _ := h.request(t, "GET", "/api/admin/collection", nil, "", false); status != 401 {
		t.Fatal(status)
	}
	h.login(t, "member@example.com")
	for _, method := range []string{"GET", "POST"} {
		if status, _, _ := h.request(t, method, "/api/admin/collection", map[string]string{"source": "all"}, h.csrf, true); status != 403 {
			t.Fatal(status)
		}
	}
	current, _ := h.app.Store.Session(h.cookie.Value)
	h.app.Store.DB.Exec(`UPDATE users SET role='admin' WHERE id=?`, current.UserID)
	if status, _, _ := h.request(t, "POST", "/api/admin/collection", map[string]string{"source": "all"}, "", true); status != 403 {
		t.Fatal(status)
	}
	if status, _, _ := h.request(t, "POST", "/api/admin/collection", map[string]string{"source": "https://example.org/arbitrary"}, h.csrf, true); status != 400 {
		t.Fatal(status)
	}
	if status, _, _ := h.request(t, "DELETE", "/api/admin/collection", nil, h.csrf, true); status != 405 {
		t.Fatal(status)
	}
}
func TestCollectionResultsDedupAndPersistence(t *testing.T) {
	h := collectionAdmin(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/fail" {
			http.Error(w, "unavailable", 503)
			return
		}
		fmt.Fprint(w, `<rss><channel><item><title>Research result</title><link>https://example.org/paper</link><guid>paper-1</guid><description>A research abstract.</description></item></channel></rss>`)
	}))
	defer upstream.Close()
	configureCollection(t, h, catalog.NewsSource{ID: "test_good", Name: "Research team", URL: upstream.URL, Channel: "ai"}, catalog.NewsSource{ID: "test_bad", Name: "Unavailable team", URL: upstream.URL + "/fail", Channel: "ai"})
	for _, added := range []float64{1, 0} {
		if status, body, _ := h.request(t, "POST", "/api/admin/collection", map[string]string{"source": "ai"}, h.csrf, true); status != 202 {
			t.Fatal(status, body)
		}
		run := awaitCollection(t, h)
		if run["status"] != "partial" {
			t.Fatal(run)
		}
		sources := run["sources"].([]any)
		good, bad := sources[1].(map[string]any), sources[0].(map[string]any)
		if good["added"] != added || good["state"] != "completed" || bad["state"] != "failed" {
			t.Fatal(sources)
		}
	}
	rows, err := catalog.Rows(filepath.Join(h.app.Config.Root, "secnews/data/articles", time.Now().UTC().Format("2006-01-02")+".jsonl"))
	if err != nil || len(rows) != 1 {
		t.Fatal(rows, err)
	}
	restored, err := newCollectionManager(filepath.Dir(h.app.collection.file))
	if err != nil || len(restored.runs) != 2 || restored.runs[0].Status != "partial" {
		t.Fatal(restored, err)
	}
	info, _ := os.Stat(h.app.collection.file)
	if info.Mode().Perm() != 0600 {
		t.Fatal(info.Mode())
	}
}
func TestCollectionCancellationAndDuplicateStart(t *testing.T) {
	h := collectionAdmin(t)
	entered := make(chan struct{}, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { entered <- struct{}{}; <-r.Context().Done() }))
	defer upstream.Close()
	defer h.app.Close()
	configureCollection(t, h, catalog.NewsSource{ID: "test_slow", Name: "Slow team", URL: upstream.URL, Channel: "ai"})
	status, body, _ := h.request(t, "POST", "/api/admin/collection", map[string]string{"source": "test_slow"}, h.csrf, true)
	if status != 202 {
		t.Fatal(status, body)
	}
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("upstream not reached")
	}
	if status, _, _ := h.request(t, "POST", "/api/admin/collection", map[string]string{"source": "test_slow"}, h.csrf, true); status != 409 {
		t.Fatal(status)
	}
	h.app.collection.mu.Lock()
	h.app.collection.schedule.Source = "test_slow"
	h.app.collection.schedule.NextRunAt = time.Now().Add(-time.Hour)
	h.app.collection.mu.Unlock()
	h.app.collectIfDue(time.Now())
	h.app.collection.mu.Lock()
	runCount := len(h.app.collection.runs)
	h.app.collection.mu.Unlock()
	if runCount != 1 {
		t.Fatal("scheduler overlapped manual task")
	}
	path := "/api/admin/collection/" + body["id"].(string) + "/cancel"
	if status, _, _ := h.request(t, "POST", path, nil, "", true); status != 403 {
		t.Fatal(status)
	}
	if status, _, _ := h.request(t, "POST", path, nil, h.csrf, true); status != 202 {
		t.Fatal(status)
	}
	run := awaitCollection(t, h)
	if run["status"] != "cancelled" || run["sources"].([]any)[0].(map[string]any)["state"] != "cancelled" {
		t.Fatal(run)
	}
	if status, _, _ := h.request(t, "POST", path, nil, h.csrf, true); status != 409 {
		t.Fatal(status)
	}
}
func TestCollectionInterruptedHistory(t *testing.T) {
	dir := t.TempDir()
	raw := `[{"id":"old-run","status":"running","sources":[{"source":"a","state":"completed","added":4},{"source":"b","state":"running"}]}]`
	os.WriteFile(filepath.Join(dir, "collection-runs.json"), []byte(raw), 0600)
	manager, err := newCollectionManager(dir)
	if err != nil {
		t.Fatal(err)
	}
	run := manager.runs[0]
	if run.Status != "interrupted" || run.FinishedAt == nil || run.Sources[0].Added != 4 || run.Sources[1].State != "interrupted" {
		t.Fatal(run)
	}
}

func TestCollectionScheduleDueRecoveryAndManualClock(t *testing.T) {
	h := collectionAdmin(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<rss><channel><item><title>Scheduled research</title><link>https://example.org/scheduled</link></item></channel></rss>`)
	}))
	defer upstream.Close()
	defer h.app.Close()
	configureCollection(t, h, catalog.NewsSource{ID: "test_timer", Name: "Scheduled team", URL: upstream.URL, Channel: "ai"})
	m := h.app.collection
	m.schedule.Source = "test_timer"
	m.schedule.NextRunAt = time.Now().Add(-48 * time.Hour)
	if err := m.saveSchedule(); err != nil {
		t.Fatal(err)
	}
	// Real background scheduler immediately catches up once after downtime.
	h.app.StartCollectionScheduler()
	run := awaitCollection(t, h)
	if run["trigger"] != "scheduled" || run["status"] != "completed" {
		t.Fatal(run)
	}
	m.mu.Lock()
	next := m.schedule.NextRunAt
	count := len(m.runs)
	m.mu.Unlock()
	if count != 1 || !next.After(time.Now()) {
		t.Fatal(count, next)
	}
	h.app.collectIfDue(time.Now())
	if status, body, _ := h.request(t, "POST", "/api/admin/collection", map[string]string{"source": "test_timer"}, h.csrf, true); status != 202 {
		t.Fatal(status, body)
	}
	run = awaitCollection(t, h)
	if run["trigger"] != "manual" {
		t.Fatal(run)
	}
	m.mu.Lock()
	unchanged := m.schedule.NextRunAt.Equal(next)
	count = len(m.runs)
	m.mu.Unlock()
	if !unchanged || count != 2 {
		t.Fatal("manual collection changed schedule", count)
	}
	h.app.Close()
	restored, err := newCollectionManager(filepath.Dir(m.file))
	if err != nil || !restored.schedule.NextRunAt.Equal(next) || restored.schedule.LastRunAt == nil {
		t.Fatal(restored, err)
	}
}

func TestCollectionSchedulePermissionsPauseAndValidation(t *testing.T) {
	h := collectionAdmin(t)
	path := "/api/admin/collection/schedule"
	input := map[string]any{"enabled": false, "intervalHours": 12, "source": "ai"}
	if status, _, _ := h.request(t, "POST", path, input, "", true); status != 403 {
		t.Fatal(status)
	}
	if status, body, _ := h.request(t, "POST", path, input, h.csrf, true); status != 200 || body["enabled"] != false {
		t.Fatal(status, body)
	}
	h.app.collectIfDue(time.Now().Add(72 * time.Hour))
	if len(h.app.collection.runs) != 0 {
		t.Fatal("paused schedule executed")
	}
	input["intervalHours"] = 0
	if status, _, _ := h.request(t, "POST", path, input, h.csrf, true); status != 400 {
		t.Fatal(status)
	}
	input["intervalHours"], input["enabled"] = 3, true
	if status, _, _ := h.request(t, "POST", path, input, h.csrf, true); status != 200 {
		t.Fatal(status)
	}
	restored, err := newCollectionManager(filepath.Dir(h.app.collection.file))
	if err != nil || restored.schedule.IntervalHours != 3 || !restored.schedule.Enabled || !restored.schedule.NextRunAt.After(time.Now()) {
		t.Fatal(restored, err)
	}
	current, _ := h.app.Store.Session(h.cookie.Value)
	h.app.Store.DB.Exec(`UPDATE users SET role='user' WHERE id=?`, current.UserID)
	if status, _, _ := h.request(t, "POST", path, input, h.csrf, true); status != 403 {
		t.Fatal(status)
	}
}

func TestDirectoryQueuePersistsCandidatesAndRequiresAdmin(t *testing.T) {
	h := collectionAdmin(t)
	if status, _, _ := h.request(t, "POST", "/api/admin/collection/queue", map[string]string{"source": "source_1"}, "", true); status != 403 {
		t.Fatal(status)
	}
	status, v, _ := h.request(t, "POST", "/api/admin/collection/queue", map[string]string{"source": "source_1"}, h.csrf, true)
	if status != 202 || v["state"] != "needs_configuration" {
		t.Fatal(status, v)
	}
	id := v["id"].(string)
	_, v, _ = h.request(t, "POST", "/api/admin/collection/queue", map[string]string{"source": "source_1"}, h.csrf, true)
	if v["id"] != id {
		t.Fatal("duplicate queue item", v)
	}
	recovered, err := newCollectionManager(filepath.Dir(h.app.collection.file))
	if err != nil || len(recovered.queue) != 1 || recovered.queue[0].ID != id {
		t.Fatal(recovered, err)
	}
	if status, _, _ := h.request(t, "POST", "/api/admin/collection/queue/remove", map[string]string{"id": id}, h.csrf, true); status != 200 {
		t.Fatal(status)
	}
	if status, _, _ := h.request(t, "POST", "/api/admin/collection/queue", map[string]string{"source": "https://arbitrary.example"}, h.csrf, true); status != 400 {
		t.Fatal(status)
	}
}
func TestDirectoryQueueRunsConfiguredFeedAndDoesNotReplayClaim(t *testing.T) {
	h := collectionAdmin(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<rss><channel><item><guid>queued-example</guid><title>Queued research</title><link>https://example.org/queue</link></item></channel></rss>`)
	}))
	defer upstream.Close()
	configureCollection(t, h, catalog.NewsSource{ID: "queued_source", Name: "Queued source", URL: upstream.URL, Channel: "ai", Disabled: true, MaxAgeDays: -1})
	status, v, _ := h.request(t, "POST", "/api/admin/collection/queue", map[string]string{"source": "queued_source"}, h.csrf, true)
	if status != 202 || v["state"] != "running" {
		t.Fatal(status, v)
	}
	run := awaitCollection(t, h)
	if run["status"] != "completed" || run["queueId"] != v["id"] {
		t.Fatal(run, v)
	}
	sources, err := catalog.LoadNewsSources(h.app.Config.Root, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range sources {
		if source.ID == "queued_source" && source.Disabled {
			t.Fatal("source still disabled")
		}
	}
	item := collectionQueueItem{ID: v["id"].(string), Source: "queued_source", State: "queued"}
	if err := saveCollectionJSON(h.app.collection.queueFile(), []collectionQueueItem{item}); err != nil {
		t.Fatal(err)
	}
	recovered, err := newCollectionManager(filepath.Dir(h.app.collection.file))
	if err != nil || len(recovered.queue) != 0 {
		t.Fatal("claimed item replayed", err)
	}
}

func TestQueuedFeedWaitsForActiveRunAndDrainsAfterCompletion(t *testing.T) {
	h := collectionAdmin(t)
	release := make(chan struct{})
	started := make(chan struct{}, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/first" {
			started <- struct{}{}
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
		}
		fmt.Fprint(w, `<rss><channel><item><title>Research</title><link>https://example.org/queued</link></item></channel></rss>`)
	}))
	defer upstream.Close()
	configureCollection(t, h, catalog.NewsSource{ID: "queue_first", Name: "First", URL: upstream.URL + "/first", Channel: "ai"}, catalog.NewsSource{ID: "queue_second", Name: "Second", URL: upstream.URL + "/second", Channel: "ai"})
	status, _, _ := h.request(t, "POST", "/api/admin/collection", map[string]string{"source": "queue_first"}, h.csrf, true)
	if status != 202 {
		close(release)
		t.Fatal(status)
	}
	<-started
	status, item, _ := h.request(t, "POST", "/api/admin/collection/queue", map[string]string{"source": "queue_second"}, h.csrf, true)
	close(release)
	if status != 202 || item["state"] != "queued" {
		t.Fatal(status, item)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		_, v, _ := h.request(t, "GET", "/api/admin/collection", nil, "", true)
		runs := v["runs"].([]any)
		if len(runs) == 2 && runs[0].(map[string]any)["status"] == "completed" {
			if runs[0].(map[string]any)["selection"] != "queue_second" || len(v["queue"].([]any)) != 0 {
				t.Fatal(v)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("queued source never completed")
}
