#!/usr/bin/env python3
"""Search FastNews corpora and build a field briefing payload."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlparse

CONFERENCE_LABELS = {
    "usenix": "USENIX Security",
    "ieee-sp": "IEEE S&P",
    "ndss": "NDSS",
    "ccs": "ACM CCS",
}
CONFERENCE_FILE_RE = re.compile(
    r"^(?P<conference>usenix|ieee-sp|ndss|ccs)_(?P<year>\d{4})$"
)
SUMMARY_FILE_RE = re.compile(
    r"^(?P<conference>usenix|ieee-sp|ndss|ccs)_(?P<year>\d{4})_summary$"
)
ARXIV_SOURCES = {
    "https://rss.arxiv.org/atom/cs.cr": "arXiv cs.CR",
    "https://rss.arxiv.org/atom/cs.ai+cs.cl": "arXiv cs.AI/CL",
}
CATEGORIES = [
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
]
TOKEN_RE = re.compile(r"[a-z0-9]+(?:[./-][a-z0-9]+)*|[\u4e00-\u9fff]+", re.I)
STOPWORDS = {
    "a", "an", "the", "of", "and", "or", "for", "in", "on", "to", "with", "via",
    "from", "into", "over", "under", "using", "based", "paper", "papers", "study",
    "research", "field", "area", "topic", "survey", "introduction", "secure",
    "system", "systems", "model", "models", "data", "new", "novel",
    "论文", "研究", "领域", "方向", "介绍", "综述", "入门", "相关", "工作",
}
ALIAS_RULES = [
    {
        "category": "ML/AI Security",
        "field_triggers": [
            "ml/ai", "ml security", "ai security", "machine learning security",
            "人工智能安全", "机器学习安全", "大模型安全",
        ],
        "triggers": [
            "llm", "large language", "jailbreak", "prompt injection", "adversarial",
            "backdoor", "membership inference", "model extraction", "unlearning",
            "poisoning", "watermark", "agent security", "rag security", "大模型",
            "大语言模型", "越狱", "提示注入", "对抗样本", "后门", "投毒",
            "模型窃取", "成员推断",
        ],
        "expand": [
            "llm", "jailbreak", "prompt", "injection", "adversarial", "backdoor",
            "poisoning", "membership", "unlearning", "alignment",
        ],
    },
    {
        "category": "Web Security",
        "field_triggers": ["web security", "web安全", "浏览器安全", "网页安全"],
        "triggers": [
            "browser", "xss", "csrf", "sop", "cors", "prototype pollution",
            "javascript", "supply chain", "pypi", "npm", "浏览器", "同源", "前端",
        ],
        "expand": ["browser", "xss", "csrf", "javascript"],
    },
    {
        "category": "Network Security",
        "field_triggers": ["network security", "网络安全", "网络空间安全"],
        "triggers": [
            "dns", "bgp", "ddos", "botnet", "ids", "ips", "traffic", "sdn",
            "wireless", "wifi", "流量", "无线",
        ],
        "expand": ["network", "dns", "traffic", "routing"],
    },
    {
        "category": "System & OS Security",
        "field_triggers": [
            "system security", "os security", "操作系统安全", "系统安全",
        ],
        "triggers": [
            "kernel", "sandbox", "container", "hypervisor", "ebpf", "firmware",
            "fuzzing", "privilege", "内核", "沙箱", "容器", "虚拟化", "模糊测试",
            "固件",
        ],
        "expand": ["kernel", "sandbox", "container", "fuzzing", "firmware"],
    },
    {
        "category": "Hardware Security",
        "field_triggers": ["hardware security", "硬件安全"],
        "triggers": [
            "side channel", "side-channel", "tee", "sgx", "trustzone",
            "rowhammer", "microarchitecture", "cache attack", "enclave",
            "侧信道", "微架构", "可信执行", "缓存攻击",
        ],
        "expand": [
            "side-channel", "cache", "tee", "sgx", "enclave", "microarchitectural",
        ],
    },
    {
        "category": "Cryptography & Protocols",
        "field_triggers": ["cryptograph", "crypto", "密码学", "密码安全"],
        "triggers": [
            "zero knowledge", "mpc", "signature", "encryption", "tls",
            "零知识", "多方计算", "协议", "签名", "加密",
        ],
        "expand": ["cryptography", "protocol", "encryption", "zero-knowledge", "mpc"],
    },
    {
        "category": "Privacy & Anonymity",
        "field_triggers": ["privacy", "anonymity", "隐私", "匿名"],
        "triggers": [
            "differential privacy", "tor", "tracking", "k-anonymity",
            "差分隐私", "追踪",
        ],
        "expand": ["privacy", "anonymity", "differential", "tracking"],
    },
    {
        "category": "Human Factors & Usable Security",
        "field_triggers": [
            "usable security", "human factor", "可用性安全", "人因",
        ],
        "triggers": ["phishing", "authentication", "password", "钓鱼", "认证", "用户"],
        "expand": ["phishing", "usable", "authentication"],
    },
    {
        "category": "Binary & Forensics",
        "field_triggers": ["binary", "forensic", "二进制", "取证"],
        "triggers": [
            "malware", "reverse", "decompile", "disassembly", "恶意软件", "逆向",
        ],
        "expand": ["malware", "binary", "reverse", "forensics", "decompiler"],
    },
]
DEFAULT_ARXIV_DAYS = 90
DEFAULT_SEARCH_LIMIT = 16
BRIEFING_CANDIDATE_LIMIT = 16
SURVEY_CANDIDATE_LIMIT = 8
MIN_SURVEYS = 2
MAX_SURVEYS = 4
DEFAULT_PAPER_REASON = "与当前研究方向重叠，适合作为延伸阅读。"
SURVEY_TITLE_RE = re.compile(
    r"(?i)(?:\bsok\b|systematization of knowledge|literature review|\bsurvey\b|综述)"
)
SURVEY_EXCLUDE_RE = re.compile(
    r"(?i)telephone survey|user survey|online survey|questionnaire|tutorial-"
)
SYSTEM_PROMPT = "\n".join([
    "你现在是一名专业的学术顾问。",
    "请撰写用户指定研究领域的国内外研究现状。",
    "以提供的 FastNews 论文（安全四大顶会近五年中文摘要 + 近期 arXiv）为主要证据；奠基/综述优先使用提供的 SoK 与 survey 候选，不得编造论文、会议、年份或链接。",
    "Return ONLY a JSON object, no markdown.",
    "Schema:",
    '{"field_zh":"","field_en":"","coverage":"","scope":"","categories":[{"name":"","consensus":"","developments":""}],"gaps":"","surveys":[{"title":"","venue":"","year":"","link":"","reason":""}],"papers":[{"id":"<candidate id>","reason":""}]}',
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
    "- surveys: 2 to 4 SoK/surveys. Prefer provided 候选奠基/综述 papers and copy title/link exactly. Extra classic papers only with a real http(s) link you are certain exists. If candidates exist, do not leave surveys empty.",
    "- Length: scope<=240, consensus<=220, developments<=700, gaps<=700 Chinese characters",
])


_CORPUS_CACHE: dict[tuple, list[dict]] = {}


def configure_stdout() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")


def log_stderr(message: str) -> None:
    text = re.sub(r"\s+", " ", str(message or "")).strip()
    encoded = text.encode("unicode_escape", "backslashreplace").decode("ascii")
    try:
        sys.stderr.write(encoded + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def find_root(start: Path | None = None) -> Path:
    start = (start or Path.cwd()).resolve()
    candidates = [start, *start.parents, *Path(__file__).resolve().parents]
    seen: set[Path] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        if (candidate / "top-conf" / "data").exists() and (candidate / "secnews" / "data").exists():
            return candidate
    raise FileNotFoundError("cannot locate FastNews repo root (missing top-conf/data and secnews/data)")


def clip(value: object, max_len: int) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


def load_top_conf(root: Path) -> list[dict]:
    source_root = root / "top-conf" / "data" / "conferences"
    summary_root = root / "top-conf" / "data" / "summary"
    papers: list[dict] = []
    if not source_root.exists() or not summary_root.exists():
        return papers
    for source_path in sorted(source_root.glob("*.jsonl")):
        match = CONFERENCE_FILE_RE.match(source_path.stem)
        if not match:
            continue
        conference = match.group("conference")
        year = int(match.group("year"))
        summary_path = summary_root / f"{conference}_{year}_summary.jsonl"
        source_papers = {
            str(paper.get("_id") or paper.get("link") or ""): paper
            for paper in load_jsonl(source_path)
            if paper.get("_id") or paper.get("link")
        }
        for record in load_jsonl(summary_path):
            summarized = record.get("paper") if isinstance(record, dict) else None
            if not isinstance(summarized, dict):
                continue
            paper_id = str(summarized.get("_id") or summarized.get("link") or "")
            source = source_papers.get(paper_id, {})
            title = summarized.get("title") or source.get("title")
            if not paper_id or not title:
                continue
            summary = summarized.get("summary_zh") or source.get("description") or ""
            papers.append(
                {
                    "id": paper_id,
                    "source": "top-conf",
                    "title": title,
                    "title_zh": "",
                    "author": summarized.get("author") or source.get("author") or "",
                    "year": year,
                    "venue": CONFERENCE_LABELS.get(conference, conference),
                    "conference": conference,
                    "category": record.get("category") or "Uncategorized",
                    "link": summarized.get("link") or source.get("link") or paper_id,
                    "summary": clip(summary, 360),
                    "search_title": title,
                    "search_summary": f"{summary} {source.get('description') or ''}",
                    "search_author": summarized.get("author") or source.get("author") or "",
                }
            )
    return papers


def load_daily_summaries(root: Path, dates: set[str]) -> dict[str, dict]:
    mapped: dict[str, dict] = {}
    folder = root / "secnews" / "data" / "daily_summaries"
    if not folder.exists():
        return mapped
    for day in dates:
        path = folder / f"{day}.json"
        if not path.exists():
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        for article in payload.get("articles") or []:
            if not isinstance(article, dict):
                continue
            key = str(article.get("_id") or article.get("link") or "")
            if key:
                mapped[key] = article
    return mapped


def load_arxiv(root: Path, days: int) -> list[dict]:
    folder = root / "secnews" / "data" / "articles"
    if not folder.exists():
        return []
    cutoff = None if days <= 0 else date.today() - timedelta(days=days)
    files: list[tuple[Path, str]] = []
    for path in sorted(folder.glob("*.jsonl")):
        try:
            file_date = date.fromisoformat(path.stem)
        except ValueError:
            continue
        if cutoff and file_date < cutoff:
            continue
        files.append((path, path.stem))
    summaries = load_daily_summaries(root, {day for _, day in files})
    papers: list[dict] = []
    seen: set[str] = set()
    for path, day in files:
        year = int(day[:4]) if len(day) >= 4 and day[:4].isdigit() else None
        for article in load_jsonl(path):
            source = str(article.get("source") or "")
            venue = ARXIV_SOURCES.get(source)
            if not venue:
                continue
            paper_id = str(article.get("_id") or article.get("link") or "")
            title = article.get("title")
            if not paper_id or not title or paper_id in seen:
                continue
            seen.add(paper_id)
            extra = summaries.get(paper_id) or summaries.get(str(article.get("link") or "")) or {}
            summary = extra.get("summary_zh") or article.get("description") or ""
            papers.append(
                {
                    "id": paper_id,
                    "source": "arxiv",
                    "title": title,
                    "title_zh": extra.get("title_zh") or "",
                    "author": extra.get("author") or article.get("author") or "",
                    "year": year,
                    "venue": venue,
                    "conference": "arxiv",
                    "category": ", ".join(article.get("categories") or []) or venue,
                    "link": article.get("link") or paper_id,
                    "summary": clip(summary, 360),
                    "search_title": f"{title} {extra.get('title_zh') or ''}",
                    "search_summary": f"{summary} {article.get('description') or ''}",
                    "search_author": extra.get("author") or article.get("author") or "",
                }
            )
    return papers


def clear_corpus_cache() -> None:
    _CORPUS_CACHE.clear()


def get_corpus(root: Path, source: str, arxiv_days: int) -> list[dict]:
    day_key = date.today().isoformat() if arxiv_days > 0 else "all"
    key = (str(root.resolve()), source, int(arxiv_days), day_key)
    cached = _CORPUS_CACHE.get(key)
    if cached is not None:
        return cached
    papers: list[dict] = []
    if source in {"all", "top-conf"}:
        papers.extend(load_top_conf(root))
    if source in {"all", "arxiv"}:
        papers.extend(load_arxiv(root, arxiv_days))
    _CORPUS_CACHE[key] = papers
    return papers


def tokenize(text: str) -> list[str]:
    tokens = []
    for part in TOKEN_RE.findall(text.lower()):
        token = part.strip(".-/").lower()
        if len(token) < 2 or token in STOPWORDS:
            continue
        if token not in tokens:
            tokens.append(token)
    return tokens


def query_has(trigger: str, query_l: str, token_set: set[str]) -> bool:
    needle = trigger.lower().strip()
    if not needle:
        return False
    if re.search(r"[\u4e00-\u9fff]", needle) or " " in needle or "/" in needle:
        return needle in query_l
    return needle in token_set


def expand_query(query: str, extra_categories: list[str]) -> tuple[list[str], list[str], bool]:
    query_l = query.lower()
    raw_tokens = tokenize(query)
    token_set = set(raw_tokens)
    categories: list[str] = []
    expanded = list(raw_tokens)
    topic_hit = False
    for rule in ALIAS_RULES:
        field_hit = any(query_has(trigger, query_l, token_set) for trigger in rule.get("field_triggers", []))
        item_hit = any(query_has(trigger, query_l, token_set) for trigger in rule.get("triggers", []))
        if field_hit or item_hit or rule["category"].lower() in query_l:
            if rule["category"] not in categories:
                categories.append(rule["category"])
        if item_hit:
            topic_hit = True
            for term in rule.get("expand", []):
                if term not in expanded and term not in STOPWORDS:
                    expanded.append(term)
    for category in extra_categories:
        if category and category not in categories:
            categories.append(category)
    specific = bool(topic_hit or extra_categories)
    if not specific:
        leftover = query_l
        phrases = [rule["category"].lower() for rule in ALIAS_RULES]
        for rule in ALIAS_RULES:
            phrases.extend(item.lower() for item in rule.get("field_triggers", []))
        for phrase in sorted(set(phrases), key=len, reverse=True):
            leftover = leftover.replace(phrase, " ")
        specific = bool(tokenize(leftover))
    return expanded, categories, specific


def term_in(text: str, term: str) -> bool:
    needle = term.lower()
    if not needle:
        return False
    if re.search(r"[\u4e00-\u9fff]", needle):
        return needle in text
    if len(needle) <= 3:
        return re.search(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", text) is not None
    return needle in text


def score_paper(paper: dict, terms: list[str], categories: list[str]) -> tuple[float, list[str], bool]:
    title = str(paper.get("search_title") or "").lower()
    summary = str(paper.get("search_summary") or "").lower()
    category = str(paper.get("category") or "").lower()
    author = str(paper.get("search_author") or "").lower()
    score = 0.0
    matched: list[str] = []
    lexical = False
    for term in terms:
        hit = False
        if term_in(title, term):
            score += 4
            hit = True
        if term_in(category, term):
            score += 3
            hit = True
        if term_in(summary, term):
            score += 2
            hit = True
        if term_in(author, term):
            score += 1
            hit = True
        if hit:
            lexical = True
            matched.append(term)
    if paper.get("category") in categories:
        score += 2
        if paper["category"] not in matched:
            matched.append(paper["category"])
    year = paper.get("year")
    if isinstance(year, int) and year >= 2020:
        score += min(year - 2020, 6) * 0.05
    return score, matched, lexical


def public_item(paper: dict, score: float, matched: list[str]) -> dict:
    return {
        "id": paper["id"],
        "source": paper["source"],
        "title": paper["title"],
        "title_zh": paper.get("title_zh") or "",
        "author": paper.get("author") or "",
        "year": paper.get("year"),
        "venue": paper.get("venue") or "",
        "conference": paper.get("conference") or "",
        "category": paper.get("category") or "",
        "link": paper.get("link") or "",
        "summary": paper.get("summary") or "",
        "score": round(float(score), 3),
        "matched_terms": matched[:8],
    }


def search(
    root: Path,
    query: str,
    *,
    categories: list[str] | None = None,
    conferences: list[str] | None = None,
    years: list[int] | None = None,
    source: str = "all",
    arxiv_days: int = DEFAULT_ARXIV_DAYS,
    limit: int = DEFAULT_SEARCH_LIMIT,
    min_score: float = 1.0,
) -> dict:
    extra_categories = [item for item in (categories or []) if item]
    terms, matched_categories, specific = expand_query(query, extra_categories)
    year_set = {int(year) for year in (years or []) if str(year).isdigit() or isinstance(year, int)}
    conference_set = {str(item).lower() for item in (conferences or []) if item}
    source = source if source in {"all", "top-conf", "arxiv"} else "all"
    corpus = get_corpus(root, source, arxiv_days)
    ranked: list[tuple[float, list[str], dict]] = []
    seen_titles: set[str] = set()
    for paper in corpus:
        title_key = re.sub(r"\W+", "", str(paper.get("title") or "").lower())
        if title_key and title_key in seen_titles:
            continue
        if year_set and paper.get("year") not in year_set:
            continue
        if conference_set and paper.get("conference") not in conference_set:
            continue
        if extra_categories and paper.get("source") == "top-conf" and paper.get("category") not in extra_categories:
            continue
        score, matched, lexical = score_paper(paper, terms, matched_categories)
        if specific and not lexical:
            continue
        if not specific and matched_categories and paper.get("category") not in matched_categories and not lexical:
            continue
        if score < min_score:
            continue
        ranked.append((score, matched, paper))
        if title_key:
            seen_titles.add(title_key)
    ranked.sort(key=lambda item: (-item[0], -(item[2].get("year") or 0), item[2]["title"]))
    ranked = ranked[: max(int(limit), 0)]
    items = [public_item(paper, score, matched) for score, matched, paper in ranked]
    return {
        "query": query,
        "terms": terms,
        "categories": matched_categories,
        "specific": specific,
        "source_filter": source,
        "arxiv_days": arxiv_days,
        "corpus_size": len(corpus),
        "hit_count": len(items),
        "items": items,
    }


def format_year_span(years: list[int]) -> str:
    years = sorted({int(year) for year in years})
    if not years:
        return ""
    parts: list[str] = []
    start = prev = years[0]
    for year in years[1:]:
        if year == prev + 1:
            prev = year
            continue
        parts.append(_year_span_part(start, prev))
        start = prev = year
    parts.append(_year_span_part(start, prev))
    return "、".join(parts)


def _year_span_part(start: int, end: int) -> str:
    if start == end:
        return str(start)
    if end == start + 1:
        return f"{start}/{end}"
    return f"{start}–{end}"


def available_top_conf_years(root: Path) -> dict[str, list[int]]:
    summary_root = root / "top-conf" / "data" / "summary"
    years_by_conf: dict[str, list[int]] = {}
    if not summary_root.exists():
        return years_by_conf
    for path in summary_root.glob("*_summary.jsonl"):
        match = SUMMARY_FILE_RE.match(path.stem)
        if not match:
            continue
        conference = match.group("conference")
        year = int(match.group("year"))
        years_by_conf.setdefault(conference, [])
        if year not in years_by_conf[conference]:
            years_by_conf[conference].append(year)
    return {key: sorted(values) for key, values in years_by_conf.items()}


def top_conf_coverage_phrase(root: Path) -> str:
    years_by_conf = available_top_conf_years(root)
    if not years_by_conf:
        return "暂无顶会中文摘要"
    labels = [CONFERENCE_LABELS[key] for key in CONFERENCE_LABELS if key in years_by_conf]
    year_tuples = {tuple(years_by_conf[key]) for key in CONFERENCE_LABELS if key in years_by_conf}
    if len(year_tuples) == 1:
        return f"{'、'.join(labels)} {format_year_span(next(iter(year_tuples)))}"
    parts = []
    for key, label in CONFERENCE_LABELS.items():
        years = years_by_conf.get(key)
        if years:
            parts.append(f"{label} {format_year_span(years)}")
    return "、".join(parts)


def coverage_note(result: dict, root: Path | None = None) -> str:
    days = result.get("arxiv_days") or DEFAULT_ARXIV_DAYS
    arxiv_part = "全部已抓取 arXiv" if days == 0 else f"近 {days} 天 arXiv cs.CR / cs.AI+cs.CL"
    phrase = top_conf_coverage_phrase(root or find_root())
    return f"语料覆盖 {phrase} 的中文摘要，以及{arxiv_part}。这不是历史全集。"


def corpus_stats(root: Path, arxiv_days: int = DEFAULT_ARXIV_DAYS) -> dict:
    top_conf = load_top_conf(root)
    folder = root / "secnews" / "data" / "articles"
    arxiv = 0
    if folder.exists():
        cutoff = None if arxiv_days <= 0 else date.today() - timedelta(days=arxiv_days)
        seen: set[str] = set()
        for path in folder.glob("*.jsonl"):
            try:
                file_date = date.fromisoformat(path.stem)
            except ValueError:
                continue
            if cutoff and file_date < cutoff:
                continue
            for article in load_jsonl(path):
                if str(article.get("source") or "") not in ARXIV_SOURCES:
                    continue
                paper_id = str(article.get("_id") or article.get("link") or "")
                if not paper_id or paper_id in seen:
                    continue
                seen.add(paper_id)
                arxiv += 1
    return {
        "top_conf": len(top_conf),
        "arxiv": arxiv,
        "category_count": len(CATEGORIES),
        "coverage": coverage_note({"arxiv_days": arxiv_days}, root),
    }


def lexical_reason(item: dict) -> str:
    terms = [str(term) for term in item.get("matched_terms") or [] if term]
    if terms:
        return "命中 " + "、".join(terms[:4]) + "，与查询方向重叠。"
    return DEFAULT_PAPER_REASON


def attach_reason(item: dict, reason: str) -> dict:
    payload = dict(item)
    payload["reason"] = clip(reason, 180) or DEFAULT_PAPER_REASON
    return payload


def lexical_papers(items: list[dict], limit: int = 10) -> list[dict]:
    return [attach_reason(item, lexical_reason(item)) for item in items[:limit]]


def is_survey_paper(paper: dict) -> bool:
    title = f"{paper.get('title') or ''} {paper.get('title_zh') or ''}"
    if SURVEY_EXCLUDE_RE.search(title):
        return False
    return bool(SURVEY_TITLE_RE.search(title))


def survey_reason(paper: dict) -> str:
    title = str(paper.get("title") or "")
    kind = "SoK" if re.search(r"(?i)\bsok\b", title) else "综述"
    prefix = " ".join(str(part) for part in (paper.get("year"), paper.get("venue")) if part).strip()
    if prefix:
        return f"{prefix} 的{kind}，适合作为该方向的奠基阅读。"
    return f"该方向的{kind}或经典文献。"


def search_surveys(
    root: Path,
    query: str,
    *,
    categories: list[str] | None = None,
    conferences: list[str] | None = None,
    source: str = "all",
    limit: int = SURVEY_CANDIDATE_LIMIT,
) -> list[dict]:
    extra_categories = [item for item in (categories or []) if item]
    terms, matched_categories, specific = expand_query(query, extra_categories)
    source = source if source in {"all", "top-conf", "arxiv"} else "all"
    conference_set = {str(item).lower() for item in (conferences or []) if item}
    corpus = get_corpus(root, source, 0)
    ranked: list[tuple[float, list[str], dict]] = []
    seen_titles: set[str] = set()
    for paper in corpus:
        if not is_survey_paper(paper):
            continue
        title_key = re.sub(r"\W+", "", str(paper.get("title") or "").lower())
        if title_key and title_key in seen_titles:
            continue
        if conference_set and paper.get("conference") not in conference_set:
            continue
        score, matched, lexical = score_paper(paper, terms, matched_categories)
        if specific and not lexical:
            continue
        if score < 4:
            continue
        ranked.append((score + 3, matched, paper))
        if title_key:
            seen_titles.add(title_key)
    ranked.sort(key=lambda item: (-item[0], -(item[2].get("year") or 0), item[2]["title"]))
    ranked = ranked[: max(int(limit), 0)]
    return [attach_reason(public_item(paper, score, matched), survey_reason(paper)) for score, matched, paper in ranked]


def surveys_from_papers(items: list[dict], limit: int = MAX_SURVEYS) -> list[dict]:
    out: list[dict] = []
    used: set[str] = set()
    for paper in items:
        title = clip(paper.get("title"), 220)
        link = safe_http_url(paper.get("link"))
        key = (link or title.lower())
        if not title or not link or key in used:
            continue
        used.add(key)
        item = dict(paper)
        item["title"] = title
        item["link"] = link
        item["reason"] = clip(paper.get("reason") or survey_reason(paper), 180)
        out.append(item)
        if len(out) >= limit:
            break
    return out


def merge_surveys(selected, candidates: list[dict]) -> list[dict]:
    out = surveys_from_papers(selected if isinstance(selected, list) else [], MAX_SURVEYS)
    used = {safe_http_url(item.get("link")) or clip(item.get("title"), 220).lower() for item in out}
    if len(out) >= MIN_SURVEYS:
        return out
    for paper in candidates:
        title = clip(paper.get("title"), 220)
        link = safe_http_url(paper.get("link"))
        key = link or title.lower()
        if not title or not link or key in used:
            continue
        used.add(key)
        item = dict(paper)
        item["title"] = title
        item["link"] = link
        item["reason"] = clip(paper.get("reason") or survey_reason(paper), 180)
        out.append(item)
        if len(out) >= MAX_SURVEYS:
            break
    return out


def drop_papers_in_surveys(papers: list[dict], surveys: list[dict]) -> list[dict]:
    survey_ids = {str(item.get("id") or "") for item in surveys if item.get("id")}
    survey_links = {safe_http_url(item.get("link")) for item in surveys if safe_http_url(item.get("link"))}
    survey_titles = {clip(item.get("title"), 220).lower() for item in surveys if item.get("title")}
    out: list[dict] = []
    for paper in papers:
        link = safe_http_url(paper.get("link"))
        title = clip(paper.get("title"), 220).lower()
        if paper.get("id") and str(paper.get("id")) in survey_ids:
            continue
        if link and link in survey_links:
            continue
        if title and title in survey_titles:
            continue
        out.append(paper)
    return out


def safe_http_url(value: object) -> str:
    try:
        parsed = urlparse(str(value or "").strip())
    except ValueError:
        return ""
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    return parsed.geturl()


def parse_model_object(text: str) -> dict:
    raw = str(text or "").strip()
    raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.I | re.S).strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I)
        raw = re.sub(r"\s*```$", "", raw)
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        raw = raw[start:end + 1]
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("model output is not an object")
    return data


def normalize_categories(items) -> list[dict]:
    out: list[dict] = []
    used: set[str] = set()
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        name = clip(item.get("name"), 40)
        consensus = clip(item.get("consensus") or item.get("summary"), 280)
        developments = clip(item.get("developments"), 900)
        key = name.lower()
        if not name or not consensus or key in used:
            continue
        used.add(key)
        out.append({
            "name": name,
            "consensus": consensus,
            "developments": developments,
        })
        if len(out) >= 6:
            break
    return out


def normalize_surveys(items) -> list[dict]:
    out: list[dict] = []
    used: set[str] = set()
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        title = clip(item.get("title"), 220)
        link = safe_http_url(item.get("link"))
        key = title.lower()
        if not title or not link or key in used:
            continue
        used.add(key)
        year = clip(item.get("year"), 8)
        out.append({
            "title": title,
            "venue": clip(item.get("venue"), 80),
            "year": year,
            "link": link,
            "reason": clip(item.get("reason"), 180) or "该方向的经典或综述文献。",
        })
        if len(out) >= 4:
            break
    return out


def normalize_selected_papers(items, hits: list[dict]) -> list[dict]:
    by_id = {str(item.get("id")): item for item in hits}
    out: list[dict] = []
    used: set[str] = set()
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id") or "")
        paper = by_id.get(item_id)
        if not paper or item_id in used:
            continue
        used.add(item_id)
        out.append(attach_reason(paper, clip(item.get("reason"), 180)))
        if len(out) >= 10:
            break
    if len(out) < 6:
        for paper in hits:
            if paper["id"] in used:
                continue
            out.append(attach_reason(paper, lexical_reason(paper)))
            used.add(paper["id"])
            if len(out) >= 8:
                break
    return out


def empty_briefing(query: str) -> dict:
    return {
        "field_zh": clip(query, 40),
        "field_en": "",
        "coverage": "",
        "scope": "",
        "categories": [],
        "gaps": "",
    }


def parse_briefing(content: str, query: str, hits: list[dict]) -> dict:
    data = parse_model_object(content)
    raw_categories = data.get("categories")
    if not isinstance(raw_categories, list) or not raw_categories:
        raw_categories = data.get("subareas")
    briefing = {
        "field_zh": clip(data.get("field_zh"), 40) or clip(query, 40),
        "field_en": clip(data.get("field_en"), 80),
        "coverage": clip(data.get("coverage"), 220),
        "scope": clip(data.get("scope") or data.get("problem"), 320),
        "categories": normalize_categories(raw_categories),
        "gaps": clip(data.get("gaps") or data.get("open_problems"), 900),
    }
    return {
        "briefing": briefing,
        "surveys": normalize_surveys(data.get("surveys")),
        "papers": normalize_selected_papers(data.get("papers"), hits),
    }


def build_prompts(query: str, hits: list[dict], impression: str = "", surveys: list[dict] | None = None) -> tuple[str, str]:
    listed = "\n".join(
        "\n".join([
            f"{index + 1}. id={paper['id']}",
            f"   title={paper['title']}",
            f"   year={paper.get('year')} venue={paper.get('venue')} category={paper.get('category')} source={paper.get('source')}",
            f"   summary={clip(paper.get('summary'), 240)}",
        ])
        for index, paper in enumerate(hits)
    )
    survey_listed = "\n".join(
        "\n".join([
            f"{index + 1}. title={paper.get('title')}",
            f"   year={paper.get('year')} venue={paper.get('venue')} link={paper.get('link')}",
            f"   reason={clip(paper.get('reason') or survey_reason(paper), 180)}",
        ])
        for index, paper in enumerate(surveys or [])
    )
    user_lines = [
        f"研究方向: {query}",
        "请撰写该领域近五年的国内外研究现状：按方法或主题分类，每类先用一句话写共识并引用具体学者，再比较不同工作的方法、侧重点或结论，最后明确指出研究不足。",
        "奠基与综述请优先从候选 SoK/survey 中选 2 到 4 篇，原样复制 title 与 link。",
    ]
    impression = clip(impression, 800)
    if impression:
        user_lines.extend(["", "研究者印象 / 个人研究方向:", impression])
    user_prompt = "\n".join([
        *user_lines,
        "",
        "FastNews 候选论文:",
        listed or "(none)",
        "",
        "候选奠基/综述:",
        survey_listed or "(none)",
    ])
    return SYSTEM_PROMPT, user_prompt


def run_field_briefing(body: dict | None, root: Path, complete, has_api_key: bool = True) -> tuple[int, dict]:
    body = body if isinstance(body, dict) else {}
    impression = clip(body.get("impression"), 4000)
    query = clip(body.get("query") or body.get("topic") or body.get("q"), 120)
    if not query:
        query = clip(impression, 120)
    if not query:
        return 400, {"error": "query required"}
    category = clip(body.get("category"), 80)
    extra_categories = [category] if category in CATEGORIES else []
    source = clip(body.get("source"), 20) or "all"
    if source not in {"all", "top-conf", "arxiv"}:
        source = "all"
    try:
        arxiv_days = int(body.get("arxiv_days") if body.get("arxiv_days") is not None else DEFAULT_ARXIV_DAYS)
    except (TypeError, ValueError):
        arxiv_days = DEFAULT_ARXIV_DAYS
    arxiv_days = max(0, min(arxiv_days, 3650))
    conference = clip(body.get("conference"), 20)
    conferences = [conference] if conference else []
    search_query = query
    extra = clip(impression, 200)
    if extra and extra not in query:
        search_query = f"{query} {extra}".strip()
    result = search(
        root,
        search_query,
        categories=extra_categories,
        conferences=conferences,
        source=source,
        arxiv_days=arxiv_days,
        limit=BRIEFING_CANDIDATE_LIMIT,
    )
    hits = result["items"]
    survey_hits = search_surveys(
        root,
        search_query,
        categories=extra_categories,
        conferences=conferences,
        source=source,
        limit=SURVEY_CANDIDATE_LIMIT,
    )
    payload = {
        "query": query,
        "terms": result["terms"],
        "categories": result["categories"],
        "corpus_size": result["corpus_size"],
        "hit_count": result["hit_count"],
        "briefing": None,
        "surveys": surveys_from_papers(survey_hits),
        "papers": [],
        "source": "lexical",
        "coverage": coverage_note(result, root),
    }
    if not hits:
        return 200, payload
    if has_api_key:
        content = ""
        try:
            system_prompt, user_prompt = build_prompts(query, hits, impression, survey_hits)
            content = complete(system_prompt, user_prompt)
            parsed = parse_briefing(content, query, hits)
            parsed["surveys"] = merge_surveys(parsed.get("surveys") or [], survey_hits)
            parsed["papers"] = drop_papers_in_surveys(parsed.get("papers") or [], parsed["surveys"])
            payload.update(parsed)
            payload["source"] = "llm"
            if not payload["coverage"]:
                payload["coverage"] = coverage_note(result, root)
            return 200, payload
        except Exception as exc:
            log_stderr(
                "field-briefing fallback %s: %s content=%s"
                % (type(exc).__name__, exc, str(content or "")[:400])
            )
            payload["papers"] = drop_papers_in_surveys(lexical_papers(hits), payload["surveys"])
            return 200, payload
    payload["papers"] = drop_papers_in_surveys(lexical_papers(hits), payload["surveys"])
    return 200, payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Search FastNews papers for a field briefing.")
    parser.add_argument("-q", "--query", required=True, help="field, topic, or keywords")
    parser.add_argument("--category", action="append", default=[], help="restrict to FastNews category")
    parser.add_argument("--conference", action="append", default=[], help="usenix, ieee-sp, ndss, ccs, arxiv")
    parser.add_argument("--year", action="append", default=[], help="restrict to year")
    parser.add_argument("--source", choices=["all", "top-conf", "arxiv"], default="all")
    parser.add_argument("--arxiv-days", type=int, default=DEFAULT_ARXIV_DAYS, help="0 means all arXiv dates")
    parser.add_argument("--limit", type=int, default=DEFAULT_SEARCH_LIMIT)
    parser.add_argument("--min-score", type=float, default=1.0)
    parser.add_argument("--format", choices=["json", "text"], default="json")
    return parser.parse_args()


def main() -> int:
    configure_stdout()
    args = parse_args()
    payload = search(
        find_root(),
        args.query,
        categories=args.category,
        conferences=args.conference,
        years=[int(year) for year in args.year if str(year).isdigit()],
        source=args.source,
        arxiv_days=args.arxiv_days,
        limit=args.limit,
        min_score=args.min_score,
    )
    if args.format == "text":
        print(f"query: {payload['query']}")
        print(f"categories: {', '.join(payload['categories']) or '(none)'}")
        print(f"hits: {payload['hit_count']} / {payload['corpus_size']}")
        for index, item in enumerate(payload["items"], 1):
            print(f"{index}. [{item['score']}] {item['year']} {item['venue']} | {item['title']}")
            print(f"   {item['category']} | {item['link']}")
            if item["summary"]:
                print(f"   {item['summary']}")
        return 0
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
