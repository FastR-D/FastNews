#!/usr/bin/env python3
"""Fetch distinguished-paper awards and resolve titles against local JSONL."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup
from bs4.element import NavigableString, Tag

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import paper_metrics

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None

USER_AGENT = (
    "Mozilla/5.0 (compatible; FastNewsBot/0.1; "
    "+https://github.com/FastR-D/FastNews)"
)
AUTHOR_RE = re.compile(r"^\s*(authors?|by)\s*[:：]", re.I)
HEADING_NAMES = {"h1", "h2", "h3", "h4"}
SEED_NEEDLES = {
    ("ieee-sp", 2025): [
        "COBBL",
        "Transport Layer Obscurity",
        "Follow My Flow",
        "CipherSteal",
        "Characterizing Robocalls",
        "Verifiable Boosted Tree Ensembles",
        "Breaking the Barrier",
        "Unveiling Security Vulnerabilities in Git Large File Storage Protocol",
        "The Inadequacy of Similarity-based Privacy Metrics",
        "Empc",
        "SLAP",
        "Detecting Taint-Style Vulnerabilities in Microservice-Structured Web Applications",
        "DataSentinel",
    ],
    ("ieee-sp", 2024): [
        "BENZENE",
        "Shedding Light on CVSS",
        "False negative - that one is going to kill you",
        "The Great Request Robbery",
        "SoK: Prudent Evaluation Practices for Fuzzing",
        "SoK: Unintended Interactions among Machine Learning Defenses and Risks",
        "From Virtual Touch to Tesla Command",
        "From Chatbots to Phishbots",
        "WESEE",
    ],
    ("ieee-sp", 2023): [
        "MEGA",
        "Practically-exploitable Cryptographic Vulnerabilities in Matrix",
        "Weak Fiat-Shamir",
        "Typing High-Speed Cryptography against Spectre v1",
        "Red Team vs. Blue Team",
        "It's (DOM) Clobbering Time",
        "The Leaky Web",
        "WaVe",
        "Characterizing Everyday Misuse of Smart Home Devices",
        "Not Yet Another Digital ID",
        "In Eighty Percent of the Cases, I Select the Password for Them",
        "Space Odyssey",
    ],
    ("ccs", 2024): [
        "Better Be Computer or I'm Dumb",
        "Organic or Diffused",
        "Unmasking the Security and Usability of Password Masking",
        "Content, Nudges and Incentives",
        "QueryCheetah",
        "Cross-silo Federated Learning with Record-level Personalized Differential Privacy",
        "Lutris: A Blockchain Combining Broadcast and Consensus",
        "Atomic and Fair Data Exchange via Blockchain",
        "DoubleUp Roll",
        "ERACAN",
        "Spec-o-Scope",
        "Principled Microarchitectural Isolation on Cloud CPUs",
        "RefleXnoop",
        "Libra: Architectural Support",
        "Testing Side-channel Security of Cryptographic Implementations Against Future Microarchitectures",
        "Isolate and Detect the Untrusted Driver with a Virtual Box",
        "ReSym",
        "Manipulative Interference Attacks",
        "uMMU",
        "Jager: Automated Telephone Call Traceback",
        "The Harder You Try, The Harder You Fail",
        "FuzzCache",
        "Stealing Trust: Unraveling Blind Message Attacks in Web3 Authentication",
        "Practical Key Extraction Attacks in Leading MPC Wallets",
        "Fast Two-party Threshold ECDSA with Proactive Security",
        "Distributed Backdoor Attacks on Federated Graph Learning and Certified Defenses",
        "Moderator: Moderating Text-to-Image Diffusion Models",
    ],
    ("ccs", 2023): [
        "Alert Alchemy",
        "Amplification by Shuffling without Shuffling",
        "Batchman and Robin",
        "Capacity",
        "CoCo",
        "Concurrent Composition",
        "FutORAMa",
        "HE3DB",
        "How Hard is Takeover in DPoS Blockchains?",
        "Large Language Models for Code",
        "PANIC",
        "Security Verification of Low-Trust Architectures",
        "Silence is not Golden",
        "Specification and Verification of Side-channel Security",
        "SpecVerilog",
        "Stealing the Decoding Algorithms of Language Models",
        "Uncle Maker",
    ],
    ("ndss", 2024): [
        "Like, Comment, Get Scammed",
        "UntrustIDE",
        "Eavesdropping on Controller Acoustic Emanation",
        "LMSanitator",
    ],
    ("ndss", 2025): [
        "ReThink",
        "Fingerprint API Misuse",
        "SafeSplit",
        "Provably Unlearnable Data Examples",
        "DUMPLING",
        "type++",
        "Rethinking Trust in Forge-Based Git Security",
        "Blindfold",
        "PropertyGPT",
        "DiStefano",
        "ReDAN",
        "VoiceRadar",
    ],
    ("usenix", 2025): [
        "Branch Privilege Injection",
        "Characterizing and Detecting Propaganda-Spreading Accounts on Telegram",
        "Confusing Value with Enumeration",
        "Catch-22",
        "How Transparent is Usable Privacy and Security Research?",
        "We Have a Package for You!",
        "The DOMino Effect",
        "My ZIP isn't your ZIP",
    ],
    ("usenix", 2024): [
        "DVSorder",
        "Dancer in the Dark",
        "Digital Discrimination of Users in Sanctioned States",
        "Don't Listen To Me",
        "InSpectre Gadget",
        "Yes, One-Bit-Flip Matters",
        "HYPERPILL",
        "Indirector",
        "Data Coverage for Guided Fuzzing",
    ],
}


def clean_title(value: object) -> str:
    text = paper_metrics.clean_text(value)
    text = paper_metrics.PAPER_NUM_RE.sub(" ", text)
    return text.strip(" \t\"“”'")


def is_author_line(text: str) -> bool:
    lowered = text.lower()
    if AUTHOR_RE.match(text) or lowered.startswith("authors"):
        return True
    if re.fullmatch(r"[A-Z][a-z]+(?: [A-Z][a-z]+){0,3}", text) and len(text) < 40:
        return True
    return False


def heading_rank(name: str) -> int:
    return {"h1": 1, "h2": 2, "h3": 3, "h4": 4}.get(name, 9)


def first_title_from_li(li: Tag) -> str:
    text = li.get_text(" ", strip=True)
    text = re.split(r"\s+Authors?\s*:", text, maxsplit=1, flags=re.I)[0]
    text = clean_title(text)
    if not text or is_author_line(text) or len(text) < 8:
        return ""
    if paper_metrics.canonical_award(text) and len(text) < 48:
        return ""
    return text


def collect_titles_after(heading: Tag) -> list[str]:
    titles: list[str] = []
    for sib in heading.next_siblings:
        if isinstance(sib, NavigableString):
            continue
        if not isinstance(sib, Tag):
            continue
        if sib.name in HEADING_NAMES:
            break
        items = sib.find_all("li") if sib.name != "li" else [sib]
        if sib.name in {"ul", "ol"} or (sib.name == "li"):
            for li in items:
                title = first_title_from_li(li)
                if title:
                    titles.append(title)
            continue
        bolds = sib.find_all(["b", "strong"]) if sib.name not in {"b", "strong"} else [sib]
        if bolds and sib.name in {"p", "div", "li", "td"}:
            title = clean_title(bolds[0].get_text(" ", strip=True))
            if title and len(title) >= 8 and not paper_metrics.canonical_award(title):
                titles.append(title)
            continue
        if sib.name in {"p", "div"}:
            title = clean_title(sib.get_text(" ", strip=True).split("\n")[0])
            title = re.split(r"\s+Authors?\s*:", title, maxsplit=1, flags=re.I)[0]
            if title and not is_author_line(title) and len(title) >= 8 and not paper_metrics.canonical_award(title):
                titles.append(title)
    return titles


def parse_heading_awards(html: str, conference: str, year: int) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    papers: list[dict] = []
    seen: set[str] = set()
    for heading in soup.find_all(HEADING_NAMES):
        award = paper_metrics.canonical_award(heading.get_text(" ", strip=True))
        if not award:
            continue
        for title in collect_titles_after(heading):
            key = paper_metrics.normalize_title(title)
            if not key or key in seen:
                continue
            seen.add(key)
            papers.append({
                "conference": conference,
                "year": int(year),
                "title": title,
                "award": award,
            })
    return papers


def parse_usenix_award_rows(html: str, conference: str, year: int) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    papers: list[dict] = []
    seen: set[str] = set()
    for heading in soup.find_all(["h2", "h3", "h4"]):
        title = clean_title(heading.get_text(" ", strip=True))
        if len(title) < 8:
            continue
        blob_parts = [title]
        for sib in heading.next_siblings:
            if isinstance(sib, Tag) and sib.name in HEADING_NAMES:
                break
            blob_parts.append(sib.get_text(" ", strip=True) if isinstance(sib, Tag) else str(sib))
        if not paper_metrics.detect_award_text(" ".join(blob_parts)):
            continue
        key = paper_metrics.normalize_title(title)
        if not key or key in seen:
            continue
        seen.add(key)
        papers.append({
            "conference": conference,
            "year": int(year),
            "title": title,
            "award": paper_metrics.DISTINGUISHED_AWARD,
        })
    return papers


def parse_award_html(html: str, conference: str, year: int) -> list[dict]:
    papers = parse_heading_awards(html, conference, year)
    if conference == "usenix":
        extra = parse_usenix_award_rows(html, conference, year)
        seen = {paper_metrics.normalize_title(item["title"]) for item in papers}
        for item in extra:
            key = paper_metrics.normalize_title(item["title"])
            if key not in seen:
                papers.append(item)
                seen.add(key)
    return papers


def load_conference_titles(root: Path, conference: str, year: int) -> list[str]:
    path = Path(root) / "top-conf" / "data" / "conferences" / f"{conference}_{year}.jsonl"
    if not path.is_file():
        return []
    titles = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        title = row.get("title") if isinstance(row, dict) else None
        if title:
            titles.append(str(title))
    return titles


def is_prefix_title(key: str, title: str) -> bool:
    other = paper_metrics.normalize_title(title)
    if other == key:
        return True
    return other.startswith(key) and len(other) > len(key) and other[len(key)] == " "


def best_title_match(needle: str, titles: list[str]) -> str | None:
    key = paper_metrics.normalize_title(needle)
    if not key:
        return None
    exact = [title for title in titles if paper_metrics.normalize_title(title) == key]
    if exact:
        return min(exact, key=len)
    prefixes = [title for title in titles if is_prefix_title(key, title)]
    unique_prefix_keys = {paper_metrics.normalize_title(title) for title in prefixes}
    if len(unique_prefix_keys) == 1:
        return min(prefixes, key=len)
    if prefixes:
        return min(
            prefixes,
            key=lambda title: (abs(len(paper_metrics.normalize_title(title)) - len(key)), len(title)),
        )
    hits = []
    for title in titles:
        other = paper_metrics.normalize_title(title)
        if key in other or other in key:
            hits.append(title)
    if not hits:
        return None
    unique_keys = {paper_metrics.normalize_title(title) for title in hits}
    if len(unique_keys) == 1:
        return min(hits, key=len)
    if len(key) <= 8:
        return None
    scored = sorted(
        hits,
        key=lambda title: (
            0 if paper_metrics.normalize_title(title).startswith(key) else 1,
            abs(len(paper_metrics.normalize_title(title)) - len(key)),
            len(title),
        ),
    )
    return scored[0]


def resolve_seed_papers(root: Path) -> list[dict]:
    papers = []
    seen: set[tuple[str, int, str]] = set()
    for (conference, year), needles in SEED_NEEDLES.items():
        titles = load_conference_titles(root, conference, year)
        for needle in needles:
            matched = best_title_match(needle, titles) or needle
            key = paper_metrics.award_index_key(conference, year, matched)
            if not key or key in seen:
                continue
            seen.add(key)
            papers.append({
                "conference": conference,
                "year": year,
                "title": matched,
                "award": paper_metrics.DISTINGUISHED_AWARD,
            })
    return papers


def award_urls(conference: str, year: int) -> list[str]:
    if conference == "ieee-sp":
        return [
            f"https://www.ieee-security.org/TC/SP{year}/awards.html",
            f"https://sp{year}.ieee-security.org/awards.html",
        ]
    if conference == "ccs":
        return [
            f"https://www.sigsac.org/ccs/CCS{year}/program/awards.html",
            "https://www.sigsac.org/ccs/CCS_awards/ccs-bestpaper.html",
        ]
    if conference == "ndss":
        return [
            f"https://www.ndss-symposium.org/ndss{year}/accepted-papers/",
            f"https://www.ndss-symposium.org/ndss{year}/awards/",
        ]
    if conference == "usenix":
        yy = str(year)[2:]
        return [
            f"https://www.usenix.org/conference/usenixsecurity{yy}/technical-sessions",
            f"https://www.usenix.org/conference/usenixsecurity{yy}/accepted-papers",
        ]
    return []


def merge_award_papers(base: list[dict], extra: list[dict]) -> list[dict]:
    merged = list(base)
    seen = {
        paper_metrics.award_index_key(item.get("conference"), item.get("year"), item.get("title"))
        for item in merged
    }
    seen.discard(None)
    for item in extra:
        key = paper_metrics.award_index_key(item.get("conference"), item.get("year"), item.get("title"))
        if not key or key in seen:
            continue
        if not paper_metrics.canonical_award(item.get("award") or paper_metrics.DISTINGUISHED_AWARD):
            continue
        merged.append({
            "conference": key[0],
            "year": key[1],
            "title": item.get("title"),
            "award": paper_metrics.DISTINGUISHED_AWARD,
        })
        seen.add(key)
    return merged


def fetch_html(url: str, session=None) -> str | None:
    if requests is None:
        return None
    client = session or requests
    try:
        response = client.get(url, headers={"User-Agent": USER_AGENT}, timeout=45)
    except requests.RequestException:
        return None
    if response.status_code == 404:
        return None
    if response.status_code >= 400:
        return None
    try:
        return response.content.decode("utf-8")
    except UnicodeDecodeError:
        return response.text


def fetch_remote_awards(conference: str, year: int, session=None) -> list[dict]:
    papers: list[dict] = []
    for url in award_urls(conference, year):
        html = fetch_html(url, session)
        if not html:
            continue
        papers = merge_award_papers(papers, parse_award_html(html, conference, year))
    return papers


def write_awards_json(path: Path, papers: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "papers": [
            {
                "conference": item["conference"],
                "year": int(item["year"]),
                "title": item["title"],
                "award": paper_metrics.DISTINGUISHED_AWARD,
            }
            for item in papers
        ]
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build top-conf/data/awards.json")
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--no-fetch", action="store_true", help="Only resolve local seed titles")
    args = parser.parse_args(argv)
    root = args.root.resolve()
    papers = resolve_seed_papers(root)
    if not args.no_fetch:
        years = sorted({year for (_conf, year) in SEED_NEEDLES})
        conferences = sorted({conf for (conf, _year) in SEED_NEEDLES})
        session = requests.Session() if requests is not None else None
        for conference in conferences:
            for year in years:
                papers = merge_award_papers(papers, fetch_remote_awards(conference, year, session))
    out = root / "top-conf" / "data" / "awards.json"
    write_awards_json(out, papers)
    print(f"Saved {len(papers)} distinguished papers to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
