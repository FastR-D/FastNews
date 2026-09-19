import argparse
import json
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from bs4.element import NavigableString, Tag


USER_AGENT = (
    "Mozilla/5.0 (compatible; FastNewsBot/0.1; "
    "+https://github.com/FastR-D/FastNews)"
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
        return [
            f"https://sp{year}.ieee-security.org/accepted-papers.html",
            f"https://www.ieee-security.org/TC/SP{year}/program-papers.html",
            f"https://www.ieee-security.org/TC/SP{year}/accepted-papers.html",
        ]

    if conference == "ndss":
        return [
            f"https://www.ndss-symposium.org/ndss{year}/accepted-papers/",
            f"https://www.ndss-symposium.org/ndss-{year}/accepted-papers/",
        ]

    if conference == "ccs":
        return [
            f"https://www.sigsac.org/ccs/CCS{year}/program/accepted-papers.html",
            f"https://www.sigsac.org/ccs/CCS{year}/accepted-papers.html",
            f"https://www.sigsac.org/ccs/CCS{year}/program.html",
            f"https://www.sigsac.org/ccs/CCS{year}/index.html",
            f"https://www.sigsac.org/ccs/CCS{year}/",
        ]

    if conference != "usenix":
        raise ValueError(f"Unsupported conference: {conference}")

    suffix = str(year)[-2:]
    base = f"https://www.usenix.org/conference/usenixsecurity{suffix}"
    return [
        f"{base}/technical-sessions",
        f"{base}/accepted-papers",
        f"{base}/winter-accepted-papers",
        f"{base}/summer-accepted-papers",
        f"{base}/fall-accepted-papers",
        f"{base}/cycle1-accepted-papers",
        f"{base}/cycle2-accepted-papers",
        f"{base}/cycle3-accepted-papers",
    ]



def normalize_title(title):
    title = clean_text(title).replace("\xa0", " ").lower()
    title = re.sub(r"[^a-z0-9]+", " ", title)
    return re.sub(r"\s+", " ", title).strip()


def is_non_paper_title(title):
    title = clean_text(title)
    if not title or len(title) < 8:
        return True
    lowered = title.lower()
    skip_prefixes = (
        "demo:",
        "poster:",
        "keynote",
        "welcome",
        "proceedings of",
        "message from",
        "front matter",
        "table of contents",
        "organizing committee",
        "program committee",
        "accepted papers",
        "doctoral symposium",
        "artifact evaluation",
        "panel:",
        "copyright page",
        "copyright and reprint",
        "author index",
        "keyword index",
        "title page",
    )
    if any(lowered.startswith(prefix) for prefix in skip_prefixes):
        return True
    if "doctoral symposium" in lowered:
        return True
    if lowered in {
        "program",
        "travel",
        "venue",
        "registration",
        "overview",
        "index",
        "copyright page",
        "author index",
        "keyword index",
        "title page",
    }:
        return True
    return False


def paper_doi(paper):
    doi = clean_text(paper.get("doi") or "")
    if doi.lower().startswith("https://doi.org/"):
        doi = doi.split("doi.org/", 1)[1]
    if doi:
        return doi.strip().rstrip(").,")
    blob = " ".join(filter(None, [paper.get("link"), paper.get("_id")]))
    match = re.search(r"10\.\d{4,9}/[-._;()/:A-Z0-9]+", blob, re.I)
    return match.group(0).rstrip(").,") if match else ""


def make_paper(title, link, year, source, fetched_at, author="", description="", doi=""):
    doi = doi or paper_doi({"link": link, "doi": doi})
    return {
        "_id": link or title.lower(),
        "title": title,
        "link": link,
        "description": description,
        "published": f"{year}-01-01T00:00:00Z",
        "author": author,
        "source": source,
        "fetched_at": fetched_at,
        **({"doi": doi} if doi else {}),
    }


def merge_papers(base, extra):
    merged = list(base)
    by_title = {normalize_title(paper.get("title") or ""): paper for paper in merged if paper.get("title")}
    for paper in extra:
        key = normalize_title(paper.get("title") or "")
        if not key:
            continue
        existing = by_title.get(key)
        if not existing:
            merged.append(paper)
            by_title[key] = paper
            continue
        for field in ("description", "author", "link", "doi"):
            if not existing.get(field) and paper.get(field):
                existing[field] = paper[field]
    return merged


def reconstruct_openalex_abstract(inverted):
    if not inverted:
        return ""
    try:
        size = max(index for positions in inverted.values() for index in positions) + 1
    except ValueError:
        return ""
    words = [""] * size
    for word, positions in inverted.items():
        for index in positions:
            if 0 <= index < size:
                words[index] = word
    return clean_text(" ".join(words))


def crossref_container_titles(conference, year):
    if conference == "ccs":
        return [
            f"Proceedings of the {year} ACM SIGSAC Conference on Computer and Communications Security",
            f"Proceedings of the {year} on ACM SIGSAC Conference on Computer and Communications Security",
        ]
    if conference == "ieee-sp":
        return [
            f"{year} IEEE Symposium on Security and Privacy (SP)",
            f"{year} IEEE Symposium on Security and Privacy",
        ]
    return []


def fetch_crossref_container(container_title, year, session):
    client = session or requests
    source = f"{CONFERENCE_NAMES['ccs' if 'SIGSAC' in container_title else 'ieee-sp']} {year}"
    fetched_at = datetime.now(UTC).isoformat()
    headers = {"User-Agent": USER_AGENT + " (mailto:fastnews@local)"}
    papers = []
    seen = set()
    offset = 0
    page_size = 200
    while offset < 2000:
        params = {
            "filter": f"container-title:{container_title},type:proceedings-article",
            "rows": page_size,
            "offset": offset,
            "select": "title,author,DOI,URL,container-title,abstract,type",
        }
        response = client.get("https://api.crossref.org/works", params=params, headers=headers, timeout=45)
        response.raise_for_status()
        payload = response.json().get("message", {})
        items = payload.get("items") or []
        if not items:
            break
        for item in items:
            titles = item.get("title") or []
            if not titles:
                continue
            title = clean_text(re.sub(r"<[^>]+>", " ", titles[0]))
            if is_non_paper_title(title):
                continue
            doi = item.get("DOI") or ""
            link = f"https://doi.org/{doi}" if doi else (item.get("URL") or "")
            key = (doi or title).lower()
            if key in seen:
                continue
            seen.add(key)
            authors = []
            for author in item.get("author") or []:
                name = " ".join(part for part in [author.get("given"), author.get("family")] if part)
                if name:
                    authors.append(name)
            abstract = clean_text(re.sub(r"<[^>]+>", " ", item.get("abstract") or ""))
            papers.append(
                make_paper(
                    title=title,
                    link=link,
                    year=year,
                    source=source,
                    fetched_at=fetched_at,
                    author=", ".join(authors),
                    description=abstract,
                    doi=doi,
                )
            )
        offset += len(items)
        total = payload.get("total-results") or 0
        if offset >= total:
            break
    return papers


def fetch_crossref_papers(conference, year, session=None):
    papers = []
    seen = set()
    for container_title in crossref_container_titles(conference, year):
        print(f"Fetching {conference} {year} from Crossref ({container_title})")
        try:
            batch = fetch_crossref_container(container_title, year, session)
        except requests.RequestException as exc:
            print(f"  crossref skipped: {exc}")
            continue
        print(f"  parsed {len(batch)} papers")
        for paper in batch:
            key = normalize_title(paper.get("title") or "")
            if not key or key in seen:
                continue
            seen.add(key)
            papers.append(paper)
        if papers:
            break
    return papers


def enrich_from_openalex(papers, session):
    missing = [paper for paper in papers if not paper.get("description") and paper_doi(paper)]
    if not missing:
        return 0
    filled = 0
    headers = {"User-Agent": USER_AGENT + " (mailto:fastnews@local)"}
    for index in range(0, len(missing), 40):
        chunk = missing[index:index + 40]
        dois = [paper_doi(paper) for paper in chunk]
        try:
            response = session.get(
                "https://api.openalex.org/works",
                params={"filter": "doi:" + "|".join(dois), "per-page": 50},
                headers=headers,
                timeout=45,
            )
            response.raise_for_status()
            items = response.json().get("results") or []
        except requests.RequestException as exc:
            print(f"  openalex batch skipped: {exc}")
            continue
        by_doi = {}
        for item in items:
            doi = ((item.get("ids") or {}).get("doi") or "").replace("https://doi.org/", "")
            abstract = reconstruct_openalex_abstract(item.get("abstract_inverted_index"))
            if doi and abstract:
                by_doi[doi.lower()] = abstract
        for paper in chunk:
            abstract = by_doi.get(paper_doi(paper).lower())
            if abstract:
                paper["description"] = abstract
                filled += 1
    return filled


def enrich_from_semanticscholar(papers, session):
    missing = [paper for paper in papers if not paper.get("description") and paper_doi(paper)]
    if not missing:
        return 0
    filled = 0
    headers = {"User-Agent": USER_AGENT}
    for index in range(0, len(missing), 100):
        chunk = missing[index:index + 100]
        ids = [f"DOI:{paper_doi(paper)}" for paper in chunk]
        try:
            response = session.post(
                "https://api.semanticscholar.org/graph/v1/paper/batch",
                params={"fields": "title,abstract,externalIds"},
                json={"ids": ids},
                headers=headers,
                timeout=60,
            )
            if response.status_code == 429:
                print("  semanticscholar rate-limited, stopping title/DOI enrichment")
                break
            response.raise_for_status()
            items = response.json() or []
        except requests.RequestException as exc:
            print(f"  semanticscholar batch skipped: {exc}")
            continue
        by_doi = {}
        for item in items:
            if not item:
                continue
            doi = ((item.get("externalIds") or {}).get("DOI") or "")
            abstract = clean_text(item.get("abstract") or "")
            if doi and abstract:
                by_doi[doi.lower()] = abstract
        for paper in chunk:
            abstract = by_doi.get(paper_doi(paper).lower())
            if abstract:
                paper["description"] = abstract
                filled += 1
    return filled


def enrich_from_openalex_titles(papers, session, limit=400):
    missing = [paper for paper in papers if not paper.get("description") and paper.get("title")]
    if not missing:
        return 0
    filled = 0
    headers = {"User-Agent": USER_AGENT + " (mailto:fastnews@local)"}
    for paper in missing[:limit]:
        try:
            response = session.get(
                "https://api.openalex.org/works",
                params={
                    "filter": "title.search:" + paper["title"].replace(":", " "),
                    "per-page": 5,
                },
                headers=headers,
                timeout=45,
            )
            if response.status_code == 429:
                print("  openalex title rate-limited")
                break
            response.raise_for_status()
            items = response.json().get("results") or []
        except requests.RequestException as exc:
            print(f"  openalex title skipped: {exc}")
            continue
        target = normalize_title(paper["title"])
        for item in items:
            abstract = reconstruct_openalex_abstract(item.get("abstract_inverted_index"))
            matched = normalize_title(item.get("title") or "")
            if abstract and matched == target:
                paper["description"] = abstract
                filled += 1
                break
        time.sleep(0.1)
    return filled


def enrich_from_semanticscholar_titles(papers, session, limit=250):
    missing = [paper for paper in papers if not paper.get("description") and paper.get("title")]
    if not missing:
        return 0
    filled = 0
    headers = {"User-Agent": USER_AGENT}
    for paper in missing[:limit]:
        try:
            response = session.get(
                "https://api.semanticscholar.org/graph/v1/paper/search/match",
                params={"query": paper["title"], "fields": "title,abstract,year"},
                headers=headers,
                timeout=30,
            )
            if response.status_code in {404, 429}:
                if response.status_code == 429:
                    print("  semanticscholar title match rate-limited")
                    break
                continue
            response.raise_for_status()
            item = (response.json() or {}).get("data") or response.json()
            if isinstance(item, dict):
                abstract = clean_text(item.get("abstract") or "")
                matched = normalize_title(item.get("title") or "")
                if abstract and matched == normalize_title(paper["title"]):
                    paper["description"] = abstract
                    filled += 1
        except requests.RequestException:
            continue
    return filled


def enrich_abstracts(papers, session):
    before = sum(1 for paper in papers if paper.get("description"))
    openalex_filled = enrich_from_openalex(papers, session)
    s2_filled = enrich_from_semanticscholar(papers, session)
    title_filled = 0
    still_missing = sum(1 for paper in papers if not paper.get("description"))
    if still_missing:
        title_filled = enrich_from_openalex_titles(papers, session)
        still_missing = sum(1 for paper in papers if not paper.get("description"))
    if still_missing:
        title_filled += enrich_from_semanticscholar_titles(papers, session)
    after = sum(1 for paper in papers if paper.get("description"))
    print(
        f"  abstracts: {after}/{len(papers)} "
        f"(openalex +{openalex_filled}, s2 +{s2_filled}, title +{title_filled}, had {before})"
    )
    return papers


def fetch_html(url, session=None):
    client = session or requests
    response = client.get(url, headers={"User-Agent": USER_AGENT}, timeout=60)
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
    if not title or "accepted paper" in title.lower() or is_non_paper_title(title):
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

    for index, item in enumerate(soup.select(".list-group-item")):
        title_link = item.find("a", href=True)
        title_node = item.find(["b", "strong"])
        if title_link:
            title = clean_text(title_link.get_text(" ", strip=True))
            paper_link = urljoin(url, title_link["href"])
        elif title_node:
            title = clean_text(title_node.get_text(" ", strip=True))
            slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:80] or str(index)
            paper_link = f"{url}#{slug}"
        else:
            continue

        if not title or title.lower() in {"program", "accepted papers"} or is_non_paper_title(title):
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
        else:
            clone = BeautifulSoup(str(item), "html.parser")
            for tag in clone.find_all(["b", "strong", "a", "sup"]):
                tag.decompose()
            author = clean_text(clone.get_text(" ", strip=True))
        author = re.sub(r"\s+([,;])", r"\1", author)
        author = re.sub(r",\s*,", ",", author)
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

        last_error = None
        for attempt in range(3):
            try:
                detail_html = fetch_html(detail_link, session)
                if detail_html:
                    author, description, pdf_link = parse_ndss_detail(detail_html)
                last_error = None
                break
            except requests.RequestException as exc:
                last_error = exc
                time.sleep(1.5 * (attempt + 1))
        if last_error is not None:
            print(f"  detail skipped for {title[:60]}: {last_error}")

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


