const fs = require("fs");
const path = require("path");

const CONFERENCE_LABELS = {
  usenix: "USENIX Security",
  "ieee-sp": "IEEE S&P",
  ndss: "NDSS",
  ccs: "ACM CCS",
};
const CONFERENCE_FILE_RE = /^(usenix|ieee-sp|ndss|ccs)_(\d{4})$/;
const ARXIV_SOURCES = {
  "https://rss.arxiv.org/atom/cs.cr": "arXiv cs.CR",
  "https://rss.arxiv.org/atom/cs.ai+cs.cl": "arXiv cs.AI/CL",
};
const CATEGORIES = [
  "Web Security",
  "Network Security",
  "System & OS Security",
  "Hardware Security",
  "Cryptography & Protocols",
  "Privacy & Anonymity",
  "ML/AI Security",
  "Human Factors & Usable Security",
  "Binary & Forensics",
  "Miscellaneous",
];
const TOKEN_RE = /[a-z0-9]+(?:[./-][a-z0-9]+)*|[\u4e00-\u9fff]+/gi;
const STOPWORDS = new Set([
  "a", "an", "the", "of", "and", "or", "for", "in", "on", "to", "with", "via",
  "from", "into", "over", "under", "using", "based", "paper", "papers", "study",
  "research", "field", "area", "topic", "survey", "introduction", "secure",
  "system", "systems", "model", "models", "data", "new", "novel",
  "论文", "研究", "领域", "方向", "介绍", "综述", "入门", "相关", "工作",
]);
const ALIAS_RULES = [
  {
    category: "ML/AI Security",
    field_triggers: ["ml/ai", "ml security", "ai security", "machine learning security", "人工智能安全", "机器学习安全", "大模型安全"],
    triggers: ["llm", "large language", "jailbreak", "prompt injection", "adversarial", "backdoor", "membership inference", "model extraction", "unlearning", "poisoning", "watermark", "agent security", "rag security", "大模型", "大语言模型", "越狱", "提示注入", "对抗样本", "后门", "投毒", "模型窃取", "成员推断"],
    expand: ["llm", "jailbreak", "prompt", "injection", "adversarial", "backdoor", "poisoning", "membership", "unlearning", "alignment"],
  },
  {
    category: "Web Security",
    field_triggers: ["web security", "web安全", "浏览器安全", "网页安全"],
    triggers: ["browser", "xss", "csrf", "sop", "cors", "prototype pollution", "javascript", "supply chain", "pypi", "npm", "浏览器", "同源", "前端"],
    expand: ["browser", "xss", "csrf", "javascript"],
  },
  {
    category: "Network Security",
    field_triggers: ["network security", "网络安全", "网络空间安全"],
    triggers: ["dns", "bgp", "ddos", "botnet", "ids", "ips", "traffic", "sdn", "wireless", "wifi", "流量", "无线"],
    expand: ["network", "dns", "traffic", "routing"],
  },
  {
    category: "System & OS Security",
    field_triggers: ["system security", "os security", "操作系统安全", "系统安全"],
    triggers: ["kernel", "sandbox", "container", "hypervisor", "ebpf", "firmware", "fuzzing", "privilege", "内核", "沙箱", "容器", "虚拟化", "模糊测试", "固件"],
    expand: ["kernel", "sandbox", "container", "fuzzing", "firmware"],
  },
  {
    category: "Hardware Security",
    field_triggers: ["hardware security", "硬件安全"],
    triggers: ["side channel", "side-channel", "tee", "sgx", "trustzone", "rowhammer", "microarchitecture", "cache attack", "enclave", "侧信道", "微架构", "可信执行", "缓存攻击"],
    expand: ["side-channel", "cache", "tee", "sgx", "enclave", "microarchitectural"],
  },
  {
    category: "Cryptography & Protocols",
    field_triggers: ["cryptograph", "crypto", "密码学", "密码安全"],
    triggers: ["zero knowledge", "mpc", "signature", "encryption", "tls", "零知识", "多方计算", "协议", "签名", "加密"],
    expand: ["cryptography", "protocol", "encryption", "zero-knowledge", "mpc"],
  },
  {
    category: "Privacy & Anonymity",
    field_triggers: ["privacy", "anonymity", "隐私", "匿名"],
    triggers: ["differential privacy", "tor", "tracking", "k-anonymity", "差分隐私", "追踪"],
    expand: ["privacy", "anonymity", "differential", "tracking"],
  },
  {
    category: "Human Factors & Usable Security",
    field_triggers: ["usable security", "human factor", "可用性安全", "人因"],
    triggers: ["phishing", "authentication", "password", "钓鱼", "认证", "用户"],
    expand: ["phishing", "usable", "authentication"],
  },
  {
    category: "Binary & Forensics",
    field_triggers: ["binary", "forensic", "二进制", "取证"],
    triggers: ["malware", "reverse", "decompile", "disassembly", "恶意软件", "逆向"],
    expand: ["malware", "binary", "reverse", "forensics", "decompiler"],
  },
];

