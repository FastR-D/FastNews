#!/usr/bin/env python3
"""Normalize distinguished-paper awards and citation counts for FastNews."""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

DISTINGUISHED_AWARD = "Distinguished Paper"
EXCLUDED_AWARD_TOKENS = (
    "artifact",
    "reviewer",
    "test of time",
    "honorable mention",
    "poster",
)
PAPER_NUM_RE = re.compile(r"\s*\(paper\s+\d+\)\s*", re.I)


def clean_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).replace("\xa0", " ").strip()


def strip_diacritics(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    return "".join(ch for ch in text if not unicodedata.combining(ch))


def normalize_title(title: object) -> str:
    text = strip_diacritics(clean_text(title)).lower()
    text = PAPER_NUM_RE.sub(" ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def parse_cited_by(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float):
        if value < 0 or not value.is_integer():
            return None
        return int(value)
    text = clean_text(value).replace(",", "")
    if not text:
        return None
    match = re.fullmatch(r"\d+", text) or re.search(r"\d+", text)
    if not match:
        return None
    return int(match.group(0))


def canonical_award(blob: object) -> str:
    text = strip_diacritics(clean_text(blob)).lower()
    if not text:
        return ""
    if any(token in text for token in EXCLUDED_AWARD_TOKENS):
        return ""
    if "distinguished paper" in text:
        return DISTINGUISHED_AWARD
    if "best paper" in text and "best poster" not in text:
        return DISTINGUISHED_AWARD
    return ""


def detect_award_text(blob: object) -> str:
    return canonical_award(blob)


def award_index_key(conference: object, year: object, title: object) -> tuple[str, int, str] | None:
    conf = clean_text(conference).lower()
    try:
        year_int = int(year)
    except (TypeError, ValueError):
        return None
    title_key = normalize_title(title)
    if not conf or not title_key:
        return None
    return (conf, year_int, title_key)


def load_award_index(root: Path) -> dict[tuple[str, int, str], str]:
    path = Path(root) / "top-conf" / "data" / "awards.json"
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    papers = payload.get("papers") if isinstance(payload, dict) else payload
    if not isinstance(papers, list):
        return {}
    index: dict[tuple[str, int, str], str] = {}
    for item in papers:
        if not isinstance(item, dict):
            continue
        award = canonical_award(item.get("award") or DISTINGUISHED_AWARD)
        key = award_index_key(item.get("conference"), item.get("year"), item.get("title"))
        if award and key:
            index[key] = award
    return index


def public_metrics(
    paper: dict | None,
    awards: dict | None = None,
    *,
    conference: object = "",
    year: object = None,
    title: object = "",
) -> dict:
    paper = paper or {}
    conference = conference or paper.get("conference") or ""
    year = paper.get("year") if year is None else year
    title = title or paper.get("title") or ""
    metrics: dict = {}
    award = canonical_award(paper.get("award"))
    if not award and awards:
        key = award_index_key(conference, year, title)
        if key:
            award = awards.get(key) or ""
    if award:
        metrics["award"] = award
    cited = None
    if "cited_by" in paper:
        cited = parse_cited_by(paper.get("cited_by"))
    elif "cited_by_count" in paper:
        cited = parse_cited_by(paper.get("cited_by_count"))
    if cited is not None:
        metrics["cited_by"] = cited
    return metrics
