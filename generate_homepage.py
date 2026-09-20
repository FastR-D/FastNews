import argparse
from datetime import datetime, UTC, timedelta, timezone
import json
import os
from pathlib import Path
import re

from jinja2 import Environment, FileSystemLoader, select_autoescape

import field_briefing


REPORT_DIRS = (
    ("top-conf/data/report", "Top Conference"),
    ("secnews/data/report", "Security Digest"),
)
FIELD_BRIEFING_EXAMPLES = [
    "LLM jailbreak",
    "侧信道",
    "TEE",
    "提示注入",
    "模糊测试",
    "差分隐私",
]
SUMMARY_BRIEF_EXAMPLES = [
    "四大顶会全景",
    "LLM jailbreak",
    "侧信道",
    "模糊测试",
    "差分隐私",
]
CONFERENCE_LABELS = {
    "usenix": "USENIX Security",
    "ieee-sp": "IEEE S&P",
    "ndss": "NDSS",
    "ccs": "ACM CCS",
}
REPORT_STEM_RE = re.compile(
    r"^(?P<conf>USENIX|IEEE-SP|NDSS|CCS)_(?P<year>\d{4})(?:_Report)?$",
    re.IGNORECASE,
)
CONFERENCE_SORT = {
    "usenix": 0,
    "ieee-sp": 1,
    "ndss": 2,
    "ccs": 3,
}


def size_label(size):
    if size >= 1024 * 1024:
        return f"{size / 1024 / 1024:.1f} MB"
    if size >= 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size} B"


def report_title(path):
    match = REPORT_STEM_RE.match(path.stem)
    if match:
        label = CONFERENCE_LABELS.get(match.group("conf").lower())
        if label:
            return f"{label} {match.group('year')}"
    name = path.stem.replace("_", " ").replace("-", " ")
    name = " ".join(name.split())
    replacements = {
        "usenix": CONFERENCE_LABELS["usenix"],
        "ieee sp": CONFERENCE_LABELS["ieee-sp"],
    }
    for old, new in replacements.items():
        name = re.sub(re.escape(old), new, name, flags=re.IGNORECASE)
    return name


def _report_sort_key(item):
    year = item.get("year") or 0
    if year:
        return (
            0,
            -int(year),
            CONFERENCE_SORT.get(item.get("conference_key") or "", 99),
            item["title"],
        )
    return (1, -item["sort_time"], 0, item["title"])


def collect_reports(kind=None, relative_to=Path("."), dirs=REPORT_DIRS):
    reports = []
    for directory, report_kind in dirs:
        if kind is not None and report_kind != kind:
            continue
        root = Path(directory)
        if not root.exists():
            continue

        for html_path in sorted(root.glob("*.html")):
            stat = html_path.stat()
            html_href = os.path.relpath(html_path, relative_to).replace(os.sep, "/")
            pdf_path = html_path.with_suffix(".pdf")
            pdf_href = ""
            pdf_size_label = ""
            if pdf_path.is_file():
                pdf_href = os.path.relpath(pdf_path, relative_to).replace(os.sep, "/")
                pdf_size_label = size_label(pdf_path.stat().st_size)
            match = REPORT_STEM_RE.match(html_path.stem)
            conference_key = match.group("conf").lower() if match else ""
            year = int(match.group("year")) if match else 0
            reports.append(
                {
                    "title": report_title(html_path),
                    "kind": report_kind,
                    "html_path": html_href,
                    "pdf_path": pdf_href,
                    "download_name": html_path.name,
                    "pdf_download_name": pdf_path.name if pdf_href else "",
                    "updated_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
                    "size_label": size_label(stat.st_size),
                    "pdf_size_label": pdf_size_label,
                    "sort_time": stat.st_mtime,
                    "conference_key": conference_key,
                    "year": year,
                }
            )

    return sorted(reports, key=_report_sort_key)


