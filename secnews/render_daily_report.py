"""将 daily_summaries 的逐日中文摘要渲染成安全资讯汇总页。

为什么需要这个脚本：
  generate_pdf.py 只读取 newspapers/*.json，而 generate_newspaper.py 每个
  数据源只取前 200 篇（见其 get_articles 中的 [:200]），面对上千篇文章会大量遗漏。
  generate_daily_summary.py 则是逐日完整处理，覆盖每篇文章并产出 title_zh /
  summary_zh。本脚本把后者的结果复用 newspaper.html.j2 模板渲染成页面，
  从而完整呈现整段时间的全部文章。

用法：
  python -m secnews.render_daily_report --start 2026-08-20 --end 2026-09-01
"""

import argparse
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

from jinja2 import Template

SUMMARIES_DIR = Path("secnews/data/daily_summaries")
TEMPLATE_PATH = Path("secnews/prompt/newspaper.html.j2")
OUTPUT_PATH = Path("secnews/index.html")
REPORT_DIR = Path("secnews/data/report")

# 与 secnews/util.py 的 SOURCES 保持一致
SOURCE_KEYS = {
    "https://www.bleepingcomputer.com/feed/": "bleepingcomputer",
    "https://rss.arxiv.org/atom/cs.cr": "arxiv_cs_cr",
    "https://rss.arxiv.org/atom/cs.ai+cs.cl": "arxiv_cs_ai",
}


def load_sections(start_date, end_date):
    sections = {key: [] for key in SOURCE_KEYS.values()}
    seen_ids = set()
    skipped_incomplete = []

    for path in sorted(SUMMARIES_DIR.glob("*.json")):
        if not (start_date <= path.stem <= end_date):
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as error:
            print(f"跳过无法读取的 {path}: {error}")
            continue

        # complete=False 表示当天尚未处理完，纳入会产生不完整的页面
        if not payload.get("complete"):
            skipped_incomplete.append(path.stem)
            continue

        for article in payload.get("articles", []):
            article_id = article.get("_id")
            if not article_id or article_id in seen_ids:
                continue
            key = SOURCE_KEYS.get(article.get("source", ""))
            if not key:
                continue
            seen_ids.add(article_id)
            sections[key].append(
                {
                    "title": article.get("title_zh") or article.get("title", ""),
                    "title_orig": article.get("title", ""),
                    "link": article.get("link", ""),
                    "intro": article.get("summary_zh", ""),
                    "date": path.stem,
                }
            )

    for key in sections:
        sections[key].sort(key=lambda item: item["date"], reverse=True)

    if skipped_incomplete:
        print(f"警告：以下日期尚未生成完毕，未纳入页面：{', '.join(skipped_incomplete)}")
    return sections


def render(start_date, end_date, report_title, output_path, backup_name=None):
    sections = load_sections(start_date, end_date)
    total = sum(len(items) for items in sections.values())
    if not total:
        print("没有可渲染的摘要，页面未更新。")
        return 1

    print(f"渲染范围 {start_date} ~ {end_date}，共 {total} 篇：")
    for key, items in sections.items():
        print(f"  {key}: {len(items)}")

    html = Template(TEMPLATE_PATH.read_text(encoding="utf-8")).render(
        report_title=report_title,
        date_range=f"{start_date} ~ {end_date}",
        sections=sections,
        generated_at=datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC"),
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")
    print(f"已写入 {output_path} ({len(html.encode('utf-8')) / 1024:.1f} KB)")

    if backup_name:
        REPORT_DIR.mkdir(parents=True, exist_ok=True)
        backup_path = REPORT_DIR / f"{backup_name}.html"
        shutil.copyfile(output_path, backup_path)
        print(f"已备份 {backup_path}（供首页索引收录）")
    return 0


def main():
    parser = argparse.ArgumentParser(description="把每日中文摘要渲染为安全资讯汇总页")
    parser.add_argument("--start", required=True, help="起始日期 YYYY-MM-DD")
    parser.add_argument("--end", required=True, help="结束日期 YYYY-MM-DD")
    parser.add_argument("--title", default=None, help="报告标题")
    parser.add_argument("--output", default=str(OUTPUT_PATH), help="输出 HTML 路径")
    parser.add_argument("--backup-name", default=None, help="同时备份到 report 目录的文件名")
    args = parser.parse_args()

    title = args.title or f"{args.start} ~ {args.end} 安全资讯汇总"
    raise SystemExit(
        render(args.start, args.end, title, Path(args.output), args.backup_name)
    )


if __name__ == "__main__":
    main()
