package httpapi

import (
	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/store"
	"net/http"
	"strings"
)

func (s *Server) entity(w http.ResponseWriter, r *http.Request) error {
	if r.Method != "GET" {
		return store.Fail(405, "Method not allowed")
	}
	name, kind, ref := strings.TrimSpace(r.URL.Query().Get("name")), r.URL.Query().Get("kind"), r.URL.Query().Get("ref")
	if name == "" || len(name) > 600 || (kind != "author" && kind != "institution") || len(ref) > 2048 {
		return store.Fail(400, "作者或机构参数无效")
	}
	papers, err := s.Catalog.Papers()
	if err != nil {
		return err
	}
	// Repair old links that classified a known affiliation as a person. Only
	// switch when no actual scholar matches; don't guess identities by keywords.
	if kind == "author" && ref == "" {
		hasAuthor, hasInstitution := false, false
		for _, paper := range papers {
			for _, author := range paper.AuthorsList {
				hasAuthor = hasAuthor || strings.EqualFold(author.Name, name)
			}
			for _, org := range paper.Institutions {
				hasInstitution = hasInstitution || strings.EqualFold(org.Name, name)
			}
		}
		if !hasAuthor && hasInstitution {
			kind = "institution"
		}
	}
	out := []catalog.Paper{}
	entity := catalog.Entity{Name: name}
	affiliations := []catalog.Entity{}
	seen := map[string]bool{}
	for _, p := range papers {
		matched := false
		if kind == "author" {
			for _, a := range p.AuthorsList {
				if !strings.EqualFold(strings.TrimSpace(a.Name), name) {
					continue
				}
				if ref != "" && a.URL != ref {
					continue
				}
				entity = a.Entity
				matched = true
				for _, org := range a.Affiliations {
					if !seen[org.Name] {
						affiliations = append(affiliations, org)
						seen[org.Name] = true
					}
				}
			}
		}
		if kind == "institution" {
			for _, org := range p.Institutions {
				if strings.EqualFold(strings.TrimSpace(org.Name), name) && (ref == "" || ref == org.URL) {
					entity = org
					matched = true
				}
			}
		}
		if matched {
			out = append(out, p)
		}
	}
	// Never infer a personal identity by a name match alone.
	mode := "name"
	if ref != "" {
		mode = "source-profile"
	}
	reply(w, r, 200, map[string]any{"entity": entity, "kind": kind, "match": mode, "affiliations": affiliations, "papers": out, "total": len(out)})
	return nil
}
