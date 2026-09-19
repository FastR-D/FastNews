# FastNews paper corpus

Local sources used by `scripts/search_papers.py`.

## Layout

| Source | Path | Notes |
| --- | --- | --- |
| Top-conference papers | `top-conf/data/conferences/<conf>_<year>.jsonl` | Raw title, authors, English abstract in `description` |
| Top-conference summaries | `top-conf/data/summary/<conf>_<year>_summary.jsonl` | `category` plus `paper.summary_zh` |
| arXiv + news | `secnews/data/articles/YYYY-MM-DD.jsonl` | Filter `source` to arXiv feeds |
| Daily Chinese blurbs | `secnews/data/daily_summaries/YYYY-MM-DD.json` | Join by `_id` / `link` when present |

Conference file stems: `usenix`, `ieee-sp`, `ndss`, `ccs`. Labels: USENIX Security, IEEE S&P, NDSS, ACM CCS.

Current FastNews coverage is recent Big4 (today: USENIX 2025/2026, IEEE S&P 2026, NDSS 2026). CCS may be absent. arXiv coverage is whatever `secnews.update` has fetched (`cs.CR`, `cs.AI+cs.CL`). This is not a complete historical library.

## Categories

Use these exact English names when passing `--category`:

- Web Security
- Network Security
- System & OS Security
- Hardware Security
- Cryptography & Protocols
- Privacy & Anonymity
- ML/AI Security
- Human Factors & Usable Security
- Binary & Forensics
- Miscellaneous

A few summary rows may use `Network & System Security`; treat them as network/system papers, do not rename the files.

## Search output

`search_papers.py` prints JSON:

```text
query, terms, categories, corpus_size, hit_count, items[]
```

Each item: `id`, `source` (`top-conf` or `arxiv`), `title`, `title_zh`, `author`, `year`, `venue`, `category`, `link`, `summary`, `score`, `matched_terms`.

Default arXiv window is 90 days; `--arxiv-days 0` reads all dates. `--min-score` defaults to 1.

Select from `items` with the highest specific overlap. If you need the full Chinese abstract, read the matching `*_summary.jsonl` record rather than guessing.