def parse_ccs_table_papers(soup, url, year):
    source = f"{CONFERENCE_NAMES['ccs']} {year}"
    fetched_at = datetime.now(UTC).isoformat()
    papers = []
    seen = set()
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        header_cells = rows[0].find_all(["th", "td"])
        header = [clean_text(cell.get_text(" ", strip=True)).lower() for cell in header_cells]
        start = 0
        title_idx, author_idx = 0, 1
        if header and "title" in header:
            title_idx = header.index("title")
            author_idx = header.index("author") if "author" in header else min(1, len(header) - 1)
            start = 1
        for row in rows[start:]:
            cells = row.find_all("td")
            if len(cells) <= max(title_idx, author_idx):
                continue
            title = clean_text(cells[title_idx].get_text(" ", strip=True))
            if not title or title.lower() in {"title", "author", "program", "accepted papers"} or is_non_paper_title(title):
                continue
            author = clean_text(cells[author_idx].get_text(", ", strip=True))
            title_link = cells[title_idx].find("a", href=True)
            if title_link:
                link = urljoin(url, title_link["href"])
            else:
                slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:80]
                link = f"{url}#{slug}"
            key = title.lower()
            if key in seen:
                continue
            seen.add(key)
            papers.append(
                {
                    "_id": link,
                    "title": title,
                    "link": link,
                    "description": "",
                    "published": f"{year}-01-01T00:00:00Z",
                    "author": author,
                    "source": source,
                    "fetched_at": fetched_at,
                }
            )
    return papers


