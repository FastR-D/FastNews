function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function clip(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function parseModelJson(text) {
  let raw = String(text || "").trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("model output is not an array");
  return data;
}

function normalizeItems(items, allowedIds) {
  const out = [];
  const used = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id || "");
    if (!id || !allowedIds.has(id) || used.has(id)) continue;
    used.add(id);
    const scoreRaw = Number(item.score);
    const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(1, scoreRaw)) : 0.5;
    const reason = clip(item.reason, 180) || "\u4e0e\u5f53\u524d\u7814\u7a76\u65b9\u5411\u91cd\u53e0\uff0c\u9002\u5408\u4f5c\u4e3a related work\u3002";
    out.push({ id, score, reason });
    if (out.length >= 12) break;
  }
  return out;
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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "OPENAI_API_KEY is not configured" });
    return;
  }

  const body = readBody(req);
  const topic = clip(body.topic, 120);
  const keywords = clip(body.keywords, 200);
  const incoming = Array.isArray(body.candidates) ? body.candidates : [];
  if (!topic && !keywords) {
    res.status(400).json({ error: "topic or keywords required" });
    return;
  }

  const candidates = [];
  const allowedIds = new Set();
  for (const item of incoming) {
    if (!item || typeof item !== "object") continue;
    const id = clip(item.id, 180);
    const title = clip(item.title, 300);
    if (!id || !title || allowedIds.has(id)) continue;
    allowedIds.add(id);
    candidates.push({
      id,
      title,
      category: clip(item.category, 80),
      conference: clip(item.conference, 80),
      year: clip(item.year, 8),
      summary: clip(item.summary, 240),
    });
    if (candidates.length >= 40) break;
  }
  if (!candidates.length) {
    res.status(400).json({ error: "candidates required" });
    return;
  }

  const listed = candidates.map((paper, index) => {
    return [
      `${index + 1}. id=${paper.id}`,
      `   title=${paper.title}`,
      `   year=${paper.year} conference=${paper.conference} category=${paper.category}`,
      `   summary=${paper.summary}`,
    ].join("\n");
  }).join("\n");

  const systemPrompt = [
    "You are a security-research librarian helping find related work.",
    "Select the most relevant papers for the user's research direction and keywords.",
    "Return ONLY a JSON array, no markdown.",
    'Each item: {"id":"<candidate id>","score":0.0-1.0,"reason":"<one Chinese sentence explaining why this paper is related work>"}',
    "Rules:",
    "- Use only provided candidate ids",
    "- Sort by score descending",
    "- Return 6 to 12 items if possible, fewer if matches are weak",
    "- Reasons must be specific (method, threat model, artifact, or problem overlap), not generic",
  ].join("\n");

  const userPrompt = [
    `\u7814\u7a76\u65b9\u5411: ${topic || "(none)"}`,
    `\u5173\u952e\u8bcd: ${keywords || "(none)"}`,
    "",
    "\u5019\u9009\u8bba\u6587:",
    listed,
  ].join("\n");

  const base = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.LLM_MODEL || "gemini-3-flash-preview";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);

  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 1200,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(502).json({ error: "upstream llm error" });
      return;
    }
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message
      ? payload.choices[0].message.content
      : "";
    const items = normalizeItems(parseModelJson(content), allowedIds);
    if (!items.length) {
      res.status(502).json({ error: "empty ranking" });
      return;
    }
    res.status(200).json({ items, source: "llm" });
  } catch (error) {
    res.status(502).json({ error: "related-work failed" });
  } finally {
    clearTimeout(timer);
  }
};
