package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"time"

	"github.com/FastR-D/FastNews/internal/catalog"
)

const maxSourceBytes = 16 << 20

type boundedOutput struct{ bytes.Buffer }

func (b *boundedOutput) Write(p []byte) (int, error) {
	if len(p) > maxSourceBytes-b.Len() {
		return 0, fmt.Errorf("source too large")
	}
	return b.Buffer.Write(p)
}

func relayFetch(ctx context.Context, config, url string) ([]byte, error) {
	if config == "" {
		return nil, fmt.Errorf("采集跳板机尚未配置")
	}
	ctx, cancel := context.WithTimeout(ctx, 100*time.Second)
	defer cancel()
	request, _ := json.Marshal(map[string]string{"url": url})
	command := exec.CommandContext(ctx, "ssh", "-F", config, "fastnews-fetch")
	command.Stdin = bytes.NewReader(request)
	command.WaitDelay = 3 * time.Second
	output := &boundedOutput{}
	command.Stdout = output
	// Diagnostics intentionally exclude remote text, keys and SSH configuration.
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("新加坡采集失败，请检查信源可达性与跳板机连接")
	}
	return output.Bytes(), nil
}

func (p *Pipeline) fetchSource(ctx context.Context, source catalog.NewsSource) ([]byte, string, error) {
	if source.Transport == "relay" {
		raw, err := relayFetch(ctx, p.Config.FetchRelaySSHConfig, source.URL)
		return raw, "relay", err
	}
	limit := int64(16 << 20)
	if source.Format == "nvd" {
		limit = 64 << 20
	}
	raw, err := getWithLimit(ctx, source.URL, 45*time.Second, limit)
	if err == nil || source.Transport != "auto" || ctx.Err() != nil {
		return raw, "direct", err
	}
	var status *sourceHTTPError
	// A second network route is not a captcha or rate-limit bypass.
	if errors.As(err, &status) && (status.Status == 401 || status.Status == 403 || status.Status == 429) {
		return nil, "direct", err
	}
	raw, err = relayFetch(ctx, p.Config.FetchRelaySSHConfig, source.URL)
	return raw, "relay", err
}