const corpusCache = new Map();

function clip(value, maxLen) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).replace(/\s+$/, "") + "…";
}

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const rows = [];
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === "object") rows.push(row);
    } catch (_error) {}
  }
  return rows;
}

function loadTopConf(root) {
  const sourceRoot = path.join(root, "top-conf", "data", "conferences");
  const summaryRoot = path.join(root, "top-conf", "data", "summary");
  if (!fs.existsSync(sourceRoot) || !fs.existsSync(summaryRoot)) return [];
  const papers = [];
  for (const name of fs.readdirSync(sourceRoot).sort()) {
    const match = CONFERENCE_FILE_RE.exec(path.basename(name, ".jsonl"));
    if (!match) continue;
    const conference = match[1];
    const year = Number(match[2]);
    const sourcePath = path.join(sourceRoot, name);
    const summaryPath = path.join(summaryRoot, conference + "_" + year + "_summary.jsonl");
    const sourcePapers = {};
    for (const paper of loadJsonl(sourcePath)) {
      const id = String(paper._id || paper.link || "");
      if (id) sourcePapers[id] = paper;
    }
    for (const record of loadJsonl(summaryPath)) {
      const summarized = record && record.paper;
      if (!summarized || typeof summarized !== "object") continue;
      const id = String(summarized._id || summarized.link || "");
      const source = sourcePapers[id] || {};
      const title = summarized.title || source.title;
      if (!id || !title) continue;
      const summary = summarized.summary_zh || source.description || "";
      papers.push({
        id,
        source: "top-conf",
        title,
        title_zh: "",
        author: summarized.author || source.author || "",
        year,
        venue: CONFERENCE_LABELS[conference] || conference,
        conference,
        category: record.category || "Uncategorized",
        link: summarized.link || source.link || id,
        summary: clip(summary, 360),
        search_title: title,
        search_summary: summary + " " + (source.description || ""),
        search_author: summarized.author || source.author || "",
      });
    }
  }
  return papers;
}

function loadDailySummaries(root, dates) {
  const folder = path.join(root, "secnews", "data", "daily_summaries");
  const mapped = {};
  if (!fs.existsSync(folder)) return mapped;
  for (const day of dates) {
    const filePath = path.join(folder, day + ".json");
    if (!fs.existsSync(filePath)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      for (const article of payload.articles || []) {
        if (!article || typeof article !== "object") continue;
        const key = String(article._id || article.link || "");
        if (key) mapped[key] = article;
      }
    } catch (_error) {}
  }
  return mapped;
}

function loadArxiv(root, days) {
  const folder = path.join(root, "secnews", "data", "articles");
  if (!fs.existsSync(folder)) return [];
  const cutoff = days <= 0 ? null : Date.now() - days * 86400000;
  const files = [];
  for (const name of fs.readdirSync(folder).sort()) {
    const stem = path.basename(name, ".jsonl");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stem)) continue;
    const fileDate = Date.parse(stem + "T00:00:00Z");
    if (Number.isNaN(fileDate) || (cutoff && fileDate < cutoff)) continue;
    files.push([path.join(folder, name), stem]);
  }
  const summaries = loadDailySummaries(root, files.map((item) => item[1]));
  const papers = [];
  const seen = new Set();
  for (const [filePath, day] of files) {
    const year = Number(day.slice(0, 4));
    for (const article of loadJsonl(filePath)) {
      const venue = ARXIV_SOURCES[String(article.source || "")];
      if (!venue) continue;
      const id = String(article._id || article.link || "");
      const title = article.title;
      if (!id || !title || seen.has(id)) continue;
      seen.add(id);
      const extra = summaries[id] || summaries[String(article.link || "")] || {};
      const summary = extra.summary_zh || article.description || "";
      papers.push({
        id,
        source: "arxiv",
        title,
        title_zh: extra.title_zh || "",
        author: extra.author || article.author || "",
        year: Number.isFinite(year) ? year : null,
        venue,
        conference: "arxiv",
        category: Array.isArray(article.categories) ? article.categories.join(", ") : venue,
        link: article.link || id,
        summary: clip(summary, 360),
        search_title: title + " " + (extra.title_zh || ""),
        search_summary: summary + " " + (article.description || ""),
        search_author: extra.author || article.author || "",
      });
    }
  }
  return papers;
}

