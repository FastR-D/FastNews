# FastNews paper corpus

Local sources used by `go run ./cmd/fastnews search-papers`.

## Layout

| Source | Path | Notes |
| --- | --- | --- |
| Top-conference papers | `top-conf/data/conferences/<conf>_<year>.jsonl` | Raw title, authors, English abstract in `description` |
| Top-conference summaries | `top-conf/data/summary/<conf>_<year>_summary.jsonl` | `category` plus `paper.summary_zh` |
| arXiv + news | `secnews/data/articles/YYYY-MM-DD.jsonl` | Filter `source` to arXiv feeds |
| Daily Chinese blurbs | `secnews/data/daily_summaries/YYYY-MM-DD.json` | Join by `_id` / `link` when present |

Conference file stems: `usenix`, `ieee-sp`, `ndss`, `ccs`. Labels: USENIX Security, IEEE S&P, NDSS, ACM CCS.

FastNews covers summarized Big4 papers from the years present in the corpus, plus the last 90 days of fetched arXiv feeds (`cs.CR`, `cs.AI+cs.CL`). Inspect the actual files for coverage; this is not a complete historical library.

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

`fastnews search-papers` prints JSON:

```text
query, corpus_size, hit_count, embedding_provider, items[]
```

Each item includes `id`, `source`, `title`, `title_zh`, `author`, `year`, `venue`, `conference`, `category`, `link`, `summary`, and `retrieval_score`. Results are ranked by vector similarity after metadata filtering; score is not a calibrated confidence.

Default arXiv coverage is the most recent 90 days. Read the matching `*_summary.jsonl` record for a full conference abstract. Do not infer that the local corpus covers every paper or year.
