# FastNews

自动收集安全研究与新闻资讯，经 LLM 总结后生成**安全资讯周报**与**顶会论文分析报告**，并通过 GitHub Actions 全自动发布到 GitHub Releases。

## ✨ 特性

- **🗞️ 安全资讯周报（secnews）**：每日从 BleepingComputer 与 arXiv 抓取资讯/论文，由 LLM 筛选、导读并翻译，每周自动生成排版精美的 HTML/PDF 周报。
- **🎓 顶会论文分析（top-conf）**：针对 USENIX Security、IEEE S&P、NDSS、ACM CCS 四大安全顶会做结构化抓取，LLM 自动分类（Web / 系统 / 密码学 / 隐私 / ML 安全等 10 类）并生成深度中文摘要，输出 Web/PDF 报告。
- **🧭 统一报告主页**：总览页集中展示所有报告，支持维护"感兴趣作者"列表（保存在浏览器本地）。
- **🤖 全自动流水线**：GitHub Actions 定时抓取、总结、发布，全程无需人工干预。

## 🧭 主页

- 总览页：[index.html](index.html)
- 顶会论文总结：[top-conf/index.html](top-conf/index.html)
- 安全资讯周报：[secnews/index.html](secnews/index.html)

```bash
# 重新扫描 report 目录并生成主页
uv run python generate_homepage.py
```

主页提供"感兴趣作者"列表：可添加作者姓名、简介和主页链接，数据保存在浏览器 localStorage 中。

## 🚀 快速开始