function getCorpus(root, source, arxivDays) {
  const dayKey = arxivDays > 0 ? new Date().toISOString().slice(0, 10) : "all";
  const key = [root, source, arxivDays, dayKey].join("|");
  if (corpusCache.has(key)) return corpusCache.get(key);
  const papers = [];
  if (source === "all" || source === "top-conf") papers.push.apply(papers, loadTopConf(root));
  if (source === "all" || source === "arxiv") papers.push.apply(papers, loadArxiv(root, arxivDays));
  corpusCache.set(key, papers);
  return papers;
}

function tokenize(text) {
  const tokens = [];
  const used = new Set();
  const matches = String(text || "").toLowerCase().match(TOKEN_RE) || [];
  for (const part of matches) {
    const token = part.replace(/^[./-]+|[./-]+$/g, "").toLowerCase();
    if (token.length < 2 || STOPWORDS.has(token) || used.has(token)) continue;
    used.add(token);
    tokens.push(token);
  }
  return tokens;
}

function queryHas(trigger, queryL, tokenSet) {
  const needle = String(trigger || "").toLowerCase().trim();
  if (!needle) return false;
  if (/[\u4e00-\u9fff]/.test(needle) || needle.indexOf(" ") >= 0 || needle.indexOf("/") >= 0) return queryL.indexOf(needle) >= 0;
  return tokenSet.has(needle);
}

function expandQuery(query, extraCategories) {
  const queryL = String(query || "").toLowerCase();
  const rawTokens = tokenize(query);
  const tokenSet = new Set(rawTokens);
  const categories = [];
  const expanded = rawTokens.slice();
  let topicHit = false;
  for (const rule of ALIAS_RULES) {
    const fieldHit = (rule.field_triggers || []).some((trigger) => queryHas(trigger, queryL, tokenSet));
    const itemHit = (rule.triggers || []).some((trigger) => queryHas(trigger, queryL, tokenSet));
    if (fieldHit || itemHit || queryL.indexOf(rule.category.toLowerCase()) >= 0) {
      if (categories.indexOf(rule.category) < 0) categories.push(rule.category);
    }
    if (itemHit) {
      topicHit = true;
      for (const term of rule.expand || []) {
        if (expanded.indexOf(term) < 0 && !STOPWORDS.has(term)) expanded.push(term);
      }
    }
  }
  for (const category of extraCategories || []) {
    if (category && categories.indexOf(category) < 0) categories.push(category);
  }
  let specific = Boolean(topicHit || (extraCategories || []).length);
  if (!specific) {
    let leftover = queryL;
    const phrases = ALIAS_RULES.map((rule) => rule.category.toLowerCase());
    for (const rule of ALIAS_RULES) {
      for (const item of rule.field_triggers || []) phrases.push(item.toLowerCase());
    }
    phrases.sort((a, b) => b.length - a.length);
    const unique = [];
    for (const phrase of phrases) if (unique.indexOf(phrase) < 0) unique.push(phrase);
    for (const phrase of unique) leftover = leftover.split(phrase).join(" ");
    specific = tokenize(leftover).length > 0;
  }
  return { terms: expanded, categories, specific };
}

function termIn(text, term) {
  const needle = String(term || "").toLowerCase();
  if (!needle) return false;
  if (/[\u4e00-\u9fff]/.test(needle)) return text.indexOf(needle) >= 0;
  if (needle.length <= 3) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(?<![a-z0-9])" + escaped + "(?![a-z0-9])").test(text);
  }
  return text.indexOf(needle) >= 0;
}

