package trend

import (
	"cmp"
	"slices"
	"strings"
)

const maxEvidence = 3

type topicCount struct {
	current, previous int
	keywords          map[string]int
	title, abstract   []Evidence
}

var expandedAcronyms = map[string]string{
	"retrieval augmented generation":                 "rag",
	"reinforcement learning from human feedback":     "rlhf",
	"reinforcement learning with verifiable rewards": "rlvr",
	"group relative policy optimization":             "grpo",
	"direct preference optimization":                 "dpo",
	"vision language models":                         "vlm",
	"multimodal large language models":               "mllm",
	"vision language action":                         "vla",
}

var keywordVariants = map[string]string{
	"llm as a judge": "LLM-as-a-judge",
	"llm as judge":   "LLM-as-a-judge",
	"llm judge":      "LLM-as-a-judge",
	"llm judges":     "LLM-as-a-judge",
	"graph rag":      "GraphRAG",
	"graphrag":       "GraphRAG",
}

func (count *topicCount) add(def topic, paper paper, title, abstract string, focus []string, current bool) bool {
	titleMatch, abstractMatch := "", ""
	matched := map[string]bool{}
	for _, alias := range def.aliases {
		keyword := alias
		if strings.HasSuffix(alias, "s") && slices.Contains(def.aliases, strings.TrimSuffix(alias, "s")) {
			keyword = strings.TrimSuffix(alias, "s")
		}
		if canonical := keywordVariants[keyword]; canonical != "" {
			keyword = canonical
		}
		acronym := expandedAcronyms[alias]
		direct := hasPhrase(title, alias)
		if direct || (acronym != "" && hasPhrase(abstract, alias) && (hasPhrase(title, acronym) || hasPhrase(title, acronym+"s"))) {
			if titleMatch == "" {
				titleMatch = "标题：" + alias
				if !direct {
					titleMatch = "标题缩写，摘要全称：" + alias
				}
			}
			matched[keyword] = true
			continue
		}
		for _, clause := range focus {
			if hasPhrase(clause, alias) {
				if abstractMatch == "" {
					abstractMatch = alias
				}
				matched[keyword] = true
				break
			}
		}
	}
	if len(matched) == 0 {
		return false
	}
	if !current {
		count.previous++
		return true
	}
	count.current++
	if count.keywords == nil {
		count.keywords = map[string]int{}
	}
	for keyword := range matched {
		count.keywords[keyword]++
	}
	if titleMatch != "" {
		count.title = recentEvidence(count.title, paper.evidence(titleMatch))
	} else {
		count.abstract = recentEvidence(count.abstract, paper.evidence("摘要贡献："+abstractMatch))
	}
	return true
}

func recentEvidence(evidence []Evidence, item Evidence) []Evidence {
	if len(evidence) == maxEvidence && item.Date <= evidence[len(evidence)-1].Date {
		return evidence
	}
	evidence = append(evidence, item)
	slices.SortStableFunc(evidence, func(left, right Evidence) int { return cmp.Compare(right.Date, left.Date) })
	return evidence[:min(len(evidence), maxEvidence)]
}

func (count topicCount) result(def topic, report Report) Topic {
	keywords := make([]string, 0, len(count.keywords))
	for keyword := range count.keywords {
		keywords = append(keywords, keyword)
	}
	slices.SortFunc(keywords, func(left, right string) int {
		return cmp.Or(cmp.Compare(count.keywords[right], count.keywords[left]), cmp.Compare(left, right))
	})
	keywords = keywords[:min(len(keywords), 4)]
	canonical := normalize(def.keyword)
	for index, keyword := range keywords {
		if keyword == canonical || keyword+"s" == canonical {
			keywords[index] = def.keyword
		}
	}
	share := 100 * float64(count.current) / float64(report.Current.Papers)
	var change *float64
	if report.Comparable {
		value := share - 100*float64(count.previous)/float64(report.Previous.Papers)
		change = &value
	}
	evidence := append(count.title, count.abstract[:min(len(count.abstract), maxEvidence-len(count.title))]...)
	return Topic{def.id, def.label, keywords, count.current, count.previous, share, change, evidence}
}