def json_for_script(value):
    """Serialize data for an inline script without allowing HTML termination."""
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def collect_conference_papers():
    """Load classified conference papers for the interactive top-conference index."""
    source_root = Path("top-conf/data/conferences")
    summary_root = Path("top-conf/data/summary")
    if not source_root.exists() or not summary_root.exists():
        return []

    papers = []
    for source_path in sorted(source_root.glob("*.jsonl")):
        match = re.match(
            r"^(?P<conference>usenix|ieee-sp|ndss|ccs)_(?P<year>\d{4})$",
            source_path.stem,
        )
        if not match:
            continue
        conference = match.group("conference")
        year = int(match.group("year"))
        summary_path = summary_root / f"{conference}_{year}_summary.jsonl"
        if not summary_path.exists():
            continue

        source_papers = {}
        with source_path.open(encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    paper = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(paper, dict):
                    continue
                paper_id = paper.get("_id") or paper.get("link")
                if paper_id:
                    source_papers[paper_id] = paper

        summaries = {}
        with summary_path.open(encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                paper = record.get("paper") if isinstance(record, dict) else None
                if not isinstance(paper, dict):
                    continue
                paper_id = paper.get("_id") or paper.get("link")
                if paper_id in source_papers:
                    summaries[paper_id] = record

        for paper_id, source_paper in source_papers.items():
            record = summaries.get(paper_id)
            if not record:
                continue
            summarized_paper = record["paper"]
            title = summarized_paper.get("title") or source_paper.get("title")
            if not title:
                continue
            link = summarized_paper.get("link") or source_paper.get("link", "")
            papers.append(
                {
                    "id": paper_id,
                    "title": title,
                    "summary": summarized_paper.get("summary_zh")
                    or source_paper.get("description", ""),
                    "author": summarized_paper.get("author")
                    or source_paper.get("author", ""),
                    "link": link,
                    "category": record.get("category") or "Uncategorized",
                    "conference": conference,
                    "conference_label": CONFERENCE_LABELS[conference],
                    "year": year,
                }
            )
    return sorted(
        papers,
        key=lambda item: (item["year"], item["conference_label"], item["category"], item["title"]),
        reverse=True,
    )


def collect_news_days(root=Path("secnews/data/articles")):
    """Build a compact date index; article files are loaded by the browser on demand."""
    days = []
    if not root.exists():
        return days

    for path in sorted(root.glob("*.jsonl")):
        try:
            datetime.strptime(path.stem, "%Y-%m-%d")
        except ValueError:
            continue
        with path.open(encoding="utf-8") as handle:
            count = 0
            for line in handle:
                if not line.strip():
                    continue
                try:
                    article = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(article, dict):
                    count += 1
        if not count:
            continue
        days.append({"date": path.stem, "count": count})
    return days



SHANGHAI = timezone(timedelta(hours=8))


def format_date_zh(value):
    parsed = datetime.strptime(value, "%Y-%m-%d")
    return f"{parsed.year}年{parsed.month}月{parsed.day}日"


def classify_news_channel(source):
    lowered = str(source or "").lower()
    if "bleepingcomputer" in lowered:
        return "bleepingcomputer"
    if "arxiv" in lowered:
        return "arxiv"
    return "other"


def news_source_label(source):
    channel = classify_news_channel(source)
    if channel == "bleepingcomputer":
        return "BleepingComputer"
    if channel == "arxiv":
        return "arXiv"
    return "其他来源"


SCORE_KEYWORDS = (
    ("zero-day", 2.4),
    ("0-day", 2.4),
    ("rce", 1.8),
    ("remote code", 1.8),
    ("ransomware", 1.6),
    ("actively exploited", 2.0),
    ("critical", 1.1),
    ("supply chain", 1.5),
    ("backdoor", 1.3),
    ("nation-state", 1.4),
    ("apt ", 1.0),
    ("breach", 0.8),
    ("malware", 0.6),
    ("vulnerability", 0.5),
    ("exploit", 0.9),
    ("privacy", 0.4),
)


def heuristic_news_score(article):
    categories = article.get("categories") or []
    blob = " ".join([
        str(article.get("title") or ""),
        str(article.get("title_zh") or ""),
        str(article.get("summary_zh") or article.get("description") or ""),
        " ".join(str(item) for item in categories),
    ]).lower()
    score = 4.2
    if classify_news_channel(article.get("source")) == "bleepingcomputer":
        score += 0.4
    for keyword, bump in SCORE_KEYWORDS:
        if keyword in blob:
            score += bump
    joined_categories = " ".join(str(item).lower() for item in categories)
    if "cs.cr" in joined_categories:
        score += 0.6
    return round(min(10.0, max(0.0, score)), 1)


def article_news_score(article):
    raw = article.get("score")
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return max(0.0, min(10.0, float(raw)))
    return heuristic_news_score(article)


def collect_news_preview(date, limit=6):
    """Load a short homepage teaser from the highest-value news and papers."""
    if not date:
        return []

    summaries = {}
    summary_path = Path("secnews/data/daily_summaries") / f"{date}.json"
    if summary_path.exists():
        try:
            payload = json.loads(summary_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = {}
        raw = payload.get("articles") if isinstance(payload, dict) else None
        if isinstance(raw, list):
            for item in raw:
                if not isinstance(item, dict):
                    continue
                key = item.get("_id") or item.get("link")
                if key:
                    summaries[key] = item

    articles = []
    article_path = Path("secnews/data/articles") / f"{date}.jsonl"
    if article_path.exists():
        with article_path.open(encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(item, dict):
                    continue
                key = item.get("_id") or item.get("link")
                summarized = summaries.get(key, {})
                merged = dict(item)
                for field in ("title_zh", "summary_zh", "title", "link", "source", "categories", "score", "score_reason"):
                    value = summarized.get(field)
                    if value:
                        merged[field] = value
                articles.append(merged)
    elif summaries:
        articles = list(summaries.values())

    def to_preview(article):
        title = article.get("title_zh") or article.get("title")
        if not title:
            return None
        categories = article.get("categories") or []
        tag = str(categories[0]) if isinstance(categories, list) and categories else ""
        return {
            "title": str(title),
            "link": str(article.get("link") or ""),
            "source": news_source_label(article.get("source")),
            "tag": tag,
            "_score": article_news_score(article),
            "_channel": classify_news_channel(article.get("source")),
        }

    ranked = [item for item in (to_preview(article) for article in articles) if item]
    ranked.sort(key=lambda item: item["_score"], reverse=True)
    news_items = [item for item in ranked if item["_channel"] != "arxiv"]
    paper_items = [item for item in ranked if item["_channel"] == "arxiv"]
    news_quota = min(len(news_items), max(4, (limit + 1) // 2 + 1))
    preview = news_items[:news_quota]
    preview.extend(paper_items[: max(0, limit - len(preview))])
    if len(preview) < limit:
        preview.extend(news_items[news_quota: news_quota + (limit - len(preview))])
    cleaned = []
    for item in preview[:limit]:
        cleaned.append({
            "title": item["title"],
            "link": item["link"],
            "source": item["source"],
            "tag": item["tag"],
        })
    return cleaned



def latest_home_news(news_days):
    today = datetime.now(SHANGHAI).strftime("%Y-%m-%d")
    today_entry = next((item for item in news_days if item["date"] == today), None)
    latest = today_entry or (news_days[-1] if news_days else None)
    if not latest:
        return {
            "date": "",
            "date_label": "暂无资讯",
            "count": 0,
            "is_today": False,
            "preview": [],
        }
    return {
        "date": latest["date"],
        "date_label": format_date_zh(latest["date"]),
        "count": latest["count"],
        "is_today": latest["date"] == today,
        "preview": collect_news_preview(latest["date"]),
    }


def render_page(page_mode, output, field_stats):
    page_config = {
        "home": {
            "kind": None,
            "title": "安全研究报告工作台",
            "description": "集中访问会议报告和安全周报，并维护感兴趣作者列表。",
            "label": "Local Index",
        },
        "top-conf": {
            "kind": "Top Conference",
            "title": "顶会论文总结",
            "description": "按研究方向浏览 USENIX、IEEE S&P、NDSS 和 ACM CCS 等安全顶会总结。",
            "label": "Top Conference",
        },
        "secnews": {
            "kind": "Security Digest",
            "title": "安全资讯周报",
            "description": "每日优先推荐 10 条高价值资讯，并按 BleepingComputer 与 arXiv 分渠道浏览全部条目。",
            "label": "Security Digest",
        },
        "field-briefing": {
            "kind": "Field Briefing",
            "title": "领域导读",
            "description": "输入一个研究方向，结合你的研究印象，基于顶会中文摘要与近期 arXiv 分类综述近五年研究现状并推荐高相关论文。",
            "label": "Field Briefing",
        },
        "summary-brief": {
            "kind": "Summary Brief",
            "title": "总结汇报",
            "description": "基于 FastNews 顶会中文摘要生成数据实证简报：封面结论、三条发现、会场与类别对照，以及局限与讨论。",
            "label": "Summary Brief",
        },
        "inbox": {
            "kind": None,
            "title": "私信",
            "description": "每天优先推送关注作者的论文；没有新作时再结合研究印象与标签挑选。",
            "label": "Inbox",
        },
        "impression": {
            "kind": None,
            "title": "研究印象",
            "description": "写下自己的研究方向。领域导读、总结汇报、找论文和每日推送都会结合这份专属印象。",
            "label": "Research Profile",
        },
    }[page_mode]

    reports = collect_reports(page_config["kind"], output.parent)
    top_conf_reports = (
        reports
        if page_config["kind"] == "Top Conference"
        else collect_reports("Top Conference", output.parent)
    )
    secnews_reports = (
        reports
        if page_config["kind"] == "Security Digest"
        else collect_reports("Security Digest", output.parent)
    )
    news_days = collect_news_days() if page_mode in {"home", "secnews"} else []
    home_news = latest_home_news(news_days) if page_mode == "home" else None
    conference_papers = collect_conference_papers() if page_mode == "top-conf" else []
    env = Environment(
        loader=FileSystemLoader(str(Path(__file__).resolve().parent / "prompt")),
        autoescape=select_autoescape(("html", "j2")),
    )
    template = env.get_template("homepage.html.j2")
    content = template.render(
        generated_at=datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC"),
        page_mode=page_mode,
        page_title=page_config["title"],
        page_description=page_config["description"],
        page_label=page_config["label"],
        home_path="index.html" if page_mode == "home" else "../index.html",
        top_conf_path="top-conf/index.html" if page_mode == "home" else "../top-conf/index.html",
        secnews_path="secnews/index.html" if page_mode == "home" else "../secnews/index.html",
        field_briefing_path="field-briefing/index.html" if page_mode == "home" else "../field-briefing/index.html",
        summary_brief_path="summary-brief/index.html" if page_mode == "home" else "../summary-brief/index.html",
        inbox_path="inbox/index.html" if page_mode == "home" else ("index.html" if page_mode == "inbox" else "../inbox/index.html"),
        impression_path="impression/index.html" if page_mode == "home" else ("index.html" if page_mode == "impression" else "../impression/index.html"),
        root_prefix="" if page_mode == "home" else "../",
        asset_prefix="assets/" if page_mode == "home" else "../assets/",
        reports=reports,
        top_conf_reports=top_conf_reports,
        top_conf_count=len(top_conf_reports),
        secnews_count=len(secnews_reports),
        news_days=news_days,
        news_days_json=json.dumps(news_days, ensure_ascii=False),
        news_total=sum(item["count"] for item in news_days),
        news_latest=news_days[-1]["date"] if news_days else "暂无",
        news_article_base="data/articles/" if page_mode == "secnews" else "secnews/data/articles/" if page_mode == "home" else "",
        news_summary_base="data/daily_summaries/" if page_mode == "secnews" else "secnews/data/daily_summaries/" if page_mode == "home" else "",
        home_news_date="" if not home_news else home_news["date"],
        home_news_date_label="" if not home_news else home_news["date_label"],
        home_news_count=0 if not home_news else home_news["count"],
        home_news_is_today=False if not home_news else home_news["is_today"],
        home_news_preview=[] if not home_news else home_news["preview"],
        conference_papers=conference_papers,
        conference_papers_json=json_for_script(conference_papers),
        conference_years=sorted({paper["year"] for paper in conference_papers}, reverse=True),
        conference_count=len({paper["conference"] for paper in conference_papers}),
        conference_category_count=len({paper["category"] for paper in conference_papers}),
        field_briefing_top_conf_count=field_stats["top_conf"],
        field_briefing_arxiv_count=field_stats["arxiv"],
        field_briefing_category_count=field_stats["category_count"],
        field_briefing_categories=field_briefing.CATEGORIES,
        field_briefing_examples=FIELD_BRIEFING_EXAMPLES,
        field_briefing_categories_json=json_for_script(field_briefing.CATEGORIES),
        field_briefing_examples_json=json_for_script(FIELD_BRIEFING_EXAMPLES),
        field_briefing_coverage=field_stats.get("coverage") or field_briefing.coverage_note({"arxiv_days": 90}, Path(".")),
        summary_brief_examples=SUMMARY_BRIEF_EXAMPLES,
        summary_brief_examples_json=json_for_script(SUMMARY_BRIEF_EXAMPLES),
    )
    output.write_text(content, encoding="utf-8")
    print(f"Page generated: {output}")


def render_homepage(output):
    field_stats = field_briefing.corpus_stats(Path("."))
    Path("field-briefing").mkdir(exist_ok=True)
    Path("summary-brief").mkdir(exist_ok=True)
    Path("inbox").mkdir(exist_ok=True)
    Path("impression").mkdir(exist_ok=True)
    render_page("home", output, field_stats)
    render_page("top-conf", Path("top-conf/index.html"), field_stats)
    render_page("secnews", Path("secnews/index.html"), field_stats)
    render_page("field-briefing", Path("field-briefing/index.html"), field_stats)
    render_page("summary-brief", Path("summary-brief/index.html"), field_stats)
    render_page("inbox", Path("inbox/index.html"), field_stats)
    render_page("impression", Path("impression/index.html"), field_stats)


def main():
    parser = argparse.ArgumentParser(description="Generate FastNews report homepage")
    parser.add_argument("--output", type=Path, default=Path("index.html"))
    args = parser.parse_args()
    render_homepage(args.output)


if __name__ == "__main__":
    main()
