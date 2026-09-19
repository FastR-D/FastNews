#!/usr/bin/env python3
"""Pick one FastNews paper a day from the user's research impression."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import field_briefing

SHANGHAI = timezone(timedelta(hours=8))
DEFAULT_QUERY = "computer security 系统安全 网络安全"
DEFAULT_REASON = "与你关注的研究方向重叠，适合今天精读。"
MAX_INBOX = 180


def shanghai_today(now: datetime | None = None) -> str:
    current = now or datetime.now(SHANGHAI)
    if current.tzinfo is None:
        current = current.replace(tzinfo=SHANGHAI)
    return current.astimezone(SHANGHAI).date().isoformat()


def query_from_profile(impression_text: str, authors=None, custom_tags=None) -> str:
    text = field_briefing.clip(impression_text, 400)
    if text:
        return text
    tags: list[str] = []
    for author in authors or []:
        if isinstance(author, dict):
            tags.extend(str(tag) for tag in (author.get("tags") or []) if tag)
    tags.extend(str(tag) for tag in (custom_tags or []) if tag)
    tags = [field_briefing.clip(tag, 40) for tag in tags if str(tag).strip()]
    if tags:
        return " ".join(dict.fromkeys(tags[:12]))
    return DEFAULT_QUERY


def existing_keys(inbox) -> tuple[set[str], set[str]]:
    ids: set[str] = set()
    urls: set[str] = set()
    for item in inbox or []:
        if not isinstance(item, dict):
            continue
        for key in ("paperId", "id"):
            value = str(item.get(key) or "").strip()
            if value:
                ids.add(value)
        url = str(item.get("url") or item.get("link") or "").strip()
        if url:
            urls.add(url)
    return ids, urls


def find_today_item(inbox, today: str | None = None):
    today = today or shanghai_today()
    for item in inbox or []:
        if not isinstance(item, dict):
            continue
        if item.get("date") == today and str(item.get("kind") or "daily-paper") == "daily-paper":
            return item
    return None


def candidate_hits(root, query: str, inbox) -> list[dict]:
    used_ids, used_urls = existing_keys(inbox)
    result = field_briefing.search(root, query, limit=16, min_score=0.5)
    hits = []
    for item in result.get("items") or []:
        paper_id = str(item.get("id") or "")
        link = str(item.get("link") or "")
        if paper_id and paper_id in used_ids:
            continue
        if link and link in used_urls:
            continue
        hits.append(item)
        if len(hits) >= 12:
            break
    if hits:
        return hits
    fallback = field_briefing.search(root, DEFAULT_QUERY, limit=16, min_score=0.0)
    for item in fallback.get("items") or []:
        paper_id = str(item.get("id") or "")
        link = str(item.get("link") or "")
        if paper_id and paper_id in used_ids:
            continue
        if link and link in used_urls:
            continue
        hits.append(item)
        if len(hits) >= 8:
            break
    return hits


def build_pick_prompts(query: str, impression: str, hits: list[dict]) -> tuple[str, str]:
    listed = "\n".join(
        "\n".join([
            f"{index + 1}. id={paper['id']}",
            f"   title={paper['title']}",
            f"   year={paper.get('year')} venue={paper.get('venue')} category={paper.get('category')} source={paper.get('source')}",
            f"   summary={field_briefing.clip(paper.get('summary'), 240)}",
        ])
        for index, paper in enumerate(hits)
    )
    system_prompt = "\n".join([
        "You pick exactly one FastNews paper for a researcher's daily inbox.",
        "Return ONLY a JSON object, no markdown.",
        'Schema: {"id":"<candidate id>","title_zh":"","summary":"","reason":""}',
        "Rules:",
        "- Use only a provided candidate id",
        "- Prefer a paper that matches the researcher's impression or followed topics",
        "- Avoid generic reasons; cite method, threat model, artifact, or problem overlap",
        "- title_zh, summary, and reason must be Chinese",
        "- summary <= 120 Chinese characters, reason <= 80 Chinese characters",
    ])
    user_prompt = "\n".join([
        f"检索方向: {query}",
        f"研究者印象: {field_briefing.clip(impression, 800) or '(none)'}",
        "",
        "候选论文:",
        listed or "(none)",
    ])
    return system_prompt, user_prompt


def parse_pick(content: str, hits: list[dict]) -> dict | None:
    data = field_briefing.parse_model_object(content)
    by_id = {str(item.get("id")): item for item in hits}
    chosen = by_id.get(str(data.get("id") or ""))
    if not chosen:
        return None
    return {
        "paper": chosen,
        "title_zh": field_briefing.clip(data.get("title_zh") or chosen.get("title_zh"), 300),
        "summary": field_briefing.clip(data.get("summary") or chosen.get("summary"), 1200),
        "reason": field_briefing.clip(data.get("reason"), 400) or DEFAULT_REASON,
    }


def make_item(paper: dict, *, title_zh: str, summary: str, reason: str, today: str) -> dict:
    received = datetime.now(SHANGHAI).isoformat(timespec="seconds")
    paper_id = str(paper.get("id") or "")
    return {
        "id": f"daily-{today}-{paper_id}"[:120],
        "date": today,
        "kind": "daily-paper",
        "paperId": paper_id,
        "title": field_briefing.clip(paper.get("title"), 300),
        "title_zh": title_zh,
        "summary": summary,
        "reason": reason,
        "url": field_briefing.clip(paper.get("link"), 1000),
        "venue": field_briefing.clip(paper.get("venue"), 200),
        "year": str(paper.get("year") or "")[:8],
        "authors": field_briefing.clip(paper.get("author"), 300),
        "category": field_briefing.clip(paper.get("category"), 80),
        "source": field_briefing.clip(paper.get("source"), 80),
        "read": False,
        "receivedAt": received,
    }


def generate_daily_item(
    root,
    impression_text: str,
    authors=None,
    custom_tags=None,
    inbox=None,
    complete=None,
    has_api_key: bool = False,
    now: datetime | None = None,
) -> tuple[dict | None, bool]:
    today = shanghai_today(now)
    existing = find_today_item(inbox, today)
    if existing:
        return existing, False
    query = query_from_profile(impression_text, authors, custom_tags)
    hits = candidate_hits(root, query, inbox)
    if not hits:
        return None, False
    chosen = hits[0]
    title_zh = field_briefing.clip(chosen.get("title_zh"), 300)
    summary = field_briefing.clip(chosen.get("summary"), 1200)
    reason = DEFAULT_REASON
    if has_api_key and complete:
        try:
            system_prompt, user_prompt = build_pick_prompts(query, impression_text, hits)
            parsed = parse_pick(complete(system_prompt, user_prompt), hits)
            if parsed:
                chosen = parsed["paper"]
                title_zh = parsed["title_zh"] or title_zh
                summary = parsed["summary"] or summary
                reason = parsed["reason"] or reason
        except Exception:
            pass
    return make_item(chosen, title_zh=title_zh, summary=summary, reason=reason, today=today), True
