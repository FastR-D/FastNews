# FastNews paper corpus

Local sources used by `go run ./cmd/fastnews search-papers`.

## Layout

| Source | Path | Notes |
| --- | --- | --- |
| Top-conference papers | `top-conf/data/conferences/<conf>_<year>.jsonl` | Raw title, authors, English abstract in `description` |
| Top-conference summaries | `top-conf/data/summary/<conf>_<year>_summary.jsonl` | `category` plus `paper.summary_zh` |
| arXiv + news | `secnews/data/articles/YYYY-MM-DD.jsonl` | Filter `source` to arXiv feeds |
| Daily Chinese blurbs | `secnews/data/daily_summaries/YYYY-MM-DD.json` | Join by `_id` / `link` when present |

Conference file stems are registered in `internal/catalog/catalog.go`: `usenix`, `ieee-sp`, `ndss`, `ccs`, `iclr`, `icml`, `neurips`, `icse`, `ase`.

FastNews searches summarized conference papers from the years actually present in the corpus, plus the last 90 days of fetched arXiv feeds (`cs.CR`, `cs.AI+cs.CL`, `cs.SE`). Source registration does not imply that a conference/year is present. Inspect the actual files for coverage; this is not a complete historical library. The separate arXiv reading page can browse older dated files without the research index's 90-day cutoff.

## Categories

Read the actual category strings from the summary records or `/api/catalog` before passing `--category`. Classification uses source evidence and the conference domain, so fine-grained categories can vary between corpora. Pass the stored value exactly; do not rename files or silently force software/ML papers into the older security taxonomy.

## Search output

`fastnews search-papers` prints JSON:

```text
query, corpus_size, hit_count, embedding_provider, items[]
```

Each item includes `id`, `source`, `title`, `title_zh`, `author`, `year`, `venue`, `conference`, `category`, `link`, `summary`, and `retrieval_score`. Results are ranked by vector similarity after metadata filtering; score is not a calibrated confidence.

Default arXiv coverage is the most recent 90 days. Read the matching `*_summary.jsonl` record for a full conference abstract. Do not infer that the local corpus covers every paper or year.
