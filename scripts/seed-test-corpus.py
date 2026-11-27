#!/usr/bin/env python3
"""Synthetic, isolated browser fixtures. Never copies a collected corpus."""
import datetime
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])


def write(path, value, lines=False):
    dest = root / path
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in value)
        if lines else json.dumps(value, ensure_ascii=False), encoding="utf-8"
    )


papers = [dict(
    _id=f"https://example.org/paper/{i}", title=f"Example {i}: Coding Agents for Privacy and LLM Security",
    link=f"https://example.org/paper/{i}", author="Alice Example, Example University; Bob Example, Example Institute",
    description="We evaluate coding agents on software issue resolution, program repair and unit testing. This synthetic fixture contains no research claims.",
    track="conference", source="USENIX Security 2025",
) for i in range(16)]
write("top-conf/data/conferences/usenix_2025.jsonl", papers, True)
write("top-conf/data/summary/usenix_2025_summary.jsonl", [dict(category="ML/AI Security", paper=dict(
    _id=p["_id"], title=p["title"], link=p["link"], author=p["author"], summary_zh="用于界面测试的合成摘要，覆盖智能体评测、程序修复与隐私研究。"
)) for p in papers], True)
write("top-conf/data/report/USENIX_2025_Report.json", [dict(tag="article", paper=dict(
    id=p["_id"], title=p["title"], url=p["link"], authors=p["author"], summary=p["description"], venue="USENIX Security", year="2025"
), children=[dict(tag="h3", children=[dict(text=p["title"])])]) for p in papers])
# A one-page PDF fixture for the download endpoint, not a research artifact.
pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
(root / "top-conf/data/report/USENIX_2025_Report.pdf").write_bytes(pdf)
today = datetime.datetime.now(datetime.timezone.utc).date()
for days in (0, 1, 8, 31):
    date = str(today - datetime.timedelta(days=days))
    news = [dict(_id=f"example-news-{date}-{i}", title=f"Example security and AI bulletin {date} #{i:03d}.",
                 link=f"https://example.org/news/{date}/{i}", source="openai" if i % 2 else "krebs",
                 description="Research fixture for LLM agents and software security.", published=date + "T00:00:00Z") for i in range(24)]
    for i in range(16):
        news.append(dict(_id=f"https://arxiv.org/abs/2611.{days * 100 + i:05d}", title=f"Example Coding Agents Benchmark {date} {i}",
                         link=f"https://arxiv.org/abs/2611.{days * 100 + i:05d}", author="Alice Example",
                         source="arxiv_cs_ai" if i % 2 else "arxiv_cs_se", categories=["cs.AI" if i % 2 else "cs.SE"],
                         description="Abstract: We study coding agents with large language models for software engineering and program repair. Test-only synthetic record.",
                         published=date + "T00:00:00Z"))
    write(f"secnews/data/articles/{date}.jsonl", news, True)
write("secnews/data/report/Weekly_Example.json", [dict(tag="h2", children=[dict(text="Synthetic weekly report")])])

# Author parsing regressions: publisher-style parentheses and shared units.
write("top-conf/data/conferences/ccs_2026.jsonl", [
    dict(_id="author-regression-1",title="Exploring the Exposure of IPv6 End-Host Networks",link="https://example.org/ipv6",author="Hugo Hue (Georgia Institute of Technology), Abhishek Bhaskar (Georgia Institute of Technology), Amanda Hsu (Georgia Institute of Technology), Paul Pearce (University of California, Irvine), Frank Li (Georgia Institute of Technology)",track="conference"),
    dict(_id="author-regression-2",title="The Trade-off Between Performance and Security: Exploring Vulnerabilities in DNS Task Queue Scheduling",link="https://example.org/dns",author="Shiming Liu (Tsinghua University, BNRist), Yunyi Zhang (Tsinghua University), Ruixuan Li (Tsinghua University), Shiyao Guo (Tsinghua University), Baojun Liu (Tsinghua University), Donghong Sun (Tsinghua University), Yong Ma (Alibaba Cloud), Linjian Song (Alibaba Cloud)",track="conference"),
    dict(_id="author-regression-3",title="Shared institution regression",link="https://example.org/ruhr",author="Nurullah Erinola, Marcel Maehren, Marcus Brinkmann, and Jörg Schwenk, Ruhr University Bochum",track="conference"),
],True)
