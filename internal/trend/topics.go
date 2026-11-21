package trend

import (
	"html"
	"regexp"
	"strings"
)

type topic struct {
	id, label, keyword string
	aliases            []string
}

func direction(id, label, keyword, aliases string) topic {
	return topic{id, label, keyword, strings.Split(normalize(keyword)+"|"+aliases, "|")}
}

var taxonomy = map[string][]topic{
	"ai": {
		direction("agents", "智能体与工具调用", "LLM agents", "llm agent|language model agents|ai agent|ai agents|agentic ai|agentic workflow|agentic workflows|multi agent system|multi agent systems|tool calling|tool use|computer use agents|web agents|coding agents|multi agent reinforcement learning"),
		direction("reasoning", "推理与测试时扩展", "Test-time scaling", "test time compute|inference time scaling|inference time compute|chain of thought|mathematical reasoning|reasoning models|reasoning model|process reward models|formal theorem proving|mathematical problem solving|llm reasoning|verifiable reasoning"),
		direction("retrieval", "检索增强与知识接地", "Retrieval-augmented generation", "retrieval augmented language models|retrieval augmented question answering|graph rag|graphrag|agentic rag|rag systems|rag pipelines"),
		direction("post-training", "后训练与偏好对齐", "Preference optimization", "direct preference optimization|reinforcement learning from human feedback|reinforcement learning with verifiable rewards|group relative policy optimization|preference alignment|llm post training|language model post training|llm alignment|instruction tuning|supervised fine tuning|preference learning"),
		direction("multimodal", "多模态与视觉语言理解", "Vision-language models", "vision language model|multimodal large language models|multimodal large language model|multimodal llm|multimodal llms|large multimodal models|large multimodal model|audio language model|audio language models|visual question answering|video understanding|multimodal reasoning"),
		direction("generation", "扩散与视觉生成", "Diffusion models", "diffusion model|diffusion transformer|diffusion transformers|flow matching|text to image generation|text to video generation|video generation|image generation|diffusion language model|diffusion language models"),
		direction("efficiency", "高效训练与模型推理", "Efficient LLM inference", "llm inference acceleration|speculative decoding|kv cache|key value cache|model quantization|llm quantization|weight quantization|post training quantization|model pruning|model compression|parameter efficient fine tuning|low rank adaptation|mixture of experts|efficient language models"),
		direction("trust", "模型安全与鲁棒性", "LLM safety", "ai safety|model safety|language model safety|multimodal safety|prompt injection|jailbreak attack|jailbreak attacks|adversarial robustness|adversarial examples|llm guardrails|safety guardrails|machine unlearning|membership inference|data poisoning|backdoor attack|backdoor attacks"),
		direction("evaluation", "语言模型评估", "LLM evaluation", "language model evaluation|llm as a judge|llm as judge|llm judge|llm judges|benchmark contamination|benchmark leakage|llm benchmarking|evaluation of large language models"),
		direction("interpretability", "可解释性与模型可靠性", "Mechanistic interpretability", "activation patching|sparse autoencoder|sparse autoencoders|concept activation vectors|model interpretability|model explainability|hallucination detection|hallucination mitigation|factual consistency|factuality evaluation|faithfulness evaluation"),
		direction("context", "长上下文与模型记忆", "Long-context modeling", "long context language model|long context language models|long context llm|long context llms|long context windows|long context understanding|long context reasoning|long context learning|long context inference|long context attention|agent memory|llm memory|context compression"),
		direction("embodied", "具身智能与机器人学习", "Embodied AI", "embodied intelligence|embodied agent|embodied agents|robot learning|robotic manipulation|vision language action|robot navigation|robot policy|robot policies|humanoid robots|world model|world models"),
		direction("data", "训练数据与合成数据", "Synthetic data generation", "synthetic training data|synthetic data for training|training data selection|data curation|training data attribution|dataset distillation|data mixtures|instruction data|instruction synthesis"),
		direction("adaptation", "持续学习与领域适配", "Continual learning", "continual pretraining|continual pre training|lifelong learning|catastrophic forgetting|class incremental learning|domain adaptation|test time adaptation|domain generalization|out of distribution generalization"),
		direction("nlp", "多语言与低资源语言技术", "Multilingual NLP", "multilingual llms|multilingual large language models|cross lingual transfer|machine translation|low resource languages|low resource language|low resource nlp|multilingual language models|cross lingual alignment|code switching"),
		direction("science", "科学发现与科学机器学习", "AI for science", "scientific discovery|molecular property prediction|material discovery|materials discovery|physics informed neural networks|neural operators|weather forecasting"),
	},
	"security": {
		direction("ai-security", "AI 与智能体安全", "LLM security", "ai security|language model security|llm safety|prompt injection|jailbreak attack|jailbreak attacks|agent security|agentic ai security|ai agent security|model poisoning|data poisoning|backdoor attack|backdoor attacks|adversarial robustness"),
		direction("privacy", "隐私保护与数据泄露", "Differential privacy", "federated learning|membership inference|model inversion|privacy preserving learning|privacy preserving machine learning|data anonymization|machine unlearning|privacy leakage"),
		direction("crypto", "应用密码学与可验证计算", "Applied cryptography", "post quantum cryptography|zero knowledge proof|zero knowledge proofs|secure multiparty computation|secure multi party computation|homomorphic encryption|verifiable computation|digital signatures|authenticated encryption"),
		direction("program-analysis", "程序分析与漏洞检测", "Vulnerability detection", "vulnerability discovery|software vulnerabilities|binary analysis|static program analysis|vulnerability patching|memory safety|coverage guided fuzzing|directed fuzzing|program fuzzing|kernel fuzzing|smart contract security"),
		direction("network", "网络安全与威胁检测", "Network intrusion detection", "network security|malware detection|malware analysis|phishing detection|encrypted traffic analysis|network traffic classification|botnet detection|threat detection|ransomware detection"),
		direction("systems", "系统与硬件安全", "Trusted execution environments", "trusted execution environment|confidential computing|hardware security|side channel analysis|side channel attack|side channel attacks|microarchitectural attacks|firmware security|operating system security|kernel security"),
		direction("supply-chain", "软件供应链安全", "Software supply chain security", "software supply chain attacks|software bill of materials|dependency confusion|malicious packages|package supply chain|dependency vulnerabilities"),
		direction("web", "Web 安全与身份认证", "Web security", "web application security|browser security|single sign on|passwordless authentication|multi factor authentication|passkey|passkeys|authentication protocols|access control models"),
	},
	"software": {
		direction("coding", "代码生成与编程智能体", "Code generation", "code completion|coding agent|coding agents|software engineering agents|program synthesis|automated programming|code language models|large language models for code"),
		direction("testing", "软件测试与运行验证", "Software testing", "test generation|automated testing|regression testing|property based testing|unit test generation|test case generation|coverage guided fuzzing|test oracle|mutation testing"),
		direction("repair", "自动修复与缺陷定位", "Automated program repair", "automatic program repair|bug localization|fault localization|bug fixing|patch generation|software defect prediction|vulnerability repair"),
		direction("analysis", "程序分析与形式验证", "Program analysis", "formal verification|model checking|symbolic execution|abstract interpretation|static analysis|type checking|program verification|theorem proving"),
		direction("maintenance", "软件维护与代码演化", "Software maintenance", "software evolution|technical debt|code refactoring|code review|software modernization|api migration|code smells|dependency management"),
		direction("delivery", "软件交付与运行可靠性", "Continuous delivery", "continuous integration|software supply chain|build systems|deployment automation|site reliability engineering|anomaly detection in logs|root cause analysis|microservice systems"),
		direction("human", "开发者体验与协作", "Developer productivity", "human ai collaboration|developer experience|developer workflows|software development teams|developer behavior|developer tools|collaborative software development"),
	},
}

