---
name: field-briefing
description: "Write a literature review of a research field's recent status and recommend highly related papers from FastNews top-conference summaries and recent arXiv. Use when the user wants to understand, survey, 入门, 综述, 国内外研究现状, or explore a security/AI research area, or asks for related papers on a topic. Do not use for generating weekly newspapers, fetching conference pages, homepage UI changes, or generic coding."
metadata:
  short-description: "Review a research field and recommend papers"
---

# Field Briefing

When the user wants to learn a research area, write a grounded literature review of recent work and recommend the most related papers. Prefer FastNews local corpora over memory.

## Workflow

1. Identify the field, including English/Chinese names, aliases, and likely FastNews categories. Read `references/corpus.md` only if the taxonomy, file layout, or coverage limits are unclear.
2. Search local papers before drafting:

```bash
go run ./cmd/fastnews search-papers --query "<field and aliases>" --limit 16
```

The Go command reads the existing corpus without generating content or starting a server. It uses the same vector retriever as the application. Add `--category`, `--conference`, `--year`, or `--source top-conf|arxiv` to narrow the evidence. If hits are weak, rerun with English aliases or a broader category, then inspect the JSON `items`.

3. Use web search only for canonical surveys or seminal papers that FastNews does not cover (the local top-conference set is recent Big4, not a historical archive). Open a real page before citing an external paper. Skip web search when local hits already answer a narrow request.
4. Write the briefing from the retrieved papers plus established field knowledge. Do not invent FastNews papers, venues, years, or links.

## Output

Match the user's language; default to Chinese in this repo. Keep the briefing detailed but scannable.

Typical shape unless the user asks otherwise:

- **综述范围**：研究对象、近五年文献边界、与相邻领域的分界。FastNews 语料以 2023–2026 顶会与近 90 天 arXiv 为主，不是近五年全集。
- **分类综述**：按研究方法或研究主题分成 3–6 类。每个分类下先用一句话概括主流观点或共识，并引用具体学者的工作支撑这个共识；随后讨论相应工作的不同进展，对比他们在研究方法、侧重点或结论上的异同。
- **研究不足**：结合检索到的近作，明确指出当前研究还存在的不足之处，禁止空泛套话。
- **推荐阅读**：总共 8–12 篇，先高相关后凑数。

Split recommendations:

- **奠基与综述**：2–4 篇经典/survey，可以来自外部检索，必须有真实标题和链接
- **FastNews 高相关**：6–10 篇来自检索结果。每篇包含标题、venue/year、作者、链接、一句话相关原因（方法、主题、对象或问题重叠），并可用中文摘要

If local coverage is thin, say so and lean on surveys plus recent arXiv. Prefer specific overlap over generic “也属于该领域”.

## Constraints

- FastNews papers must come from `fastnews search-papers` output or the underlying JSONL files.
- Do not start newspaper generation, conference fetching, or homepage edits.
- Do not dump dozens of papers. If the user only wants an intro or only wants papers, follow that request.
