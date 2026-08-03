import argparse
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from bs4.element import NavigableString, Tag


USER_AGENT = (
    "Mozilla/5.0 (compatible; FastNewsBot/0.1; "
    "+https://github.com/fripSide/SecurityNews)"
)

CONFERENCE_NAMES = {
    "usenix": "USENIX Security",
    "ieee-sp": "IEEE S&P",
    "ndss": "NDSS",
    "ccs": "ACM CCS",
}

SKIP_TEXT_PREFIXES = (
    "available media",
    "presentation video",
    "presentation audio",
    "presentation slides",
    "paper pdf",
    "view the slides",
    "view the paper",
    "download the paper",
    "open access media",
    "proceedings",
)


def clean_text(value):
    value = re.sub(r"\s+", " ", value or "")
    return value.strip()


def default_urls(conference, year):
    if conference == "ieee-sp":
        return [f"https://sp{year}.ieee-security.org/accepted-papers.html"]

    if conference == "ndss":
        return [f"https://www.ndss-symposium.org/ndss{year}/accepted-papers/"]

    if conference == "ccs":
        return [
            f"https://www.sigsac.org/ccs/CCS{year}/accepted-papers.html",
            f"https://www.sigsac.org/ccs/CCS{year}/program/accepted-papers.html",
            f"https://www.sigsac.org/ccs/CCS{year}/",
        ]

    if conference != "usenix":
        raise ValueError(f"Unsupported conference: {conference}")

    suffix = str(year)[-2:]
    base = f"https://www.usenix.org/conference/usenixsecurity{suffix}"
    if year >= 2026:
        return [
            f"{base}/accepted-papers",
            f"{base}/cycle1-accepted-papers",
            f"{base}/cycle2-accepted-papers",
        ]
    return [f"{base}/accepted-papers"]


def fetch_html(url, session=None):
    client = session or requests
    response = client.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    try:
        return response.content.decode("utf-8")
    except UnicodeDecodeError:
        return response.text


def meaningful(text):
    if not text:
        return False
    lowered = text.lower()
    return not any(lowered.startswith(prefix) for prefix in SKIP_TEXT_PREFIXES)


def field_text(container, selectors):
    for selector in selectors:
        node = container.select_one(selector)
        if node:
            text = clean_text(node.get_text(" ", strip=True))
            if text:
                return text
    return ""


def field_link(container, base_url):
    title_node = container.find(["h2", "h3", "h4"])
    if title_node:
        link = title_node.find("a", href=True)
        if link:
            return urljoin(base_url, link["href"])

    link = container.find("a", href=re.compile(r"/presentation/"))
    if link:
        return urljoin(base_url, link["href"])
    return base_url


def infer_from_chunks(chunks):
    chunks = [chunk for chunk in chunks if meaningful(chunk)]
    if not chunks:
        return "", ""

    author = chunks[0]
    abstract_parts = chunks[1:]

    for index, chunk in enumerate(chunks):
        if len(chunk) >= 220 or chunk.lower().startswith(
            ("abstract:", "this paper", "we ", "in this paper")
        ):
            author = " ".join(chunks[:index]) or chunks[0]
            abstract_parts = chunks[index:]
            break

    description = " ".join(abstract_parts)
    description = re.sub(r"^abstract:\s*", "", description, flags=re.IGNORECASE)
    return clean_text(author), clean_text(description)


def append_html(wrapper, html):
    fragment = BeautifulSoup(html, "html.parser")
    for child in list(fragment.contents):
        wrapper.append(child)


def parse_row(row, base_url, source, year, fetched_at):
    title_node = row.find(["h2", "h3", "h4"])
    if not title_node:
        return None

    title = clean_text(title_node.get_text(" ", strip=True))
    if not title or "accepted paper" in title.lower():
        return None

    link = field_link(row, base_url)
    author = field_text(
        row,
        [
            ".field-name-field-paper-people-text",
            ".field--name-field-paper-people-text",
            ".field-name-field-paper-authors",
            ".field--name-field-paper-authors",
            ".field-name-field-people-text",
            ".field--name-field-people-text",
        ],
    )
    description = field_text(
        row,
        [
            ".field-name-field-paper-description",
            ".field--name-field-paper-description",
            ".field-name-body",
            ".field--name-body",
            ".field-name-field-abstract",
            ".field--name-field-abstract",
        ],
    )

    if not author or not description:
        chunks = []
        for node in row.find_all(["p", "li"], recursive=True):
            if title_node in node.parents:
                continue
            text = clean_text(node.get_text(" ", strip=True))
            if text and text != title and text not in chunks:
                chunks.append(text)

        inferred_author, inferred_description = infer_from_chunks(chunks)
        author = author or inferred_author
        description = description or inferred_description

    return {
        "_id": link,
        "title": title,
        "link": link,
        "description": description,
        "published": f"{year}-01-01T00:00:00Z",
        "author": author,
        "source": source,
        "fetched_at": fetched_at,
    }


