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

function buildHandoff(body) {
  const title = clip(body.title, 300);
  if (!title) return { status: 400, payload: { error: "title required" } };
  const paper = { title: title, source: "fastnews" };
  const authors = clip(body.authors || body.author, 400);
  const abstract = clip(body.abstract || body.summary, 800);
  const url = publicHttpUrl(body.url || body.link || "");
  const venue = clip(body.venue || body.conference_label || body.conference, 80);
  const year = clip(body.year, 8);
  const id = clip(body.id || body.paperId, 180);
  if (authors) paper.authors = authors;
  if (abstract) paper.abstract = abstract;
  if (url) paper.url = url;
  if (venue) paper.venue = venue;
  if (year) paper.year = year;
  if (id) paper.id = id;

  function redirectFor(payload) {
    return fastreadUrl() + "/#fastnews=" + encodeURIComponent(JSON.stringify(payload));
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
  const result = buildHandoff(body && typeof body === "object" ? body : {});
  res.status(result.status).json(result.payload);
};