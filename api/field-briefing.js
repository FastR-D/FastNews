function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

const path = require("path");
const { CATEGORIES, clip, searchPapers } = require("./_lib/field-search");

const ROOT = path.join(__dirname, "..");
const DEFAULT_PAPER_REASON = "与当前研究方向重叠，适合作为延伸阅读。";
const SYSTEM_PROMPT = [
  "你现在是一名专业的学术顾问。",
  "请撰写用户指定研究领域的国内外研究现状。",
  "以提供的 FastNews 论文（安全四大顶会近五年中文摘要 + 近期 arXiv）为主要证据，必要时可补充你确信存在的经典综述；不得编造论文、会议、年份或链接。",
  "Return ONLY a JSON object, no markdown.",
  'Schema: {"field_zh":"","field_en":"","coverage":"","scope":"","categories":[{"name":"","consensus":"","developments":""}],"gaps":"","surveys":[{"title":"","venue":"","year":"","link":"","reason":""}],"papers":[{"id":"<candidate id>","reason":""}]}',
  "Rules:",
  "- All prose must be Chinese",
  "- 组织近五年该领域核心文献；FastNews 语料以 2023-2026 顶会与近期 arXiv 为主，不是历史全集",
  "- 按研究方法或研究主题分成 3 到 6 类，类别名要具体，不要空泛标签",
  "- 每个分类的 consensus：只用一句话概括该分类的主流观点或共识，并引用具体学者的工作来支撑（作者、年份或会议）",
  "- 每个分类的 developments：讨论该分类下不同工作的进展，对比他们在研究方法、侧重点或结论上的异同（3 到 6 句）",
  "- gaps：在全部分类之后，明确指出当前研究还存在的不足之处（3 到 5 句，要具体，禁止空泛套话）",
  "- 能从文献中区分国内外贡献时再写国内外，不要虚构中外对立",
  "- scope：1 到 2 句界定综述对象与近五年文献边界",
  "- coverage：语料偏薄或仅覆盖近年时如实说明",
  "- papers: 6 to 10 items if possible, only provided candidate ids, most specific overlap first",
  "- reasons must cite method, theme, artifact, or problem overlap, not generic",
  "- surveys: 0 to 4 canonical surveys or seminal papers with real http(s) links; omit if unsure",
  "- Length: scope<=240, consensus<=220, developments<=700, gaps<=700 Chinese characters",
].join("\n");

function coverageNote(result) {
  const days = result.arxiv_days || 90;
  const arxivPart = days === 0 ? "全部已抓取 arXiv" : "近 " + days + " 天 arXiv cs.CR / cs.AI+cs.CL";
  return "语料覆盖 USENIX Security 2025/2026、IEEE S&P 2026、NDSS 2026 的中文摘要，以及" + arxivPart + "。CCS 与更早顶会可能缺失，这不是历史全集。";
}

function lexicalReason(item) {
  const terms = (item.matched_terms || []).map((term) => String(term)).filter(Boolean);
  if (terms.length) return "命中 " + terms.slice(0, 4).join("、") + "，与查询方向重叠。";
  return DEFAULT_PAPER_REASON;
}

function attachReason(item, reason) {
  return Object.assign({}, item, { reason: clip(reason, 180) || DEFAULT_PAPER_REASON });
}

function lexicalPapers(items, limit) {
  return (items || []).slice(0, limit || 10).map((item) => attachReason(item, lexicalReason(item)));
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function parseModelObject(text) {
  let raw = String(text || "").trim();
  if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("model output is not an object");
  return data;
}

function normalizeCategories(items) {
  const out = [];
  const used = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    const name = clip(item.name, 40);
    const consensus = clip(item.consensus || item.summary, 280);
    const developments = clip(item.developments, 900);
    const key = name.toLowerCase();
    if (!name || !consensus || used.has(key)) continue;
    used.add(key);
    out.push({ name, consensus, developments });
    if (out.length >= 6) break;
  }
  return out;
}

function normalizeSurveys(items) {
  const out = [];
  const used = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    const title = clip(item.title, 220);
    const link = safeHttpUrl(item.link);
    const key = title.toLowerCase();
    if (!title || !link || used.has(key)) continue;
    used.add(key);
    out.push({
      title,
      venue: clip(item.venue, 80),
      year: clip(item.year, 8),
      link,
      reason: clip(item.reason, 180) || "该方向的经典或综述文献。",
    });
    if (out.length >= 4) break;
  }
  return out;
}

function normalizeSelectedPapers(items, hits) {
  const byId = new Map((hits || []).map((item) => [String(item.id), item]));
  const out = [];
  const used = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id || "");
    const paper = byId.get(id);
    if (!paper || used.has(id)) continue;
    used.add(id);
    out.push(attachReason(paper, clip(item.reason, 180)));
    if (out.length >= 10) break;
  }
  if (out.length < 6) {
    for (const paper of hits || []) {
      if (used.has(paper.id)) continue;
      out.push(attachReason(paper, lexicalReason(paper)));
      used.add(paper.id);
      if (out.length >= 8) break;
    }
  }
  return out;
}