def row_candidates(soup):
    selectors = [
        ".view-content .views-row",
        ".views-row",
        "article.node-paper",
        "article",
        ".node-paper",
    ]
    for selector in selectors:
        rows = soup.select(selector)
        if rows:
            return rows
    return []


def heading_blocks(soup):
    main = soup.select_one("main") or soup.select_one("#content") or soup.body or soup
    headings = main.find_all(["h2", "h3"])
    blocks = []
    for heading in headings:
        title = clean_text(heading.get_text(" ", strip=True))
        if not title or "accepted paper" in title.lower():
            continue

        wrapper = BeautifulSoup("<div></div>", "html.parser").div
        append_html(wrapper, str(heading))
        for sibling in heading.next_siblings:
            if isinstance(sibling, NavigableString):
                text = clean_text(str(sibling))
                if text:
                    wrapper.append(text)
                continue
            if isinstance(sibling, Tag) and sibling.name in {"h2", "h3"}:
                break
            if isinstance(sibling, Tag):
                append_html(wrapper, str(sibling))
        blocks.append(wrapper)
    return blocks


def parse_ieee_sp_papers(html, url, year):
    soup = BeautifulSoup(html, "html.parser")
    source = f"{CONFERENCE_NAMES['ieee-sp']} {year}"
    fetched_at = datetime.now(UTC).isoformat()
    papers = []

    for item in soup.select(".list-group-item"):
        title_link = item.find("a", href=True)
        if not title_link:
            continue

        title = clean_text(title_link.get_text(" ", strip=True))
        if not title or title.lower() in {"program", "accepted papers"}:
            continue

        author_node = item.select_one(".authorlist")
        author = ""
        if author_node:
            author_soup = BeautifulSoup(str(author_node), "html.parser")
            author_node = author_soup.select_one(".authorlist") or author_soup
            for sup in author_node.find_all("sup"):
                sup.decompose()

            author_nodes = []
            for child in author_node.contents:
                if isinstance(child, Tag) and child.name == "br":
                    break
                author_nodes.append(str(child))
            author = clean_text(
                BeautifulSoup("".join(author_nodes), "html.parser").get_text(" ", strip=True)
            )
            author = re.sub(r"\s+([,;])", r"\1", author)
            author = re.sub(r",\s*,", ",", author)

        paper_link = urljoin(url, title_link["href"])
        papers.append(
            {
                "_id": paper_link,
                "title": title,
                "link": paper_link,
                "description": "",
                "published": f"{year}-01-01T00:00:00Z",
                "author": author,
                "source": source,
                "fetched_at": fetched_at,
            }
        )

    return papers


def parse_ndss_detail(html):
    soup = BeautifulSoup(html, "html.parser")
    paper_data = soup.select_one(".paper-data") or soup.select_one(".entry-content")
    if not paper_data:
        return "", "", ""

    paragraphs = paper_data.find_all("p", recursive=False)
    author = clean_text(paragraphs[0].get_text(" ", strip=True)) if paragraphs else ""
    description = clean_text(paragraphs[1].get_text(" ", strip=True)) if len(paragraphs) > 1 else ""
    description = re.sub(r"\\?textbf\{([^{}]*)\}", r"\1", description)

    pdf_link = ""
    pdf_button = soup.select_one("a.pdf-button[href], a[href$='.pdf']")
    if pdf_button:
        pdf_link = pdf_button.get("href", "")
    return author, description, pdf_link


def parse_ndss_papers(html, url, year, session):
    soup = BeautifulSoup(html, "html.parser")
    source = f"{CONFERENCE_NAMES['ndss']} {year}"
    fetched_at = datetime.now(UTC).isoformat()
    papers = []

    for item in soup.select(".pt-cv-content-item"):
        title_link = item.select_one("h2.pt-cv-title a[href]")
        if not title_link:
            continue

        title = clean_text(title_link.get_text(" ", strip=True))
        detail_link = urljoin(url, title_link["href"])
        list_author = field_text(
            item,
            [
                ".pt-cv-ctf-display_authors .pt-cv-ctf-value",
                ".pt-cv-custom-fields .pt-cv-ctf-value",
            ],
        )
        author = list_author
        description = ""
        pdf_link = ""

        try:
            detail_html = fetch_html(detail_link, session)
            if detail_html:
                author, description, pdf_link = parse_ndss_detail(detail_html)
        except requests.RequestException as exc:
            print(f"  detail skipped for {title[:60]}: {exc}")

        record = {
            "_id": detail_link,
            "title": title,
            "link": detail_link,
            "description": description,
            "published": f"{year}-01-01T00:00:00Z",
            "author": author or list_author,
            "source": source,
            "fetched_at": fetched_at,
        }
        if pdf_link:
            record["pdf_link"] = urljoin(detail_link, pdf_link)
        papers.append(record)

    return papers