def parse_ccs_papers(html, url, year):
    soup = BeautifulSoup(html, "html.parser")
    return parse_ccs_table_papers(soup, url, year)
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
        if not title or title.lower() in {"program", "accepted papers"} or is_non_paper_title(title):
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


def fetch_papers(conference, year, urls=None, enrich=True):
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
                if is_non_paper_title(paper.get("title") or ""):
                    continue
                title_key = normalize_title(paper.get("title") or "")
                key = paper.get("_id") or title_key
                if key in seen or (title_key and title_key in seen):
                    continue
                seen.add(key)
                if title_key:
                    seen.add(title_key)
                all_papers.append(paper)
            if conference == "ieee-sp" and len(all_papers) >= 80:
                break

        if conference in {"ccs", "ieee-sp"}:
            xref = fetch_crossref_papers(conference, year, session)
            all_papers = merge_papers(all_papers, xref)

        if enrich:
            enrich_abstracts(all_papers, session)

    return [paper for paper in all_papers if not is_non_paper_title(paper.get("title") or "")]


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
    parser.add_argument(
        "--no-enrich",
        action="store_true",
        help="Skip OpenAlex/Semantic Scholar abstract enrichment.",
    )
    args = parser.parse_args()

    try:
        papers = fetch_papers(args.conference, args.year, args.urls, enrich=not args.no_enrich)
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
