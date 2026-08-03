import argparse
from datetime import datetime, UTC
import os
from pathlib import Path
import re

from jinja2 import Environment, FileSystemLoader, select_autoescape


REPORT_DIRS = (
    ("top-conf/data/report", "Top Conference"),
    ("secnews/data/report", "Security Digest"),
)


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
        "usenix": "USENIX Security",
        "ieee sp": "IEEE S&P",
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
            pdf_path = html_path.with_suffix(".pdf")
            stat = html_path.stat()
            html_href = os.path.relpath(html_path, relative_to).replace(os.sep, "/")
            pdf_href = (
                os.path.relpath(pdf_path, relative_to).replace(os.sep, "/")
                if pdf_path.exists()
                else ""
            )
            reports.append(
                {
                    "title": report_title(html_path),
                    "kind": report_kind,
                    "html_path": html_href,
                    "pdf_path": pdf_href,
                    "updated_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
                    "size_label": size_label(stat.st_size),
                    "sort_time": stat.st_mtime,
                }
            )

    return sorted(reports, key=lambda item: item["sort_time"], reverse=True)


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
        pdf_count=sum(1 for item in reports if item["pdf_path"]),
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
