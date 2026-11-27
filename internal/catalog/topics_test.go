package catalog

import "testing"

func TestTopicsDistinguishCodingAgentsFromOtherAgents(t *testing.T) {
	for _, tt := range []struct {
		title, abstract string
		coding          bool
		basis           string
	}{
		{"Multi-agent reinforcement learning for traffic control", "", false, ""},
		{"Code generation with transformers", "", false, ""},
		{"Coding Agents in Software Engineering", "", true, "title"},
		{"A new system", "We introduce agents that execute tools to resolve software issues and generate patches.", true, "abstract"},
		{"Representation learning", "We propose a new diffusion model.", false, ""},
	} {
		t.Run(tt.title, func(t *testing.T) {
			found := false
			for _, topic := range ClassifyTopics(tt.title, tt.abstract, "") {
				if topic.ID == "coding-agents" {
					found = true
					if topic.Basis != tt.basis || topic.Evidence == "" {
						t.Fatal(topic)
					}
				}
			}
			if found != tt.coding {
				t.Fatalf("coding match = %v", found)
			}
		})
	}
}
func TestLegacyAffiliationsAreNotScholars(t *testing.T) {
	people := SplitAuthors("Alice Example, Example University; Bob Example, Example Institute, China")
	if len(people) != 2 || people[0].Name != "Alice Example" || len(people[0].Affiliations) != 1 || people[1].Affiliations[0].Name != "Example Institute, China" {
		t.Fatal(people)
	}
	if len(SplitAuthors("Alice Example, Bob Example, Carol Example")) != 3 {
		t.Fatal("author-only list misparsed")
	}
}
