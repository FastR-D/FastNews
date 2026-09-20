"""Build a data-driven FastNews summary briefing from local papers."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

import field_briefing as fb

TOPIC_STAT_LIMIT = 120
EVIDENCE_LIMIT = 16
LANDSCAPE_TRIGGERS = (
    "四大顶会",
    "顶会全景",
    "全景",
    "总览",
    "landscape",
    "overview",
    "全部论文",
)
SYSTEM_PROMPT = "\n".join([
    "你现在是 FastNews 的实证简报编辑，文风接近数据新闻长图：先给反常识或醒目结论，再用表格数字支撑，最后讨论局限与启示。",
    "只使用提供的 STATS 与候选论文，不得编造论文、会议、年份、链接或任何统计数字。",
    "Return ONLY a JSON object, no markdown.",
    "Schema:",
    '{"kicker":"FastNews · 顶会实证简报","title":"","hook":"","subtitle":"","lead":"","findings":[{"title":"","body":""}],"method":"","questions":[{"qid":"Q1","question":"","answer":""}],"highlights":[{"id":"<candidate id>","blurb":""}],"limitations":"","discussion":[{"title":"","body":""}]}',
    "Rules:",
    "- All prose must be Chinese",
    "- title: 18 到 36 字，像封面标题，点出最值得注意的数据事实，不要空泛口号",
    "- hook: 8 到 18 字，点出反差或主结论，可略锋利",
    "- subtitle: 英文或数据副标题，点明会议/年份/样本量",
    "- lead: 2 到 4 句。可用“本期简报/样本清洗后”开场，说明为什么要看这组数字",
    "- findings: 恰好 3 条。title 短；body 必须引用 STATS 里已有的数字（篇数或百分比），禁止四舍五入改写到对不上",
    "- method: 2 到 4 句说明数据口径、年份范围、分类来源和未覆盖的内容（无引文、无杰出论文标签、不是历史全集）",
    "- questions: 2 到 3 个。qid 用 Q1/Q2/Q3。question 是读者会问的对照问题；answer 解读 STATS 表格，3 到 5 句，点出会场/年份/类别的异同",
    "- highlights: 4 到 8 篇，只能用候选 id，blurb 一句话说它为什么能支撑本期发现",
    "- limitations: 3 到 5 句，具体，禁止空泛套话",
    "- discussion: 2 段。第一段谈如何读这组分布/评审与投稿结构；第二段给研究者的启示（做真问题、别被单次录用或热点占比绑住）",
    "- Length: title<=40, hook<=24, lead<=420, finding.body<=220, method<=420, question.answer<=420, limitations<=500, discussion.body<=360",
])
LANDSCAPE_RE = re.compile("|".join(re.escape(item) for item in LANDSCAPE_TRIGGERS), re.I)


def is_landscape_query(query: str) -> bool:
    text = str(query or "").strip()
    if not text:
        return True
    return bool(LANDSCAPE_RE.search(text))


def _pct(count: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(count * 100 / total, 2)


def _bucket(counter: Counter, total: int, order: list[str] | None = None) -> list[dict]:
    if order:
        pairs = [(label, counter.get(label, 0)) for label in order if counter.get(label, 0)]
        leftover = [(label, count) for label, count in counter.most_common() if label not in order]
        pairs.extend(leftover)
    else:
        pairs = list(counter.most_common())
    return [
        {"label": str(label), "count": int(count), "pct": _pct(int(count), total)}
        for label, count in pairs
        if count
    ]


def compute_stats(items: list[dict]) -> dict:
    total = len(items)
    conf_counts: Counter[str] = Counter()
    year_counts: Counter[int] = Counter()
    cat_counts: Counter[str] = Counter()
    source_counts: Counter[str] = Counter()
    conf_years: dict[str, Counter[int]] = defaultdict(Counter)
    for paper in items:
        venue = str(paper.get("venue") or paper.get("conference") or "未知")
        category = str(paper.get("category") or "Uncategorized")
        source = str(paper.get("source") or "unknown")
        year = paper.get("year")
        conf_counts[venue] += 1
        cat_counts[category] += 1
        source_counts[source] += 1
        if isinstance(year, int):
            year_counts[year] += 1
            conf_years[venue][year] += 1
    years_sorted = sorted(year_counts)
    conference_order = list(fb.CONFERENCE_LABELS.values())
    by_conference = []
    for row in _bucket(conf_counts, total, conference_order):
        row["years"] = {
            str(year): int(conf_years[row["label"]].get(year, 0))
            for year in years_sorted
        }
        by_conference.append(row)
    return {
        "sample_size": total,
        "year_span": fb.format_year_span(years_sorted) if years_sorted else "",
        "by_conference": by_conference,
        "by_year": [
            {"label": str(year), "count": int(year_counts[year]), "pct": _pct(int(year_counts[year]), total)}
            for year in years_sorted
        ],
        "by_category": _bucket(cat_counts, total, list(fb.CATEGORIES)),
        "by_source": _bucket(source_counts, total, ["top-conf", "arxiv"]),
    }


def pick_evidence(items: list[dict], mode: str) -> list[dict]:
    if mode != "landscape":
        return items[:EVIDENCE_LIMIT]
    buckets: dict[str, list[dict]] = {}
    for paper in items:
        buckets.setdefault(str(paper.get("category") or "Miscellaneous"), []).append(paper)
    for papers in buckets.values():
        papers.sort(key=lambda item: (-(item.get("year") or 0), str(item.get("title") or "")))
    categories = [name for name in fb.CATEGORIES if name in buckets]
    categories.extend(name for name in buckets if name not in categories)
    out: list[dict] = []
    used: set[str] = set()
    index = 0
    while len(out) < EVIDENCE_LIMIT:
        progressed = False
        for name in categories:
            bucket = buckets.get(name) or []
            if index >= len(bucket):
                continue
            paper = bucket[index]
            paper_id = str(paper.get("id") or "")
            if paper_id and paper_id not in used:
                used.add(paper_id)
                out.append(paper)
                progressed = True
                if len(out) >= EVIDENCE_LIMIT:
                    break
        if not progressed:
            break
        index += 1
    return out


def collect_items(
    root: Path,
    query: str,
    *,
    mode: str,
    extra_categories: list[str],
    conferences: list[str],
    source: str,
    arxiv_days: int,
) -> tuple[list[dict], dict]:
    if mode == "landscape":
        landscape_source = source if source in {"top-conf", "arxiv"} else "top-conf"
        corpus = fb.get_corpus(root, landscape_source, arxiv_days if landscape_source == "arxiv" else 0)
        conference_set = {item.lower() for item in conferences if item}
        items = []
        for paper in corpus:
            if extra_categories and paper.get("source") == "top-conf" and paper.get("category") not in extra_categories:
                continue
            if conference_set and paper.get("conference") not in conference_set:
                continue
            items.append(fb.public_item(paper, 1.0, []))
        return items, {
            "query": query,
            "terms": [],
            "categories": extra_categories,
            "corpus_size": len(corpus),
            "hit_count": len(items),
            "arxiv_days": arxiv_days,
            "source_filter": landscape_source,
        }
    result = fb.search(
        root,
        query,
        categories=extra_categories,
        conferences=conferences,
        source=source,
        arxiv_days=arxiv_days,
        limit=TOPIC_STAT_LIMIT,
    )
    return result["items"], {
        "query": query,
        "terms": result.get("terms") or [],
        "categories": result.get("categories") or extra_categories,
        "corpus_size": result.get("corpus_size") or 0,
        "hit_count": result.get("hit_count") or 0,
        "arxiv_days": result.get("arxiv_days") or arxiv_days,
        "source_filter": result.get("source_filter") or source,
    }


def lexical_brief(query: str, stats: dict, mode: str, coverage: str) -> dict:
    sample = int(stats.get("sample_size") or 0)
    cats = stats.get("by_category") or []
    years = stats.get("by_year") or []
    confs = stats.get("by_conference") or []
    span = stats.get("year_span") or ""
    if mode == "landscape":
        title = "四大顶会近年研究格局：类别分布并不均匀"
        hook = "先看结构，再谈热点"
    else:
        title = f"{fb.clip(query, 18)}：近年样本的会场与类别对照"
        hook = "数字先于印象"
    findings: list[dict] = []
    if cats:
        top = cats[0]
        extra = f"，第二是 {cats[1]['label']} {cats[1]['count']} 篇（{cats[1]['pct']}%）" if len(cats) > 1 else ""
        findings.append({
            "title": f"{top['label']} 占比最高",
            "body": f"清洗后 {sample} 篇样本里，{top['label']} 有 {top['count']} 篇（{top['pct']}%）{extra}。",
        })
    if len(years) >= 2:
        first, last = years[0], years[-1]
        direction = "增加" if last["count"] >= first["count"] else "减少"
        findings.append({
            "title": f"{first['label']} 到 {last['label']} 样本量{direction}",
            "body": f"{first['label']} 年 {first['count']} 篇，{last['label']} 年 {last['count']} 篇；这是语料覆盖，不是该方向的真实产量。",
        })
    elif years:
        findings.append({
            "title": f"样本集中在 {years[0]['label']} 年",
            "body": f"{years[0]['label']} 年有 {years[0]['count']} 篇（{years[0]['pct']}%），年份跨度有限，不宜外推长期趋势。",
        })
    if confs:
        top = confs[0]
        findings.append({
            "title": f"{top['label']} 样本最多",
            "body": f"{top['label']} 贡献 {top['count']} 篇（{top['pct']}%）。会场录用规模不同，不能直接读成该方向只青睐某一会议。",
        })
    questions = []
    if cats:
        questions.append({
            "qid": "Q1",
            "question": "各类别占比如何，有没有一家独大？",
            "answer": "见下方类别对照。分类来自 FastNews 对顶会摘要的自动标注，不是会议官方 session。",
        })
    if confs:
        questions.append({
            "qid": "Q2",
            "question": "四大会议的样本是否均衡？",
            "answer": "见会场对照表。录用总数本身不同，百分比只能说明当前语料结构，不能单独证明会议偏好。",
        })
    return {
        "kicker": "FastNews · 顶会实证简报",
        "title": title,
        "hook": hook,
        "subtitle": " · ".join(part for part in (span, f"{sample} 篇有效样本") if part),
        "lead": "本期简报把 FastNews 已总结的顶会中文摘要摊开，先核对样本量、会场和类别，再讨论这意味着什么。没有引文窗口，也没有杰出论文标签。",
        "findings": findings[:3],
        "method": coverage,
        "questions": questions,
        "limitations": "语料以 2023–2026 安全四大顶会中文摘要为主，不是近五年全集；分类由 FastNews 自动完成，未做人工逐篇复核，也没有引用次数或获奖信息。",
        "discussion": [
            {
                "title": "读分布，不要只读单篇热点",
                "body": "会场规模、年份覆盖和分类口径都会改变观感。把单篇工作放回这张表里，更不容易被短期热点叙事带走。",
            },
            {
                "title": "时间仍是更好的裁判",
                "body": "高频类别只说明近年投稿与录用结构，不自动等于长期学术价值。把问题做扎实，比迎合当下占比更有生命力。",
            },
        ],
    }


def evidence_lines(papers: list[dict]) -> str:
    rows = []
    for index, paper in enumerate(papers):
        rows.append("\n".join([
            f"{index + 1}. id={paper.get('id')}",
            f"   title={paper.get('title')}",
            f"   year={paper.get('year')} venue={paper.get('venue')} category={paper.get('category')} source={paper.get('source')}",
            f"   summary={fb.clip(paper.get('summary'), 220)}",
        ]))
    return "\n".join(rows)


def build_prompts(
    query: str,
    stats: dict,
    evidence: list[dict],
    impression: str,
    coverage: str,
    mode: str,
) -> tuple[str, str]:
    user_lines = [
        f"简报主题: {query}",
        f"模式: {'四大顶会全景' if mode == 'landscape' else '方向实证'}",
        "请根据 STATS 写一期数据新闻式总结汇报：封面结论、三条发现、数据口径、两个对照问题、局限与讨论。",
        "所有数字必须与 STATS 一致。",
        f"语料说明: {coverage}",
        "",
        "STATS:",
        json.dumps(stats, ensure_ascii=False),
        "",
        "候选论文:",
        evidence_lines(evidence) or "(none)",
    ]
    impression = fb.clip(impression, 800)
    if impression:
        user_lines.extend(["", "研究者印象 / 个人研究方向:", impression])
    return SYSTEM_PROMPT, "\n".join(user_lines)


def normalize_findings(items) -> list[dict]:
    out: list[dict] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        title = fb.clip(item.get("title"), 40)
        body = fb.clip(item.get("body"), 280)
        if not title or not body:
            continue
        out.append({"title": title, "body": body})
        if len(out) >= 3:
            break
    return out


def normalize_questions(items) -> list[dict]:
    out: list[dict] = []
    for index, item in enumerate(items if isinstance(items, list) else []):
        if not isinstance(item, dict):
            continue
        question = fb.clip(item.get("question"), 80)
        answer = fb.clip(item.get("answer"), 500)
        if not question or not answer:
            continue
        qid = fb.clip(item.get("qid"), 8) or f"Q{index + 1}"
        out.append({"qid": qid, "question": question, "answer": answer})
        if len(out) >= 3:
            break
    return out


def normalize_discussion(items) -> list[dict]:
    out: list[dict] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        title = fb.clip(item.get("title"), 40)
        body = fb.clip(item.get("body"), 420)
        if not title or not body:
            continue
        out.append({"title": title, "body": body})
        if len(out) >= 3:
            break
    return out


def normalize_highlights(items, evidence: list[dict]) -> list[dict]:
    by_id = {str(paper.get("id")): paper for paper in evidence}
    out: list[dict] = []
    used: set[str] = set()
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        paper_id = str(item.get("id") or "")
        paper = by_id.get(paper_id)
        if not paper or paper_id in used:
            continue
        used.add(paper_id)
        out.append(fb.attach_reason(paper, fb.clip(item.get("blurb") or item.get("reason"), 180)))
        if len(out) >= 8:
            break
    if len(out) < 4:
        for paper in evidence:
            paper_id = str(paper.get("id") or "")
            if not paper_id or paper_id in used:
                continue
            out.append(fb.attach_reason(paper, fb.lexical_reason(paper)))
            used.add(paper_id)
            if len(out) >= 6:
                break
    return out


def parse_brief(content: str, query: str, stats: dict, evidence: list[dict], mode: str, coverage: str) -> dict:
    data = fb.parse_model_object(content)
    fallback = lexical_brief(query, stats, mode, coverage)
    brief = {
        "kicker": fb.clip(data.get("kicker"), 40) or fallback["kicker"],
        "title": fb.clip(data.get("title"), 48) or fallback["title"],
        "hook": fb.clip(data.get("hook"), 32) or fallback["hook"],
        "subtitle": fb.clip(data.get("subtitle"), 80) or fallback["subtitle"],
        "lead": fb.clip(data.get("lead"), 500) or fallback["lead"],
        "findings": normalize_findings(data.get("findings")) or fallback["findings"],
        "method": fb.clip(data.get("method"), 500) or fallback["method"],
        "questions": normalize_questions(data.get("questions")) or fallback["questions"],
        "limitations": fb.clip(data.get("limitations"), 600) or fallback["limitations"],
        "discussion": normalize_discussion(data.get("discussion")) or fallback["discussion"],
    }
    return {
        "brief": brief,
        "papers": normalize_highlights(data.get("highlights") or data.get("papers"), evidence),
    }


def run_summary_brief(body: dict | None, root: Path, complete, has_api_key: bool = True) -> tuple[int, dict]:
    body = body if isinstance(body, dict) else {}
    impression = fb.clip(body.get("impression"), 4000)
    query = fb.clip(body.get("query") or body.get("topic") or body.get("q"), 120)
    if not query:
        query = fb.clip(impression, 120)
    mode = "landscape" if is_landscape_query(query) else "topic"
    if mode == "landscape" and not query:
        query = "四大顶会全景"
    if not query:
        return 400, {"error": "query required"}
    category = fb.clip(body.get("category"), 80)
    extra_categories = [category] if category in fb.CATEGORIES else []
    source = fb.clip(body.get("source"), 20) or "all"
    if source not in {"all", "top-conf", "arxiv"}:
        source = "all"
    try:
        arxiv_days = int(body.get("arxiv_days") if body.get("arxiv_days") is not None else fb.DEFAULT_ARXIV_DAYS)
    except (TypeError, ValueError):
        arxiv_days = fb.DEFAULT_ARXIV_DAYS
    arxiv_days = max(0, min(arxiv_days, 3650))
    conference = fb.clip(body.get("conference"), 20)
    conferences = [conference] if conference else []
    search_query = query
    extra = fb.clip(impression, 200)
    if mode == "topic" and extra and extra not in query:
        search_query = f"{query} {extra}".strip()
    items, meta = collect_items(
        root,
        search_query if mode == "topic" else query,
        mode=mode,
        extra_categories=extra_categories,
        conferences=conferences,
        source=source,
        arxiv_days=arxiv_days,
    )
    stats = compute_stats(items)
    evidence = pick_evidence(items, mode)
    coverage = fb.coverage_note({"arxiv_days": meta.get("arxiv_days") or arxiv_days}, root)
    payload = {
        "query": query,
        "mode": mode,
        "terms": meta.get("terms") or [],
        "categories": meta.get("categories") or extra_categories,
        "corpus_size": meta.get("corpus_size") or 0,
        "hit_count": meta.get("hit_count") or 0,
        "stats": stats,
        "brief": None,
        "papers": [],
        "source": "lexical",
        "coverage": coverage,
    }
    if not items:
        return 200, payload
    fallback_brief = lexical_brief(query, stats, mode, coverage)
    fallback_papers = [fb.attach_reason(paper, fb.lexical_reason(paper)) for paper in evidence]
    if has_api_key:
        content = ""
        try:
            system_prompt, user_prompt = build_prompts(query, stats, evidence, impression, coverage, mode)
            content = complete(system_prompt, user_prompt)
            parsed = parse_brief(content, query, stats, evidence, mode, coverage)
            payload.update(parsed)
            payload["source"] = "llm"
            return 200, payload
        except Exception as exc:
            fb.log_stderr(
                "summary-brief fallback %s: %s content=%s"
                % (type(exc).__name__, exc, str(content or "")[:400])
            )
            payload["brief"] = fallback_brief
            payload["papers"] = fallback_papers
            return 200, payload
    payload["brief"] = fallback_brief
    payload["papers"] = fallback_papers
    return 200, payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a FastNews summary briefing from local papers.")
    parser.add_argument("-q", "--query", default="", help="topic, or 四大顶会全景")
    parser.add_argument("--category", default="", help="restrict to FastNews category")
    parser.add_argument("--conference", default="", help="usenix, ieee-sp, ndss, ccs, arxiv")
    parser.add_argument("--source", choices=["all", "top-conf", "arxiv"], default="all")
    parser.add_argument("--arxiv-days", type=int, default=fb.DEFAULT_ARXIV_DAYS)
    parser.add_argument("--format", choices=["json", "text"], default="json")
    return parser.parse_args()


def main() -> int:
    fb.configure_stdout()
    args = parse_args()
    status, payload = run_summary_brief(
        {
            "query": args.query,
            "category": args.category,
            "conference": args.conference,
            "source": args.source,
            "arxiv_days": args.arxiv_days,
        },
        fb.find_root(),
        complete=lambda _system, _user: (_ for _ in ()).throw(RuntimeError("cli has no llm")),
        has_api_key=False,
    )
    if args.format == "text":
        brief = payload.get("brief") or {}
        stats = payload.get("stats") or {}
        print(f"query: {payload.get('query')}  mode: {payload.get('mode')}  source: {payload.get('source')}")
        print(f"sample: {stats.get('sample_size')} / corpus {payload.get('corpus_size')}")
        print(brief.get("title") or "")
        for finding in brief.get("findings") or []:
            print(f"- {finding.get('title')}: {finding.get('body')}")
        return 0 if status == 200 else 1
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if status == 200 else 1


if __name__ == "__main__":
    raise SystemExit(main())
