---
name: conference-ingestion
description: "Collect, classify and render a requested conference/year in FastNews, or extend its conference source registry. Use for conference ingestion and domain coverage, including software engineering and Coding Agents; use field-briefing for literature search alone."
---

# Conference ingestion

Use the production Go pipeline and the source registry in `internal/catalog/catalog.go`.

## Existing sources

- Security: `usenix`, `ieee-sp`, `ndss`, `ccs` use official conference pages.
- ICLR uses OpenReview API v2 and the exact accepted conference venue for the requested year.
- ICML uses the official PMLR volume index plus the same volume's RSS abstracts. NeurIPS uses the official proceedings' `conference` track, excluding other tracks and leaving unavailable abstracts unknown. Official profiles cover the checked 2022–2025 volumes; choose the year explicitly. Unsupported years fail without switching providers.
- Software engineering: `icse`, `ase` use DBLP conference/workshop bibliography records for the requested stream/year. Preserve the actual venue; these records do not establish main-track-only coverage or provide paper abstracts.

For a requested conference/year, run the stages the user requested:

```bash
go run ./cmd/fastnews fetch-conf --conference <id> --year <year>
# NeurIPS: enrich a bounded batch before summarizing; --all processes every missing abstract.
go run ./cmd/fastnews enrich-abstracts --conference neurips --year <year> --limit 12
go run ./cmd/fastnews summarize-conf --conference <id> --year <year>
go run ./cmd/fastnews conference-report --conference <id> --year <year>
```

Fetching writes the local corpus. Summarization uses the configured model and resumes existing per-paper checkpoints. HTML rendering is local; `--pdf` additionally requires Chromium. A retrieval-only request uses `search-papers` instead.

Inspect the records in `top-conf/data/conferences/<id>_<year>.jsonl`, the category/summary output and the rendered report. Check stable identities, original links, authors, source provenance, requested year and actual scope. Source errors, authentication challenges, unavailable proceedings and incomplete pagination remain explicit failures; do not replace them with unrelated pages or claim a successful empty collection. An override URL must expose the same provider protocol. Do not trigger release/deployment workflows merely to validate collection.

PMLR overrides must also serve `assets/rss/feed.xml`; the index's canonical volume and complete link set must agree with that RSS. Official OpenReview cross-links preserve PMLR identities when available. NeurIPS proceedings use their canonical landing URLs, with no inferred equivalence to older OpenReview IDs. Summarization/reporting validate the registered conference/year independently from default source availability, so existing archives remain usable.

NeurIPS abstract enrichment checkpoints each verified detail page in `top-conf/data/abstracts/<id>_<year>.jsonl`. It matches the citation PDF's paper identifier and volume; publication date can differ from conference year. Completed entries are reused. New evidence makes older summaries stale until `summarize-conf` regenerates them; unchanged evidence does not repeat model calls. Bound a manual acceptance run with `--limit`; choose `--all` explicitly for full enrichment. Do not describe a bounded sample as the full archive.

## Classification

Supply the available title, abstract, keywords and venue to the model. Keep its structured category and summary. Detailed topics such as Coding Agents are semantic choices based on this evidence, not substring filters. When only bibliography/title evidence exists, the summary must say so and avoid invented methods, results or experiments. A successful fixture run proves protocol handling; live acquisition and model quality require their own observations.

## Extending sources

1. Identify the authoritative endpoint and its declared record identities, scope and pagination. Confirm a real response when access is available.
2. Add the conference's name/domain/provider/remote identifier to the existing registry. Reuse an existing provider when its protocol fits; add parsing in `internal/jobs` only for a distinct protocol.
3. Keep accepted-venue or stream/year validation and stable-ID deduplication before corpus writes. Preserve source fields needed by the classifier.
4. Verify the production CLI path through fetch, classification checkpoints, HTTP catalog and HTML report, with remote services replaced only at their HTTP boundary.
5. Update the report workflow choices and docs. Run Go race/vet and the frontend/browser CI before merging. Report separately any live endpoint or model verification still blocked by external access.