type phraseCount struct {
	count       int
	firstDay    string
	severalDays bool
	evidence    []Evidence
}

var connectors = wordSet("a an the and or of for to in at on by from via with through as over across into beyond under towards using based is are was were how what when which can do does not s")
var genericWords = wordSet("large small new novel next better general generic robust efficient effective enhanced adaptive improved advanced unified comprehensive systematic empirical scalable open real strong simple practical reliable realistic fast training learning deep performance results system systems approach approaches method methods framework frameworks model models task tasks problem problems study studies analysis survey benchmark benchmarks dataset datasets evaluation evaluations case research generation understanding towards grounded assessing exploring measuring evaluating improves improve improving powered based driven augmented leveraging toward revisiting revisited building unlocking enabling enhancing")
var genericPhrases = strings.Split("artificial intelligence|language model|language models|machine learning|question answering|natural language|natural language processing|neural network|neural networks|end to end|state of the art|experimental results|real world|human performance|case study|fine tuning|long horizon|multi turn|multi hop|self evolving|neuro symbolic|few shot|zero shot|open source|based on|data driven|context aware|world wide", "|")

func wordSet(text string) map[string]bool {
	set := map[string]bool{}
	for _, word := range strings.Fields(text) {
		set[word] = true
	}
	return set
}

func addPhrases(counts map[string]*phraseCount, known map[string]bool, paper paper, title, abstract string) {
	seen := map[string]bool{}
	words := strings.Fields(title)
	for start, first := range words {
		if len(first) < 3 || connectors[first] || genericWords[first] {
			continue
		}
		for end := start + 2; end <= min(start+4, len(words)); end++ {
			last := words[end-1]
			if len(last) < 3 || connectors[last] || (genericWords[last] && end-start == 2) {
				continue
			}
			phrase := strings.Join(words[start:end], " ")
			if known[phrase] || known[strings.TrimSuffix(phrase, "s")] || seen[phrase] || !hasPhrase(abstract, phrase) {
				continue
			}
			seen[phrase] = true
			count := counts[phrase]
			if count == nil {
				count = &phraseCount{firstDay: paper.day}
				counts[phrase] = count
			}
			count.count++
			count.severalDays = count.severalDays || count.firstDay != paper.day
			count.evidence = recentEvidence(count.evidence, paper.evidence("标题与摘要"))
		}
	}
}

func knownPhrases(definitions []topic) map[string]bool {
	known := map[string]bool{}
	for _, phrase := range genericPhrases {
		known[phrase] = true
	}
	for _, def := range definitions {
		for _, alias := range def.aliases {
			words := strings.Fields(alias)
			for start := range words {
				for end := start + 2; end <= min(start+4, len(words)); end++ {
					known[strings.Join(words[start:end], " ")] = true
				}
			}
		}
	}
	return known
}

func topPhrases(counts map[string]*phraseCount) []Candidate {
	eligible := []Candidate{}
	for phrase, count := range counts {
		if count.count >= minTopicPapers && count.severalDays {
			eligible = append(eligible, Candidate{phrase, count.count, count.evidence})
		}
	}
	slices.SortFunc(eligible, func(left, right Candidate) int {
		return cmp.Or(cmp.Compare(right.Count, left.Count), cmp.Compare(len(right.Phrase), len(left.Phrase)), cmp.Compare(left.Phrase, right.Phrase))
	})
	out := []Candidate{}
	for _, candidate := range eligible {
		covered := false
		for _, selected := range out {
			if hasPhrase(" "+selected.Phrase+" ", candidate.Phrase) || hasPhrase(" "+candidate.Phrase+" ", selected.Phrase) ||
				strings.TrimSuffix(candidate.Phrase, "s") == strings.TrimSuffix(selected.Phrase, "s") {
				covered = true
				break
			}
		}
		if !covered {
			out = append(out, candidate)
		}
		if len(out) == 8 {
			break
		}
	}
	return out
}
