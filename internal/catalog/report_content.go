package catalog

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ReportNode is a presentation-independent allowlisted document tree. Archived
// scripts, styles, event handlers and embedded documents never reach the app.
type ReportNode struct {
	Paper    map[string]string `json:"paper,omitempty"`
	Tag      string            `json:"tag,omitempty"`
	Text     string            `json:"text,omitempty"`
	ID       string            `json:"id,omitempty"`
	Href     string            `json:"href,omitempty"`
	Children []ReportNode      `json:"children,omitempty"`
}
type ReportContent struct {
	Report  Report       `json:"report"`
	Content []ReportNode `json:"content"`
}

func (c *Catalog) ReadReport(path string) (ReportContent, error) {
	var out ReportContent
	reports, err := c.Reports()
	if err != nil {
		return out, err
	}
	found := false
	for _, r := range reports {
		if r.Path == path {
			out.Report = r
			found = true
			break
		}
	}
	if !found {
		return out, os.ErrNotExist
	}
	root, err := os.OpenRoot(c.Root)
	if err != nil {
		return out, err
	}
	defer root.Close()
	f, err := root.Open(filepath.FromSlash(strings.TrimPrefix(path, "/")))
	if err != nil {
		return out, err
	}
	defer f.Close()
	err = json.NewDecoder(io.LimitReader(f, 32<<20)).Decode(&out.Content)
	return out, err
}