1. **环境要求**：Python ≥ 3.13、[uv](https://docs.astral.sh/uv/)。
2. **安装依赖**：

   ```bash
   uv sync
   ```

3. **配置 LLM**：复制 `.env.example` 为 `.env` 并填入密钥：

   ```bash
   cp .env.example .env
   ```

4. **生成主页**（可选，用于本地预览报告）：

   ```bash
   uv run python generate_homepage.py
   ```

> PDF 生成依赖 WeasyPrint，需要系统图形库：Ubuntu 安装 `libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 libffi-dev libcairo2 fonts-noto-cjk`，macOS 安装 `brew install pango`。缺少时脚本会自动跳过 PDF、仅输出 HTML。

## 📂 项目结构

```text
.
├── generate_homepage.py        # 生成统一主页（index.html / top-conf/index.html / secnews/index.html）
├── prompt/
│   └── homepage.html.j2        # 主页模板
├── secnews/                    # 安全资讯周报模块
│   ├── update.py               # 抓取 RSS 并写入 JSONL（去重）
│   ├── generate_newspaper.py   # 调用 LLM 总结文章 → newspapers/*.json
│   ├── generate_pdf.py         # 汇总近 N 天报纸 → HTML/PDF 周报
│   ├── util.py                 # RSS 抓取与数据源定义
│   ├── prompt/                 # LLM 提示词与周报模板
│   └── data/
│       ├── articles/           # 原始 RSS 条目（按日期 JSONL）
│       ├── newspapers/         # LLM 总结结果（按日期 JSON）
│       └── report/             # 周报 HTML 备份
├── top-conf/                   # 顶会论文分析模块
│   ├── fetch_big4.py           # 抓取四大顶会论文列表
│   ├── generate_conf_summary.py# LLM 分类 + 中文摘要（断点续传）
│   ├── generate_conf_report.py # 生成 HTML/PDF 报告
│   ├── prompt/                 # LLM 提示词与报告模板
│   └── data/
│       ├── conferences/        # 论文原始数据（JSONL）
│       ├── summary/            # LLM 分类摘要（JSONL）
│       └── report/             # 报告 HTML/PDF
├── .github/workflows/          # CI/CD 流水线
└── 前端风格.txt                 # 前端设计风格沉淀（FastRead 风格参考）
```

## 🔒 secnews：安全资讯周报

### 数据来源

| 标识 | 数据源 | Feed |
| --- | --- | --- |
| `bleepingcomputer` | BleepingComputer 安全新闻 | https://www.bleepingcomputer.com/feed/ |
| `arxiv_cs_cr` | arXiv cs.CR（密码学与安全） | https://rss.arxiv.org/atom/cs.cr |
| `arxiv_cs_ai` | arXiv cs.AI + cs.CL | https://rss.arxiv.org/atom/cs.ai+cs.cl |

> arXiv 的 Atom feed 只包含当日新公告，无新条目时返回空列表属正常现象。

### 使用方法

```bash
# 1. 抓取新闻（source 取上表标识，重复运行自动按 _id/link 去重）
uv run python -m secnews.update bleepingcomputer
uv run python -m secnews.update arxiv_cs_cr
uv run python -m secnews.update arxiv_cs_ai

# 2. 生成报纸 JSON（LLM 筛选 + 导读/翻译，只处理上次生成后的新文章）
uv run python -m secnews.generate_newspaper

# 3. 生成周报（默认汇总最近 7 天，可传天数参数）
uv run python -m secnews.generate_pdf
uv run python -m secnews.generate_pdf 3

# 输出：output/ 下生成 HTML/PDF（供发布），secnews/data/report/ 下保存 HTML 备份
```

周报文件命名规则：`<年>.<月>.<第几周>-report.html`，例如 `2026.3.2-report.html` 表示 2026 年 3 月第 2 周。

## 🎓 top-conf：顶会论文分析

### 支持的会议

| 标识 | 会议 | 默认抓取页面 |
| --- | --- | --- |
| `usenix` | USENIX Security | https://www.usenix.org/conference/usenixsecurity26/ |
| `ieee-sp` | IEEE S&P | https://sp2026.ieee-security.org/accepted-papers.html |
| `ndss` | NDSS | https://www.ndss-symposium.org/ndss2026/accepted-papers/ |
| `ccs` | ACM CCS | https://www.sigsac.org/ccs/CCS2026/ |

### 使用方法（以 USENIX 2026 为例）

```bash
# 1. 抓取论文列表
uv run python top-conf/fetch_big4.py usenix 2026

# 可选：手动指定 accepted-papers 页面（支持多次传入 --url）
uv run python top-conf/fetch_big4.py usenix 2026 \
  --url https://www.usenix.org/conference/usenixsecurity26/cycle1-accepted-papers

# 2. LLM 生成分类与中文摘要（默认 40 篇/批，自动断点续传，可 --batch-size 调整）
uv run python top-conf/generate_conf_summary.py usenix 2026

# 3. 生成 HTML/PDF 报告（保存在 top-conf/data/report/）
uv run python top-conf/generate_conf_report.py usenix 2026
```

### 报告展示

- **USENIX Security 2026 论文总结**：[[HTML]](top-conf/data/report/USENIX_2026_Report.html)
- **USENIX Security 2025 论文总结**：[[HTML]](top-conf/data/report/USENIX_2025_Report.html) [[PDF]](top-conf/data/report/USENIX_2025_Report.pdf)

其他会议把 `usenix 2026` 换成对应标识与年份即可，例如：

```bash
uv run python top-conf/fetch_big4.py ieee-sp 2026
uv run python top-conf/generate_conf_summary.py ieee-sp 2026
uv run python top-conf/generate_conf_report.py ieee-sp 2026
```

> 说明：`generate_conf_summary.py` 会按 `_id` 跳过已处理论文，中断后重跑即可续传；单批失败会自动降级为逐篇处理。

## ⚙️ 环境变量

复制 `.env.example` 为 `.env` 即可，LLM 服务需为 OpenAI 兼容接口：

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | ✅ | - | LLM API 密钥 |
| `OPENAI_BASE_URL` | 否 | `https://api.openai.com/v1` | OpenAI 兼容接口地址 |
| `LLM_MODEL` | 否 | `gemini-3-flash-preview` | 使用的模型名 |

## 🛠️ GitHub Actions 流水线

项目配置了 4 条工作流，实现数据抓取、总结、发布全自动化：

| 工作流 | 触发时机 | 作用 |
| --- | --- | --- |
| `update` | 每天 06:00 UTC | 抓取 3 个 RSS 源，追加到 `secnews/data/articles/` 并提交 |
| `gen_newspaper` | 每天 22:30 UTC | 调用 LLM 生成报纸 JSON 并提交 |
| `weekly_release` | 每周六 06:00 UTC | 汇总近 7 天报纸生成周报，提交 HTML 备份并发布至 [GitHub Releases](https://github.com/fripSide/SecurityNews/releases) |
| `conf_release`（Top Conferences Release） | 手动触发（workflow_dispatch） | 抓取 → LLM 总结 → 生成报告 → 提交数据并发布 Release |

使用前需要在仓库 Settings → Secrets and variables → Actions 中配置：

- `OPENAI_API_KEY`（必填）
- `OPENAI_BASE_URL`（可选，默认 OpenAI 官方地址）
- `LLM_MODEL`（可选，默认 `gemini-3-flash-preview`）

`update` 与 `gen_newspaper` 共用 `data-commit` 并发锁，避免同时提交产生冲突。

## ❓ FAQ

**Q：arXiv feed 抓不到数据？**
A：arXiv 的 Atom feed 只包含当天新公告，无新论文时为空；可稍后重跑 `uv run python -m secnews.update arxiv_cs_cr`。

**Q：没有 OpenAI 官方 key，能用其他模型吗？**
A：可以。任意 OpenAI 兼容端点都支持，在 `.env` 中设置 `OPENAI_BASE_URL`（如第三方代理、本地 vLLM/Ollama 网关）与 `LLM_MODEL` 即可。

**Q：如何只生成 HTML、不生成 PDF？**
A：脚本会自动探测 WeasyPrint，缺少系统图形库（pango 等）时自动跳过 PDF；也可在安装了 pango 的环境中运行以获得 PDF。

**Q：`generate_conf_summary.py` 中途失败/超时怎么办？**
A：直接重跑即可。脚本按 `_id` 记录已处理论文，会从断点继续；批处理失败时自动降级为逐篇调用 LLM。

**Q：主页的"感兴趣作者"列表存在哪里？**
A：保存在浏览器 localStorage 中，清空浏览器数据会丢失，不随仓库同步。