function parseBriefing(content, query, hits) {
  const data = parseModelObject(content);
  const rawCategories = Array.isArray(data.categories) && data.categories.length ? data.categories : data.subareas;
  return {
    briefing: {
      field_zh: clip(data.field_zh, 40) || clip(query, 40),
      field_en: clip(data.field_en, 80),
      coverage: clip(data.coverage, 220),
      scope: clip(data.scope || data.problem, 320),
      categories: normalizeCategories(rawCategories),
      gaps: clip(data.gaps || data.open_problems, 900),
    },
    surveys: normalizeSurveys(data.surveys),
    papers: normalizeSelectedPapers(data.papers, hits),
  };
}

function buildPrompts(query, hits, impression) {
  const listed = (hits || []).map((paper, index) => {
    return [
      (index + 1) + ". id=" + paper.id,
      "   title=" + paper.title,
      "   year=" + paper.year + " venue=" + paper.venue + " category=" + paper.category + " source=" + paper.source,
      "   summary=" + clip(paper.summary, 240),
    ].join("\n");
  }).join("\n");
  const lines = ["研究方向: " + query, "请撰写该领域近五年的国内外研究现状：按方法或主题分类，每类先用一句话写共识并引用具体学者，再比较不同工作的方法、侧重点或结论，最后明确指出研究不足。"];
  impression = clip(impression, 800);
  if (impression) lines.push("", "研究者印象 / 个人研究方向:", impression);
  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: lines.concat(["", "FastNews 候选论文:", listed || "(none)"]).join("\n"),
  };
}

function isDeepseek() {
  const blob = String(process.env.OPENAI_BASE_URL || "") + " " + String(process.env.LLM_MODEL || "");
  return blob.toLowerCase().indexOf("deepseek") >= 0;
}

function fieldBriefingRequestPayload(systemPrompt, userPrompt) {
  const payload = {
    model: process.env.LLM_MODEL || "gemini-3-flash-preview",
    temperature: 0.3,
    max_tokens: 10000,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };
  if (isDeepseek()) {
    payload.thinking = { type: "disabled" };
    payload.reasoning_effort = "none";
    payload.response_format = { type: "json_object" };
  }
  return payload;
}

function messageText(message) {
  const body = message && typeof message === "object" ? message : {};
  let content = body.content;
  if (Array.isArray(content)) {
    content = content.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") return String(item.text || item.content || "");
      return "";
    }).join("");
  }
  return String(content || body.reasoning_content || "").trim();
}

async function completeChat(systemPrompt, userPrompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("missing api key");
  const base = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  const payload = fieldBriefingRequestPayload(systemPrompt, userPrompt);
  try {
    const response = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("upstream llm error");
    const choice = data && data.choices && data.choices[0] ? data.choices[0] : {};
    const message = choice.message || {};
    const content = messageText(message);
    if (!content) {
      console.error("field-briefing empty content keys=" + Object.keys(message).join(",") + " finish=" + String(choice.finish_reason || ""));
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = readBody(req);
  const impression = clip(body.impression, 4000);
  let query = clip(body.query || body.topic || body.q, 120);
  if (!query) query = clip(impression, 120);
  if (!query) {
    res.status(400).json({ error: "query required" });
    return;
  }
  const category = clip(body.category, 80);
  const extraCategories = CATEGORIES.indexOf(category) >= 0 ? [category] : [];
  let source = clip(body.source, 20) || "all";
  if (["all", "top-conf", "arxiv"].indexOf(source) < 0) source = "all";
  let arxivDays = Number(body.arxiv_days);
  if (!Number.isFinite(arxivDays)) arxivDays = 90;
  arxivDays = Math.max(0, Math.min(arxivDays, 3650));
  const conference = clip(body.conference, 20);
  let searchQuery = query;
  const extra = clip(impression, 200);
  if (extra && query.indexOf(extra) < 0) searchQuery = (query + " " + extra).trim();
  const result = searchPapers(ROOT, searchQuery, {
    categories: extraCategories,
    conferences: conference ? [conference] : [],
    source,
    arxivDays,
    limit: 16,
  });
  const hits = result.items || [];
  const payload = {
    query,
    terms: result.terms,
    categories: result.categories,
    corpus_size: result.corpus_size,
    hit_count: result.hit_count,
    briefing: null,
    surveys: [],
    papers: [],
    source: "lexical",
    coverage: coverageNote(result),
  };
  if (!hits.length) {
    res.status(200).json(payload);
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    payload.papers = lexicalPapers(hits);
    res.status(200).json(payload);
    return;
  }
  try {
    const prompts = buildPrompts(query, hits, impression);
    const parsed = parseBriefing(await completeChat(prompts.systemPrompt, prompts.userPrompt), query, hits);
    Object.assign(payload, parsed, { source: "llm" });
    if (!payload.coverage) payload.coverage = coverageNote(result);
    res.status(200).json(payload);
  } catch (error) {
    console.error("field-briefing fallback", error && error.message);
    payload.papers = lexicalPapers(hits);
    res.status(200).json(payload);
  }
};
