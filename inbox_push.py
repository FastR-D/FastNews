#!/usr/bin/env python3
"""Pick one FastNews paper a day, preferring followed authors."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import field_briefing

SHANGHAI = timezone(timedelta(hours=8))
DEFAULT_QUERY = "computer security \u7cfb\u7edf\u5b89\u5168 \u7f51\u7edc\u5b89\u5168"
DEFAULT_REASON = "\u4e0e\u4f60\u5173\u6ce8\u7684\u7814\u7a76\u65b9\u5411\u91cd\u53e0\uff0c\u9002\u5408\u4eca\u5929\u7cbe\u8bfb\u3002"
MAX_INBOX = 180
CJK_RE = re.compile(r"[\u4e00-\u9fff]")
AFFILIATION_RE = re.compile(r"\([^)]*\)")


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


def normalize_person_name(value: object) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip(" \t.,;:/")
    return text


def name_key(value: object) -> str:
    text = normalize_person_name(value).lower().replace(".", " ")
    return re.sub(r"\s+", " ", text).strip()


def name_tokens(value: object) -> list[str]:
    return [token for token in re.split(r"[\s\-]+", name_key(value)) if token]


def followed_names(authors) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for author in authors or []:
        raw = author.get("name") if isinstance(author, dict) else author
        name = normalize_person_name(raw)
        key = name_key(name)
        if len(key) < 2 or key in seen:
            continue
        seen.add(key)
        names.append(name)
        if len(names) >= 40:
            break
    return names


def parse_paper_authors(author_field: object) -> list[str]:
    text = AFFILIATION_RE.sub(" ", str(author_field or ""))
    names: list[str] = []
    seen: set[str] = set()
    for part in re.split(r"[,;]", text):
        name = normalize_person_name(part)
        key = name_key(name)
        if len(key) < 2 or key in seen:
            continue
        seen.add(key)
        names.append(name)
    return names


def names_match(followed: str, paper_name: str) -> bool:
    left = name_key(followed)
    right = name_key(paper_name)
    if not left or not right:
        return False
    if left == right:
        return True
    if CJK_RE.search(followed) or CJK_RE.search(paper_name):
        return False
    left_tokens = name_tokens(followed)
    right_tokens = name_tokens(paper_name)
    if len(left_tokens) < 2 or len(right_tokens) < 2:
        return False
    if left_tokens[-1] != right_tokens[-1]:
        return False
    last = left_tokens[-1]
    first_left, first_right = left_tokens[0], right_tokens[0]
    if first_left == first_right:
        return True
    if len(last) < 4:
        return False
    return (
        (len(first_left) == 1 and first_right.startswith(first_left))
        or (len(first_right) == 1 and first_left.startswith(first_right))
    )


def matching_followed_names(author_field: object, names: list[str]) -> list[str]:
    paper_names = parse_paper_authors(author_field)
    if not paper_names or not names:
        return []
    matched: list[str] = []
    seen: set[str] = set()
    for followed in names:
        if any(names_match(followed, paper_name) for paper_name in paper_names):
            key = name_key(followed)
            if key in seen:
                continue
            seen.add(key)
            matched.append(followed)
    return matched


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


def unused_paper(item: dict, used_ids: set[str], used_urls: set[str]) -> bool:
    paper_id = str(item.get("id") or "")
    link = str(item.get("link") or item.get("url") or "")
    if paper_id and paper_id in used_ids:
        return False
    if link and link in used_urls:
        return False
    return True


def followed_author_hits(root, authors, inbox, limit: int = 12) -> list[dict]:
    names = followed_names(authors)
    if not names:
        return []
    used_ids, used_urls = existing_keys(inbox)
    corpus = field_briefing.get_corpus(root, "all", field_briefing.DEFAULT_ARXIV_DAYS)
    ranked: list[dict] = []
    seen_titles: set[str] = set()
    for paper in corpus:
        matched = matching_followed_names(paper.get("author") or paper.get("search_author") or "", names)
        if not matched:
            continue
        public = field_briefing.public_item(paper, 10.0, matched)
        if not unused_paper(public, used_ids, used_urls):
            continue
        title_key = re.sub(r"\W+", "", str(public.get("title") or "").lower())
        if title_key and title_key in seen_titles:
            continue
        public["followed_authors"] = matched
        ranked.append(public)
        if title_key:
            seen_titles.add(title_key)
    ranked.sort(key=lambda item: (-(item.get("year") or 0), item.get("title") or ""))
    return ranked[: max(int(limit), 0)]


def search_hits(root, query: str, inbox, *, limit: int, min_score: float) -> list[dict]:
    used_ids, used_urls = existing_keys(inbox)
    result = field_briefing.search(root, query, limit=max(limit + 4, 8), min_score=min_score)
    hits = []
    for item in result.get("items") or []:
        if not unused_paper(item, used_ids, used_urls):
            continue
        hits.append(item)
        if len(hits) >= limit:
            break
    return hits


def candidate_hits(root, query: str, inbox, authors=None) -> list[dict]:
    author_hits = followed_author_hits(root, authors, inbox)
    if author_hits:
        return author_hits
    hits = search_hits(root, query, inbox, limit=12, min_score=0.5)
    if hits:
        return hits
    return search_hits(root, DEFAULT_QUERY, inbox, limit=8, min_score=0.0)


def author_reason(paper: dict, names: list[str] | None = None) -> str:
    matched = list(paper.get("followed_authors") or [])
    if not matched and names:
        matched = matching_followed_names(paper.get("author") or "", names)
    if matched:
        return f"\u5173\u6ce8\u4f5c\u8005 {matched[0]} \u7684\u8bba\u6587\uff0c\u9002\u5408\u4eca\u5929\u7cbe\u8bfb\u3002"
    return DEFAULT_REASON


def build_pick_prompts(query: str, impression: str, hits: list[dict], followed=None) -> tuple[str, str]:
    listed = "\n".join(
        "\n".join([
            f"{index + 1}. id={paper['id']}",
            f"   title={paper['title']}",
            f"   authors={paper.get('author') or ''}",
            f"   followed={', '.join(paper.get('followed_authors') or [])}",
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
        "- Prefer a paper authored by a followed researcher",
        "- If several followed-author papers exist, prefer the one matching the researcher's impression",
        "- If no followed-author paper is listed, prefer the impression or followed topics",
        "- Avoid generic reasons; cite the followed author, method, threat model, artifact, or problem overlap",
        "- title_zh, summary, and reason must be Chinese",
        "- summary <= 120 Chinese characters, reason <= 80 Chinese characters",
    ])
    followed_text = ", ".join(followed or []) or "(none)"
    user_prompt = "\n".join([
        f"\u68c0\u7d22\u65b9\u5411: {query}",
        f"\u7814\u7a76\u8005\u5370\u8c61: {field_briefing.clip(impression, 800) or '(none)'}",
        f"\u5173\u6ce8\u4f5c\u8005: {followed_text}",
        "",
        "\u5019\u9009\u8bba\u6587:",
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
        "reason": field_briefing.clip(data.get("reason"), 400) or author_reason(chosen),
    }


def make_item(paper: dict, *, title_zh: str, summary: str, reason: str, today: str) -> dict:
    received = datetime.now(SHANGHAI).isoformat(timespec="seconds")
    paper_id = str(paper.get("id") or "")
    followed = [field_briefing.clip(name, 80) for name in (paper.get("followed_authors") or []) if name]
    item = {
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
    if followed:
        item["followedAuthor"] = followed[0]
    return item


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
    names = followed_names(authors)
    query = query_from_profile(impression_text, authors, custom_tags)
    hits = candidate_hits(root, query, inbox, authors)
    if not hits:
        return None, False
    chosen = hits[0]
    title_zh = field_briefing.clip(chosen.get("title_zh"), 300)
    summary = field_briefing.clip(chosen.get("summary"), 1200)
    reason = author_reason(chosen, names)
    if has_api_key and complete:
        try:
            system_prompt, user_prompt = build_pick_prompts(query, impression_text, hits, names)
            parsed = parse_pick(complete(system_prompt, user_prompt), hits)
            if parsed:
                chosen = parsed["paper"]
                title_zh = parsed["title_zh"] or title_zh
                summary = parsed["summary"] or summary
                reason = parsed["reason"] or author_reason(chosen, names)
        except Exception:
            pass
    return make_item(chosen, title_zh=title_zh, summary=summary, reason=reason, today=today), True
