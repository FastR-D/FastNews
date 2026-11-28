package catalog

import "testing"

func TestResearchScopeUsesPrimaryArxivCategory(t *testing.T) {
	for _, tc := range []struct {
		primary    string
		categories any
		keep       bool
	}{
		{"cs.AI", []string{"stat.ML", "cs.AI"}, true},
		{"q-bio.QM", []string{"cs.AI", "q-bio.QM"}, false},
		{"", []any{"cs.CR", "math.IT"}, true},
		{"", []any{"physics.med-ph", "cs.AI"}, false},
		{"", []string{}, false},
	} {
		for _, source := range []string{"arxiv_cs_ai", "custom_digest"} {
			row := map[string]any{"source": source, "link": "https://arxiv.org/abs/2611.12345", "primary_category": tc.primary, "categories": tc.categories}
			if InResearchScope(row) != tc.keep {
				t.Fatal(tc, row)
			}
		}
	}
	if !InResearchScope(map[string]any{"source": "openai", "link": "https://openai.com/research"}) {
		t.Fatal("CS research news was excluded")
	}
}
