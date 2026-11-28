package catalog

import (
	"net/url"
	"regexp"
	"strings"
)

var csCategory = regexp.MustCompile(`(?i)^cs\.[a-z]+$`)

// Computer-science collection uses the primary subject, not a cross-list tag.
// Existing official arXiv records store the primary category first.
func IsCSArxiv(row map[string]any) bool {
	primary := Str(row, "primary_category")
	if primary == "" {
		switch categories := row["categories"].(type) {
		case []string:
			if len(categories) > 0 {
				primary = categories[0]
			}
		case []any:
			if len(categories) > 0 {
				primary, _ = categories[0].(string)
			}
		}
	}
	return csCategory.MatchString(strings.TrimSpace(primary))
}

func InResearchScope(row map[string]any) bool {
	isArxiv := NewsChannel(row) == "arxiv"
	if u, err := url.Parse(Str(row, "link")); err == nil {
		host := strings.ToLower(u.Hostname())
		isArxiv = isArxiv || host == "arxiv.org" || strings.HasSuffix(host, ".arxiv.org")
	}
	return !isArxiv || IsCSArxiv(row)
}
