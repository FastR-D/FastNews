package catalog

import (
	"regexp"
	"strings"
)

type TopicMatch struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Basis    string `json:"basis"`
	Evidence string `json:"evidence"`
}
type topicRule struct {
	ID, Label string
	Pattern   *regexp.Regexp
}

func rule(id, label, pattern string) topicRule {
	return topicRule{id, label, regexp.MustCompile("(?i)" + pattern)}
}

var topicRules = []topicRule{
	rule("coding-agents", "Coding Agents", `\b(coding agents?|software (engineering |development )?agents?|swe[- ]agents?)\b`),
	rule("code-generation", "代码生成", `\b(code generation|program synthesis|code completion|text.to.code)\b`),
	rule("program-repair", "程序修复与 Issue 解决", `\b(program repair|bug fix(es|ing)?|issue resolution|repairing (code|programs?)|patch generation)\b`),
	rule("software-testing", "软件测试", `\b(test generation|unit test(s|ing)?|software testing|fuzzing)\b`),
	rule("program-analysis", "程序分析与代码理解", `\b(program analysis|static analysis|code understanding|code review|vulnerability detection)\b`),
	rule("repository-agents", "仓库级任务", `\b(repository.level|repo.level|repository scale|codebase|software issue resolution|swe.bench)\b`),
	rule("agent-evaluation", "智能体评测", `\b(swe.bench|agentbench|webarena|osworld|agent(s|ic)? (evaluation|benchmark)|evaluat\w*[^.]{0,50}agents?)\b`),
	rule("multi-agent", "多智能体协作", `\b(multi.agent|agent collaboration|agentic workflow)\b`),
	rule("tool-use", "工具调用与交互", `\b(tool (use|calling|learning)|function calling|computer.use|web agents?)\b`),
	rule("reasoning-planning", "推理与规划", `\b(chain.of.thought|reasoning|planning|test.time (scaling|compute))\b`),
	rule("retrieval-memory", "检索与记忆", `\b(retrieval.augmented|long.term memory|agent memory|knowledge retrieval)\b`),
	rule("alignment-safety", "对齐与安全", `\b(alignment|rlhf|dpo|jailbreak|prompt injection|ai safety|llm safety|preference optimi[sz]ation)\b`),
	rule("reinforcement-learning", "强化学习", `\b(reinforcement learning|policy gradient|q.learning|offline rl|online rl)\b`),
	rule("training-efficiency", "训练与推理效率", `\b(quantization|pruning|distillation|efficient inference|efficient training|low.rank adaptation|mixture.of.experts)\b`),
	rule("multimodal", "视觉与多模态", `\b(multimodal|multi.modal|vision.language|visual reasoning|image generation|video generation)\b`),
	rule("generative-models", "生成模型", `\b(diffusion models?|flow matching|generative models?|normalizing flows?)\b`),
	rule("theory-optimization", "理论与优化", `\b(generalization bound|convergence|sample complexity|regret bound|stochastic optimi[sz]ation)\b`),
	rule("graph-learning", "图学习", `\b(graph neural|graph learning|graph representation)\b`),
	rule("robotics", "机器人与具身智能", `\b(robot(s|ic|ics)?|embodied|manipulation|locomotion)\b`),
	rule("ai-for-science", "AI for Science", `\b(protein|molecular|drug discovery|scientific discovery|weather forecasting)\b`),
}

func TopicLabels() map[string]string {
	out := map[string]string{}
	for _, r := range topicRules {
		out[r.ID] = r.Label
	}
	return out
}
func ValidTopic(id string) bool { _, ok := TopicLabels()[id]; return ok }

var agentSignal = regexp.MustCompile(`(?i)\b(agent(s|ic)?|autonomous|tool.use)\b`)
var softwareSignal = regexp.MustCompile(`(?i)\b(code|coding|software|programming|repository|codebase|swe.bench|program repair)\b`)

// ClassifyTopics is a transparent, versioned retrieval classifier, not a claim of
// human verification. It reads publisher evidence only, never generated summaries.
func ClassifyTopics(title, abstract, keywords string) []TopicMatch {
	out := []TopicMatch{}
	evidence := strings.TrimSpace(abstract + " " + keywords)
	for _, r := range topicRules {
		basis, value := "abstract", evidence
		match := r.Pattern.FindStringIndex(value)
		if match == nil {
			basis, value = "title", title
			match = r.Pattern.FindStringIndex(value)
		}
		if r.ID == "coding-agents" && match == nil {
			for _, candidate := range []struct{ basis, value string }{{"abstract", evidence}, {"title", title}} {
				if agentSignal.MatchString(candidate.value) && softwareSignal.MatchString(candidate.value) {
					basis, value = candidate.basis, candidate.value
					match = agentSignal.FindStringIndex(value)
					break
				}
			}
		}
		if match == nil {
			continue
		}
		// Snippet comes verbatim from its declared evidence field.
		start, end := max(0, match[0]-70), min(len(value), match[1]+140)
		for start > 0 && (value[start]&0xc0) == 0x80 {
			start--
		}
		for end < len(value) && (value[end]&0xc0) == 0x80 {
			end++
		}
		out = append(out, TopicMatch{r.ID, r.Label, basis, value[start:end]})
	}
	return out
}
func HasTopic(p Paper, id string) bool {
	for _, t := range p.Topics {
		if t.ID == id {
			return true
		}
	}
	return false
}
