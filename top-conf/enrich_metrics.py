#!/usr/bin/env python3
"""Backfill distinguished-paper awards and OpenAlex citation counts onto JSONL."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

import paper_metrics
import fetch_big4

CONFERENCE_FILE_RE = re.compile(r"^(?P<conference>usenix|ieee-sp|ndss|ccs)_(?P<year>\d{4})$")


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    if not path.is_file():
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


def overlay_awards(papers: list[dict], awards: dict, conference: str, year: int) -> int:
    filled = 0
    for paper in papers:
        metrics = paper_metrics.public_metrics(
            paper,
            awards,
            conference=conference,
            year=year,
            title=paper.get("title"),
        )
        if metrics.get("award") and paper.get("award") != metrics["award"]:
            paper["award"] = metrics["award"]
            filled += 1
        elif metrics.get("award"):
            paper["award"] = metrics["award"]
    return filled


def enrich_path(path: Path, awards: dict, session=None, fetch_citations: bool = True) -> tuple[int, int]:
    match = CONFERENCE_FILE_RE.match(path.stem)
    if not match:
        return 0, 0
    conference = match.group("conference")
    year = int(match.group("year"))
    papers = load_jsonl(path)
    award_filled = overlay_awards(papers, awards, conference, year)
    cited_filled = 0
    if fetch_citations and session is not None:
        cited_filled = fetch_big4.enrich_citations_from_openalex(papers, session)
        cited_filled += fetch_big4.enrich_citations_by_title(papers, session)
    fetch_big4.write_jsonl(path, papers)
    return award_filled, cited_filled


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill award labels and citation counts")
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--no-network", action="store_true")
    parser.add_argument("--conference")
    parser.add_argument("--year", type=int)
    args = parser.parse_args(argv)
    root = args.root.resolve()
    awards = paper_metrics.load_award_index(root)
    source_root = root / "top-conf" / "data" / "conferences"
    paths = sorted(source_root.glob("*.jsonl"))
    if args.conference:
        paths = [path for path in paths if path.stem.startswith(args.conference + "_")]
    if args.year:
        paths = [path for path in paths if path.stem.endswith("_" + str(args.year))]
    session = None
    if not args.no_network:
        import requests
        session = requests.Session()
    total_awards = 0
    total_cited = 0
    for path in paths:
        award_filled, cited_filled = enrich_path(path, awards, session, fetch_citations=not args.no_network)
        total_awards += award_filled
        total_cited += cited_filled
        print(f"{path.name}: awards +{award_filled}, citations +{cited_filled}")
    print(f"Done. awards +{total_awards}, citations +{total_cited}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