var nonWord = regexp.MustCompile(`[^a-z0-9]+`)
var sentenceBreak = regexp.MustCompile(`[.!?]["')\]]*\s+|\n+`)
var contribution = regexp.MustCompile(`(?i)\b(?:we|this (?:paper|work|study)|our (?:work|study))\s+(?:systematically |empirically |specifically )?(?:propose|present|introduce|develop|design|study|investigate|evaluate|benchmark|analyze|examine|explore|address|focus on|compare|contribute|provide|construct|revisit|characterize|measure|assess|survey)s?\s+`)
var nonCentral = regexp.MustCompile(`(?i)\b(?:unlike|rather than|instead of|without|compared (?:with|to)|in contrast to|such as|for example|including|as baselines?)\b`)

func normalize(text string) string {
	return strings.TrimSpace(nonWord.ReplaceAllString(strings.ToLower(html.UnescapeString(text)), " "))
}

func hasPhrase(padded, phrase string) bool {
	return strings.Contains(padded, " "+phrase+" ")
}

func focusText(text string) string {
	if end := nonCentral.FindStringIndex(text); end != nil {
		text = text[:end[0]]
	}
	return " " + normalize(text) + " "
}

func contributionText(abstract string) []string {
	var segments []string
	for _, sentence := range sentenceBreak.Split(abstract, -1) {
		verb := contribution.FindStringIndex(sentence)
		if verb == nil {
			continue
		}
		words := strings.Fields(focusText(sentence[verb[1]:]))
		if len(words) > 18 {
			words = words[:18]
		}
		segments = append(segments, " "+strings.Join(words, " ")+" ")
	}
	return segments
}