function scorePaper(paper, terms, categories) {
  const title = String(paper.search_title || "").toLowerCase();
  const summary = String(paper.search_summary || "").toLowerCase();
  const category = String(paper.category || "").toLowerCase();
  const author = String(paper.search_author || "").toLowerCase();
  let score = 0;
  const matched = [];
  let lexical = false;
  for (const term of terms) {
    let hit = false;
    if (termIn(title, term)) { score += 4; hit = true; }
    if (termIn(category, term)) { score += 3; hit = true; }
    if (termIn(summary, term)) { score += 2; hit = true; }
    if (termIn(author, term)) { score += 1; hit = true; }
    if (hit) {
      lexical = true;
      matched.push(term);
    }
  }
  if (categories.indexOf(paper.category) >= 0) {
    score += 2;
    if (matched.indexOf(paper.category) < 0) matched.push(paper.category);
  }
  if (Number.isInteger(paper.year) && paper.year >= 2020) score += Math.min(paper.year - 2020, 6) * 0.05;
  return { score, matched, lexical };
}

function publicItem(paper, score, matched) {
  return {
    id: paper.id,
    source: paper.source,
    title: paper.title,
    title_zh: paper.title_zh || "",
    author: paper.author || "",
    year: paper.year,
    venue: paper.venue || "",
    conference: paper.conference || "",
    category: paper.category || "",
    link: paper.link || "",
    summary: paper.summary || "",
    score: Math.round(score * 1000) / 1000,
    matched_terms: matched.slice(0, 8),
  };
}

function searchPapers(root, query, options) {
  options = options || {};
  const extraCategories = (options.categories || []).filter(Boolean);
  const expanded = expandQuery(query, extraCategories);
  const yearSet = new Set((options.years || []).map((year) => Number(year)).filter(Number.isFinite));
  const conferenceSet = new Set((options.conferences || []).map((item) => String(item).toLowerCase()).filter(Boolean));
  const source = ["all", "top-conf", "arxiv"].indexOf(options.source) >= 0 ? options.source : "all";
  const arxivDays = Number.isFinite(Number(options.arxivDays)) ? Number(options.arxivDays) : 90;
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 16;
  const minScore = Number.isFinite(Number(options.minScore)) ? Number(options.minScore) : 1;
  const corpus = getCorpus(root, source, arxivDays);
  const ranked = [];
  const seenTitles = new Set();
  for (const paper of corpus) {
    const titleKey = String(paper.title || "").toLowerCase().replace(/\W+/g, "");
    if (titleKey && seenTitles.has(titleKey)) continue;
    if (yearSet.size && !yearSet.has(paper.year)) continue;
    if (conferenceSet.size && !conferenceSet.has(paper.conference)) continue;
    if (extraCategories.length && paper.source === "top-conf" && extraCategories.indexOf(paper.category) < 0) continue;
    const scored = scorePaper(paper, expanded.terms, expanded.categories);
    if (expanded.specific && !scored.lexical) continue;
    if (!expanded.specific && expanded.categories.length && expanded.categories.indexOf(paper.category) < 0 && !scored.lexical) continue;
    if (scored.score < minScore) continue;
    ranked.push([scored.score, scored.matched, paper]);
    if (titleKey) seenTitles.add(titleKey);
  }
  ranked.sort(function (a, b) {
    return b[0] - a[0] || (b[2].year || 0) - (a[2].year || 0) || String(a[2].title).localeCompare(String(b[2].title));
  });
  const items = ranked.slice(0, Math.max(limit, 0)).map(function (row) {
    return publicItem(row[2], row[0], row[1]);
  });
  return {
    query: query,
    terms: expanded.terms,
    categories: expanded.categories,
    specific: expanded.specific,
    source_filter: source,
    arxiv_days: arxivDays,
    corpus_size: corpus.length,
    hit_count: items.length,
    items: items,
  };
}

module.exports = {
  CATEGORIES: CATEGORIES,
  CONFERENCE_LABELS: CONFERENCE_LABELS,
  clip: clip,
  searchPapers: searchPapers,
  getCorpus: getCorpus,
  publicItem: publicItem,
};
