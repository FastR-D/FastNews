package catalog

import (
	"encoding/json"
	"regexp"
	"strings"
)

type Entity struct {
	Name  string `json:"name"`
	URL   string `json:"url,omitempty"`
	ORCID string `json:"orcid,omitempty"`
	ROR   string `json:"ror,omitempty"`
}
type Scholar struct {
	Entity
	Affiliations []Entity `json:"affiliations,omitempty"`
}

var authorSeparator = regexp.MustCompile(`\s*(?:;|；|,|，|\band\b)\s*`)

var institutionWords = regexp.MustCompile(`(?i)\b(university|institute|college|research|laborator|academy|school|google|microsoft|bytedance|meta|openai|huawei|ibm|amazon)\b`)

func SplitAuthors(value string) []Scholar {
	out := []Scholar{}
	for _, group := range strings.FieldsFunc(value, func(r rune) bool { return r == ';' || r == '；' }) {
		namePart := group
		var affiliations []Entity
		if comma := strings.Index(group, ","); comma >= 0 && institutionWords.MatchString(group[comma+1:]) {
			namePart = group[:comma]
			affiliations = []Entity{{Name: strings.TrimSpace(group[comma+1:])}}
		}
		for _, name := range authorSeparator.Split(namePart, -1) {
			name = strings.TrimSpace(name)
			if name != "" {
				out = append(out, Scholar{Entity: Entity{Name: name}, Affiliations: affiliations})
			}
		}
	}
	return out
}

func DecoratePaper(p *Paper, row map[string]any) {
	p.Topics = ClassifyTopics(p.Title, Str(row, "description"), Str(row, "keywords"))
	p.Track = First(Str(row, "track"), "unknown")
	if p.Track == "conference" {
		p.Track = "main"
	}
	p.Presentation = Str(row, "presentation")
	if p.SummaryStatus == "" {
		p.SummaryStatus = "summarized"
	}
	if raw, ok := row["authors_list"]; ok {
		b, _ := json.Marshal(raw)
		_ = json.Unmarshal(b, &p.AuthorsList)
	}
	if len(p.AuthorsList) == 0 {
		p.AuthorsList = SplitAuthors(p.Author)
	}
	seen := map[string]bool{}
	for _, a := range p.AuthorsList {
		for _, org := range a.Affiliations {
			key := strings.ToLower(org.Name)
			if key != "" && !seen[key] {
				seen[key] = true
				p.Institutions = append(p.Institutions, org)
			}
		}
	}
}