def parse_ccs_papers(html, url, year):
    soup = BeautifulSoup(html, "html.parser")
    source = f"{CONFERENCE_NAMES['ccs']} {year}"
    fetched_at = datetime.now(UTC).isoformat()
    rows = []

    for selector in [".paper-item", ".paper", ".list-group-item", "article"]:
        rows = soup.select(selector)
        if rows:
            break

    if not rows:
        rows = [
            heading.parent
            for heading in soup.find_all(["h2", "h3", "h4"])
            if heading.find("a", href=True)
        ]

    papers = []
    seen = set()
    for row in rows:
        title_node = row.find(["h2", "h3", "h4"])
        title_link = title_node.find("a", href=True) if title_node else row.find("a", href=True)
        if not title_link:
            continue

        title = clean_text(title_link.get_text(" ", strip=True))
        if not title or title.lower() in {"program", "accepted papers"}:
            continue

        link = urljoin(url, title_link["href"])
        if link in seen:
            continue
        seen.add(link)

        author = field_text(
            row,
            [
                ".authors",
                ".author",
                ".paper-authors",
                ".paper__authors",
                "[class*='author']",
            ],
        )
        description = field_text(
            row,
            [
                ".abstract",
                ".paper-abstract",
                ".paper__abstract",
                "[class*='abstract']",
            ],
        )
        papers.append(
            {
                "_id": link,
                "title": title,
                "link": link,
                "description": description,
                "published": f"{year}-01-01T00:00:00Z",
                "author": author,
                "source": source,
                "fetched_at": fetched_at,
            }
        )

    return papers


def parse_papers(html, url, conference, year, session=None):
    if conference == "ieee-sp":
        return parse_ieee_sp_papers(html, url, year)
    if conference == "ndss":
        return parse_ndss_papers(html, url, year, session)
    if conference == "ccs":
        return parse_ccs_papers(html, url, year)

    soup = BeautifulSoup(html, "html.parser")
    source = f"{CONFERENCE_NAMES[conference]} {year}"
    fetched_at = datetime.now(UTC).isoformat()

    rows = row_candidates(soup) or heading_blocks(soup)
    papers = []
    seen = set()
    for row in rows:
        paper = parse_row(row, url, source, year, fetched_at)
        if not paper:
            continue

        key = paper["_id"] if paper["_id"] != url else paper["title"].lower()
        if key in seen:
            continue
        seen.add(key)
        papers.append(paper)
    return papers


def write_jsonl(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        for record in records:
            file.write(json.dumps(record, ensure_ascii=False) + "\n")


def fetch_papers(conference, year, urls=None):
    urls = urls or default_urls(conference, year)
    all_papers = []
    seen = set()

    with requests.Session() as session:
        for url in urls:
            print(f"Fetching {url}")
            html = fetch_html(url, session)
            if html is None:
                print("  skipped: 404")
                continue

            papers = parse_papers(html, url, conference, year, session)
            print(f"  parsed {len(papers)} papers")
            for paper in papers:
                key = paper["_id"] if paper["_id"] != url else paper["title"].lower()
                if key in seen:
                    continue
                seen.add(key)
                all_papers.append(paper)

    return all_papers


def main():
    parser = argparse.ArgumentParser(description="Fetch Big 4 security conference papers")
    parser.add_argument("conference", choices=sorted(CONFERENCE_NAMES), help="Conference name")
    parser.add_argument("year", type=int, help="Conference year")
    parser.add_argument(
        "--url",
        action="append",
        dest="urls",
        help="Accepted-papers page URL. Can be passed multiple times.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Output JSONL path. Defaults to top-conf/data/conferences/<conference>_<year>.jsonl",
    )
    args = parser.parse_args()

    try:
        papers = fetch_papers(args.conference, args.year, args.urls)
    except requests.RequestException as exc:
        print(f"Error: failed to fetch papers: {exc}", file=sys.stderr)
        sys.exit(1)

    if not papers:
        print("Error: no papers were parsed from the configured pages.", file=sys.stderr)
        sys.exit(1)

    out_file = args.output or Path(f"top-conf/data/conferences/{args.conference}_{args.year}.jsonl")
    write_jsonl(out_file, papers)
    print(f"Saved {len(papers)} papers to {out_file}")


if __name__ == "__main__":
    main()
