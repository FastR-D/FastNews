package catalog

import (
	"encoding/json"
	"regexp"
	"strings"
	"unicode"
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

var institutionWords = regexp.MustCompile(`(?i)\b(university|institute|college|research|laborator|academy|school|google|microsoft|bytedance|meta|openai|huawei|ibm|amazon)\b`)

func SplitAuthors(value string) []Scholar {
	out := []Scholar{}
	for _, group := range splitAuthorText(value, ";；", false) {
		// An institution after a group of names applies to that whole group.
		// Affiliation punctuation is preserved; parenthesized author tokens are
		// never mistaken for institutions merely because their suffix says University.
		parts := splitAuthorText(group, ",，", false)
		unitStart := -1
		for i, part := range parts {
			prefix := strings.SplitN(strings.ReplaceAll(part, "（", "("), "(", 2)[0]
			if institutionWords.MatchString(prefix) {
				unitStart = i
				break
			}
		}
		if unitStart > 0 {
			units := splitInstitutions(strings.Join(parts[unitStart:], ", "))
			for _, name := range splitAuthorText(strings.Join(parts[:unitStart], ", "), ",，", true) {
				out = append(out, Scholar{Entity: Entity{Name: name}, Affiliations: units})
			}
			continue
		}
		for _, person := range splitAuthorText(group, ",，", true) {
			out = append(out, parenthesizedScholar(person))
		}
	}
	return out
}

// Punctuation inside affiliations is content, not an author separator:
// "Paul Pearce (University of California, Irvine)" is one person and one unit.
func splitAuthorText(value, separators string, conjunction bool) []string {
	chars := []rune(value)
	depth, start := 0, 0
	out := []string{}
	add := func(end int) {
		part := strings.TrimSpace(string(chars[start:end]))
		if conjunction {
			part = strings.TrimSpace(strings.TrimPrefix(part, "and "))
		}
		if part != "" {
			out = append(out, part)
		}
	}
	for i := 0; i < len(chars); i++ {
		switch chars[i] {
		case '(', '（':
			depth++
		case ')', '）':
			if depth > 0 {
				depth--
			}
		}
		if depth != 0 {
			continue
		}
		if strings.ContainsRune(separators, chars[i]) {
			add(i)
			start = i + 1
		} else if conjunction && i+5 <= len(chars) && string(chars[i:i+5]) == " and " {
			add(i)
			i += 4
			start = i + 1
		}
	}
	add(len(chars))
	return out
}

func parenthesizedScholar(value string) Scholar {
	person := Scholar{Entity: Entity{Name: strings.TrimSpace(value)}}
	first := strings.IndexAny(value, "(（")
	if first <= 0 {
		return person
	}
	name := strings.TrimSpace(value[:first])
	depth, start := 0, 0
	affiliations := []Entity{}
	chars := []rune(value[first:])
	for i, char := range chars {
		switch char {
		case '(', '（':
			if depth == 0 {
				start = i + 1
			}
			depth++
		case ')', '）':
			if depth == 0 {
				return person
			}
			depth--
			if depth == 0 {
				affiliations = append(affiliations, splitInstitutions(string(chars[start:i]))...)
			}
		default:
			if depth == 0 && !unicode.IsSpace(char) {
				return person
			}
		}
	}
	if depth == 0 && len(affiliations) > 0 {
		person.Name, person.Affiliations = name, affiliations
	}
	return person
}

// Split only clear new institution names; geographic qualifiers such as Irvine
// stay attached to their university instead of becoming independent entities.
func splitInstitutions(value string) []Entity {
	out := []Entity{}
	for _, group := range splitAuthorText(value, ";；", false) {
		start := len(out)
		for i, part := range splitAuthorText(group, ",，", false) {
			if i == 0 || institutionWords.MatchString(part) {
				out = append(out, Entity{Name: part})
			} else {
				out[len(out)-1].Name += ", " + part
			}
		}
		if len(out) == start+1 {
			out[start].Name = group
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
		p.AuthorsList = SplitAuthors(First(Str(row, "author"), p.Author))
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
