package catalog

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type ConferenceJobStatus struct {
	Stage         string     `json:"stage"`
	State         string     `json:"state"`
	StartedAt     time.Time  `json:"startedAt"`
	EndedAt       *time.Time `json:"endedAt,omitempty"`
	LastSuccessAt *time.Time `json:"lastSuccessAt,omitempty"`
	ErrorKind     string     `json:"errorKind,omitempty"`
	HTTPStatus    int        `json:"httpStatus,omitempty"`
}

type ConferenceCoverage struct {
	Conference     string               `json:"conference"`
	Name           string               `json:"name"`
	Year           int                  `json:"year"`
	Papers         int                  `json:"papers"`
	Abstracts      int                  `json:"abstracts"`
	Summaries      int                  `json:"summaries"`
	StaleSummaries int                  `json:"staleSummaries"`
	UpdatedAt      *time.Time           `json:"updatedAt,omitempty"`
	Job            *ConferenceJobStatus `json:"job,omitempty"`
}

func (c *Catalog) ConferenceJob(conf string, year int) (*ConferenceJobStatus, error) {
	body, err := os.ReadFile(filepath.Join(c.Root, "top-conf/data/job_status", fmt.Sprintf("%s_%d.json", conf, year)))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var result ConferenceJobStatus
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *Catalog) Coverage() ([]ConferenceCoverage, error) {
	keys := map[string]bool{}
	for _, pattern := range []string{"top-conf/data/conferences/*.jsonl", "top-conf/data/job_status/*.json"} {
		files, err := filepath.Glob(filepath.Join(c.Root, pattern))
		if err != nil {
			return nil, err
		}
		for _, file := range files {
			keys[strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))] = true
		}
	}
	out := []ConferenceCoverage{}
	for key := range keys {
		at := strings.LastIndex(key, "_")
		if at < 0 {
			continue
		}
		conf := key[:at]
		metadata, ok := Conferences[conf]
		if !ok {
			continue
		}
		year, err := strconv.Atoi(key[at+1:])
		if err != nil || year < 2000 || year > 2100 {
			continue
		}
		rows, err := c.ConferenceRows(conf, year)
		if err != nil {
			return nil, err
		}
		papers := map[string]map[string]any{}
		for _, row := range rows {
			if id := First(Str(row, "_id"), Str(row, "link")); id != "" {
				papers[id] = row
			}
		}
		entry := ConferenceCoverage{Conference: conf, Name: metadata.Name, Year: year, Papers: len(papers)}
		for _, row := range papers {
			if strings.TrimSpace(Str(row, "description")) != "" {
				entry.Abstracts++
			}
		}
		summaries, err := Rows(filepath.Join(c.Root, "top-conf/data/summary", key+"_summary.jsonl"))
		if err != nil {
			return nil, err
		}
		latest := map[string]map[string]any{}
		for _, row := range summaries {
			if paper, ok := row["paper"].(map[string]any); ok {
				latest[First(Str(paper, "_id"), Str(paper, "link"))] = row
			}
		}
		for id, summary := range latest {
			paper := papers[id]
			if paper == nil {
				continue
			}
			if ConferenceSourceHash(paper) != Str(summary, "source_hash") {
				entry.StaleSummaries++
				continue
			}
			if Str(summary, "category") != "" && Str(object(summary, "paper"), "summary_zh") != "" {
				entry.Summaries++
			}
		}
		for _, path := range []string{"conferences/" + key + ".jsonl", "abstracts/" + key + ".jsonl", "summary/" + key + "_summary.jsonl"} {
			info, err := os.Stat(filepath.Join(c.Root, "top-conf/data", path))
			if os.IsNotExist(err) {
				continue
			}
			if err != nil {
				return nil, err
			}
			modified := info.ModTime().UTC()
			if entry.UpdatedAt == nil || modified.After(*entry.UpdatedAt) {
				entry.UpdatedAt = &modified
			}
		}
		entry.Job, err = c.ConferenceJob(conf, year)
		if err != nil {
			return nil, err
		}
		out = append(out, entry)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Year != out[j].Year {
			return out[i].Year > out[j].Year
		}
		return out[i].Conference < out[j].Conference
	})
	return out, nil
}
