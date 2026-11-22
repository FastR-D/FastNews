package jobs

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/store"
)

type sourceHTTPError struct{ Status int }

func (e *sourceHTTPError) Error() string { return fmt.Sprintf("source returned HTTP %d", e.Status) }

// RunConferenceJob owns operator-visible CLI status; it never saves raw URLs/errors.
func (p *Pipeline) RunConferenceJob(ctx context.Context, stage, conf string, year, limit int, override string) (result error) {
	metadata, err := conferenceInfo(conf, year)
	if err != nil {
		return err
	}
	switch stage {
	case "fetch-conf":
		if _, err := ConferenceURLs(conf, year); err != nil {
			return err
		}
	case "enrich-abstracts":
		if metadata.Provider != "neurips-proceedings" || limit < 0 {
			return fmt.Errorf("unsupported abstract source or limit")
		}
	case "summarize-conf":
	default:
		return fmt.Errorf("unknown conference job")
	}
	previous, err := p.Catalog.ConferenceJob(conf, year)
	if err != nil {
		return err
	}
	status := catalog.ConferenceJobStatus{Stage: stage, State: "started", StartedAt: time.Now().UTC()}
	if previous != nil {
		status.LastSuccessAt = previous.LastSuccessAt
	}
	file := filepath.Join(p.Config.Root, "top-conf/data/job_status", fmt.Sprintf("%s_%d.json", conf, year))
	if err := writeJSON(file, status); err != nil {
		return err
	}
	defer func() {
		ended := time.Now().UTC()
		status.EndedAt = &ended
		status.State = "completed"
		if result == nil {
			status.LastSuccessAt = &ended
		} else {
			status.State = "failed"
			status.ErrorKind = "processing"
			var network *url.Error
			var source *sourceHTTPError
			var storage *os.PathError
			var model *store.Error
			switch {
			case errors.As(result, &source):
				status.ErrorKind = "source_http"
				status.HTTPStatus = source.Status
			case errors.As(result, &network):
				status.ErrorKind = "network"
			case errors.As(result, &storage):
				status.ErrorKind = "storage"
			case errors.As(result, &model):
				status.ErrorKind = "model"
				status.HTTPStatus = model.Status
			}
		}
		result = errors.Join(result, writeJSON(file, status))
	}()
	result = errors.New("conference job did not return")
	switch stage {
	case "fetch-conf":
		result = p.FetchConference(ctx, conf, year, override)
	case "enrich-abstracts":
		result = p.EnrichConferenceAbstracts(ctx, conf, year, limit)
	default:
		result = p.SummarizeConference(ctx, conf, year)
	}
	return result
}
