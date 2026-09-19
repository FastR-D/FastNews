#!/usr/bin/env python3
"""Search FastNews top-conference and arXiv corpora for a field-briefing query."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

CONFERENCE_LABELS = {
    "usenix": "USENIX Security",
    "ieee-sp": "IEEE S&P",
    "ndss": "NDSS",
    "ccs": "ACM CCS",
}
CONFERENCE_FILE_RE = re.compile(
    r"^(?P<conference>usenix|ieee-sp|ndss|ccs)_(?P<year>\d{4})$"
)
ARXIV_SOURCES = {
    "https://rss.arxiv.org/atom/cs.cr": "arXiv cs.CR",
    "https://rss.arxiv.org/atom/cs.ai+cs.cl": "arXiv cs.AI/CL",
}
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


def configure_stdout() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")


def find_root() -> Path:
    start = Path.cwd().resolve()
    candidates = [start, *start.parents, *Path(__file__).resolve().parents]
    seen: set[Path] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        if (candidate / "top-conf" / "data").exists() and (candidate / "secnews" / "data").exists():
            return candidate
    raise SystemExit("cannot locate FastNews repo root (missing top-conf/data and secnews/data)")


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Search FastNews papers for a field briefing.")
    parser.add_argument("-q", "--query", required=True, help="field, topic, or keywords")
    parser.add_argument("--category", action="append", default=[], help="restrict to FastNews category")
    parser.add_argument("--conference", action="append", default=[], help="usenix, ieee-sp, ndss, ccs, arxiv")
    parser.add_argument("--year", action="append", default=[], help="restrict to year")
    parser.add_argument("--source", choices=["all", "top-conf", "arxiv"], default="all")
    parser.add_argument("--arxiv-days", type=int, default=90, help="0 means all arXiv dates")
    parser.add_argument("--limit", type=int, default=16)
    parser.add_argument("--min-score", type=float, default=1.0)
    parser.add_argument("--format", choices=["json", "text"], default="json")
    return parser.parse_args()


def main() -> int:
    configure_stdout()
    args = parse_args()
    root = find_root()
    terms, categories, specific = expand_query(args.query, args.category)
    years = {int(year) for year in args.year if str(year).isdigit()}
    conferences = {item.lower() for item in args.conference}

    corpus: list[dict] = []
    if args.source in {"all", "top-conf"}:
        corpus.extend(load_top_conf(root))
    if args.source in {"all", "arxiv"}:
        corpus.extend(load_arxiv(root, args.arxiv_days))

    ranked = []
    seen_titles: set[str] = set()
    for paper in corpus:
        title_key = re.sub(r"\W+", "", str(paper.get("title") or "").lower())
        if title_key and title_key in seen_titles:
            continue
        if years and paper.get("year") not in years:
            continue
        if conferences and paper.get("conference") not in conferences:
            continue
        if args.category and paper.get("source") == "top-conf" and paper.get("category") not in args.category:
            continue
        score, matched, lexical = score_paper(paper, terms, categories)
        if specific and not lexical:
            continue
        if not specific and categories and paper.get("category") not in categories and not lexical:
            continue
        if score < args.min_score:
            continue
        ranked.append((score, matched, paper))
        if title_key:
            seen_titles.add(title_key)
    ranked.sort(key=lambda item: (-item[0], -(item[2].get("year") or 0), item[2]["title"]))
    ranked = ranked[: max(args.limit, 0)]

    items = []
    for score, matched, paper in ranked:
        items.append(
            {
                "id": paper["id"],
                "source": paper["source"],
                "title": paper["title"],
                "title_zh": paper.get("title_zh") or "",
                "author": paper["author"],
                "year": paper.get("year"),
                "venue": paper["venue"],
                "category": paper["category"],
                "link": paper["link"],
                "summary": paper["summary"],
                "score": round(score, 3),
                "matched_terms": matched[:8],
            }
        )
    payload = {
        "query": args.query,
        "terms": terms,
        "categories": categories,
        "specific": specific,
        "source_filter": args.source,
        "arxiv_days": args.arxiv_days,
        "corpus_size": len(corpus),
        "hit_count": len(items),
        "items": items,
    }
    if args.format == "text":
        print(f"query: {payload['query']}")
        print(f"categories: {', '.join(categories) or '(none)'}")
        print(f"hits: {payload['hit_count']} / {payload['corpus_size']}")
        for index, item in enumerate(items, 1):
            print(f"{index}. [{item['score']}] {item['year']} {item['venue']} | {item['title']}")
            print(f"   {item['category']} | {item['link']}")
            if item["summary"]:
                print(f"   {item['summary']}")
        return 0
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
