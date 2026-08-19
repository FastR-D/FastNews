import argparse
from datetime import datetime, UTC
import json
import os
from pathlib import Path
import re

from jinja2 import Environment, FileSystemLoader, select_autoescape


REPORT_DIRS = (
    ("top-conf/data/report", "Top Conference"),
    ("secnews/data/report", "Security Digest"),
)
CONFERENCE_LABELS = {
    "usenix": "USENIX Security",
    "ieee-sp": "IEEE S&P",
    "ndss": "NDSS",
    "ccs": "ACM CCS",
}
def size_label(size):
    if size >= 1024 * 1024:
        return f"{size / 1024 / 1024:.1f} MB"
    if size >= 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size} B"


def report_title(path):
    name = path.stem.replace("_", " ").replace("-", " ")
    name = " ".join(name.split())
    replacements = {
        "usenix": CONFERENCE_LABELS["usenix"],
        "ieee sp": CONFERENCE_LABELS["ieee-sp"],
    }
    for old, new in replacements.items():
        name = re.sub(re.escape(old), new, name, flags=re.IGNORECASE)
    return name


def collect_reports(kind=None, relative_to=Path(".")):
    reports = []
    for directory, report_kind in REPORT_DIRS:
        if kind is not None and report_kind != kind:
            continue
        root = Path(directory)
        if not root.exists():
            continue

        for html_path in sorted(root.glob("*.html")):
            stat = html_path.stat()
            html_href = os.path.relpath(html_path, relative_to).replace(os.sep, "/")
            reports.append(
                {
                    "title": report_title(html_path),
                    "kind": report_kind,
                    "html_path": html_href,
                    "updated_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
                    "size_label": size_label(stat.st_size),
                    "sort_time": stat.st_mtime,
                }
            )

    return sorted(reports, key=lambda item: item["sort_time"], reverse=True)


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


def render_page(page_mode, output):
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
            "description": "浏览由 BleepingComputer 和 arXiv 生成的安全资讯周报。",
            "label": "Security Digest",
        },
    }[page_mode]

    reports = collect_reports(page_config["kind"], output.parent)
    news_days = collect_news_days() if page_mode == "secnews" else []
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
        reports=reports,
        top_conf_count=sum(1 for item in collect_reports("Top Conference", output.parent)),
        secnews_count=sum(1 for item in collect_reports("Security Digest", output.parent)),
        news_days=news_days,
        news_days_json=json.dumps(news_days, ensure_ascii=False),
        news_total=sum(item["count"] for item in news_days),
        news_latest=news_days[-1]["date"] if news_days else "暂无",
        news_article_base="data/articles/" if page_mode == "secnews" else "",
        news_summary_base="data/daily_summaries/" if page_mode == "secnews" else "",
        conference_papers=conference_papers,
        conference_papers_json=json_for_script(conference_papers),
        conference_years=sorted({paper["year"] for paper in conference_papers}, reverse=True),
        conference_count=len({paper["conference"] for paper in conference_papers}),
        conference_category_count=len({paper["category"] for paper in conference_papers}),
    )
    output.write_text(content, encoding="utf-8")
    print(f"Page generated: {output}")


def render_homepage(output):
    render_page("home", output)
    render_page("top-conf", Path("top-conf/index.html"))
    render_page("secnews", Path("secnews/index.html"))


def main():
    parser = argparse.ArgumentParser(description="Generate FastNews report homepage")
    parser.add_argument("--output", type=Path, default=Path("index.html"))
    args = parser.parse_args()
    render_homepage(args.output)


if __name__ == "__main__":
    main()
