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

function publicHttpUrl(value, max) {
  const raw = clip(value, max || 2048);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    return raw;
  } catch {
    return "";
  }
}

function fastreadUrl() {
  const fallback = "http://127.0.0.1:3015";
  const raw = String(process.env.FASTREAD_URL || fallback).trim().replace(/\/+$/, "");
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return fallback;
    if ((url.pathname && url.pathname !== "/") || url.search || url.hash) return fallback;
    return url.protocol + "//" + url.host;
  } catch {
    return fallback;
  }
}

function researchApiUrl() {
  const raw = String(process.env.FASTRESEARCH_API_URL || "http://127.0.0.1:8787").trim().replace(/\/+$/, "");
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return "http://127.0.0.1:8787";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "http://127.0.0.1:8787";
  }
}

function cookieToken(req) {
  const raw = String(req.headers?.cookie || "");
  const item = raw.split(";").map(value => value.trim()).find(value => value.startsWith("fr_session="));
  if (!item) return "";
  try { return decodeURIComponent(item.slice("fr_session=".length)); } catch { return ""; }
}

async function fastreadTicket(req) {
  const token = cookieToken(req);
  if (!token) return { status: 401, payload: { error: "请从 FastResearch 进入 FastNews" } };
  try {
    const response = await fetch(`${researchApiUrl()}/api/sso/ticket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "Cookie": `fr_session=${encodeURIComponent(token)}`,
      },
      body: JSON.stringify({ audience: "fast-read" }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ticket) {
      return {
        status: response.status === 401 ? 401 : 502,
        payload: { error: response.status === 401 ? "FastResearch 登录已失效，请重新进入 FastNews" : "FastResearch 未返回 FastRead 登录票据" },
      };
    }
    return { status: 200, ticket: String(payload.ticket).trim() };
  } catch {
    return { status: 503, payload: { error: "无法连接 FastResearch" } };
  }
}

function buildHandoff(body, ticket = "") {
  const title = clip(body.title, 300);
  if (!title) return { status: 400, payload: { error: "title required" } };
  const paper = { title: title, source: "fastnews" };
  const authors = clip(body.authors || body.author, 400);
  const abstract = clip(body.abstract || body.summary, 800);
  const url = publicHttpUrl(body.url || body.link || "");
  const venue = clip(body.venue || body.conference_label || body.conference, 80);
  const year = clip(body.year, 8);
  const id = clip(body.id || body.paperId, 180);
  const doi = clip(body.doi || body.identifier, 200);
  if (authors) paper.authors = authors;
  if (abstract) paper.abstract = abstract;
  if (url) paper.url = url;
  if (venue) paper.venue = venue;
  if (year) paper.year = year;
  if (id) paper.id = id;
  if (doi) paper.doi = doi;

  function redirectFor(payload) {
    const query = ticket ? "?sso=" + encodeURIComponent(ticket) : "";
    return fastreadUrl() + "/" + query + "#fastnews=" + encodeURIComponent(JSON.stringify(payload));
  }
  let redirect = redirectFor(paper);
  if (redirect.length > 7000 && paper.abstract) {
    paper.abstract = clip(paper.abstract, 240);
    redirect = redirectFor(paper);
  }
  if (redirect.length > 7000) {
    delete paper.abstract;
    redirect = redirectFor(paper);
  }
  return { status: 200, payload: { ok: true, redirect: redirect, paper: paper } };
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
  const input = body && typeof body === "object" ? body : {};
  const initial = buildHandoff(input);
  if (initial.status !== 200) {
    res.status(initial.status).json(initial.payload);
    return;
  }
  const ticket = await fastreadTicket(req);
  if (ticket.status !== 200) {
    res.status(ticket.status).json(ticket.payload);
    return;
  }
  const result = buildHandoff(input, ticket.ticket);
  res.status(result.status).json(result.payload);
};
