# FastNews

自动收集安全研究与新闻资讯，经 LLM 总结后生成**安全资讯周报**与**顶会论文分析报告**，并通过 GitHub Actions 全自动发布到 GitHub Releases。

## ✨ 特性

- **🗞️ 安全资讯周报（secnews）**：每日从 BleepingComputer 与 arXiv 抓取资讯/论文，由 LLM 筛选、导读并翻译，每周自动生成排版精美的 HTML/PDF 周报。
- **📝 每日 AI 导读**：为 `articles` 中每个日期生成中文标题与摘要，保存到 `secnews/data/daily_summaries/`，支持增量续跑。
- **🎓 顶会论文分析（top-conf）**：针对 USENIX Security、IEEE S&P、NDSS、ACM CCS 四大安全顶会做结构化抓取，LLM 自动分类（Web / 系统 / 密码学 / 隐私 / ML 安全等 10 类）并生成深度中文摘要，输出 Web/PDF 报告。
- **🧭 统一报告主页**：总览页右侧单独列出顶会报告，可打开或下载 HTML/PDF；也支持维护关注作者列表。必须从 FastResearch 用个人 Key 进入；`serve.py` 服务端兑换 SSO 票据后写入 HttpOnly Cookie，作者按 Key 保存在服务端。直开 `:4173` 会回到 Panel。
- **🤖 全自动流水线**：GitHub Actions 定时抓取、总结、发布，全程无需人工干预。
- **📚 领域导读**：在总览或侧栏进入「领域导读」，输入研究方向后基于顶会中文摘要与近期 arXiv 分类综述近五年研究现状并推荐高相关论文；会结合个人研究印象。
- **📊 总结汇报**：用本地顶会中文摘要生成数据实证简报。可做四大顶会全景，或按方向对照会场、年份与类别；数字只来自本地统计，没有引文窗口或杰出论文标签。
- **✉️ 私信**：每天按研究印象或关注作者方向推送一篇论文，按上海日历日一篇，已推过的论文会跳过。
- **🧑‍🔬 研究印象**：每位成员一份专属研究方向说明，保存在 FastResearch；领域导读、总结汇报、找论文和每日推送都会使用它。
- **📐 可折叠总览栏**：侧栏可隐藏/打开，状态记在浏览器本地。
- **📖 跳转 FastRead**：顶会报告、顶会列表、领域导读、总结汇报和私信的论文卡片可一键发布标题、摘要、作者并打开 FastRead。

## 📚 领域导读

侧栏或总览页进入 [领域导读](field-briefing/index.html)。输入研究方向（例如 `LLM jailbreak`、侧信道、TEE），页面会检索本地顶会中文摘要和近 90 天 arXiv，再按研究方法或主题分类综述近五年国内外研究现状：每类先概括共识并引用具体工作，再比较方法、侧重点或结论，最后指出研究不足，并推荐高相关论文。查询可留空，此时使用研究印象。

## 📊 总结汇报

侧栏或总览页进入 [总结汇报](summary-brief/index.html)。留空生成四大顶会全景；输入方向（例如 `LLM jailbreak`、侧信道）则按该主题做会场、年份与类别对照。简报结构为封面结论、三条发现、数据口径、表格/条形图、对照问答、相关论文、局限与讨论。统计只使用 FastNews 已总结的顶会中文摘要（及可选 arXiv），不会编造引用次数或杰出论文标签。查询可留空：无研究印象时走全景，有印象时按印象做方向简报。

```bash
python summary_brief.py -q "四大顶会全景" --format text
python summary_brief.py -q "LLM jailbreak" --format text
```

## ✉️ 私信与研究印象

- 研究印象：[impression/index.html](impression/index.html)。写下自己的研究方向、关注问题和方法，最长 4000 字，按个人 Key 存在 FastResearch。领域导读、总结汇报、找论文和每日推送都会使用它。
- 私信：[inbox/index.html](inbox/index.html)。每天打开 FastNews 时，若当天还没有推送，会优先推送关注作者本人的论文；若暂无新作，再按印象 → 关注作者标签 → 通用安全方向选一篇。打开私信页会把今日推送标为已读。

推送优先级：关注作者姓名命中的论文 → 印象文本 → 关注作者 / 自定义标签 → `computer security 系统安全 网络安全`。

当前语料覆盖 USENIX Security、IEEE S&P、NDSS、ACM CCS 2023–2026 的中文摘要。CCS 2026 目前仅有录用标题、尚无官方摘要；IEEE S&P 2026 部分论文摘要仍缺失。也可在仓库根目录用命令行检索：

```bash
python field_briefing.py -q "LLM jailbreak" --limit 5 --format text
```

## 🧭 主页

- 总览页：[index.html](index.html)
- 顶会论文总结：[top-conf/index.html](top-conf/index.html)
- 领域导读：[field-briefing/index.html](field-briefing/index.html)
- 总结汇报：[summary-brief/index.html](summary-brief/index.html)
- 私信：[inbox/index.html](inbox/index.html)
- 研究印象：[impression/index.html](impression/index.html)
- 安全资讯周报：[secnews/index.html](secnews/index.html)

```bash
# 重新扫描 report 目录并生成主页
uv run python generate_homepage.py
```

主页提供关注作者列表：可添加作者姓名、研究方向和主页链接。必须从 FastResearch 用个人 Key 进入；本地用 `python serve.py` 提供 `http://127.0.0.1:4173`，不要用 `python -m http.server`。服务端兑换 `?sso=` 后地址栏不再包含票据。左上角按钮可隐藏/打开总览栏。

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

5. **本地访问必须经 FastResearch**：先启动 FastResearch Panel，再在 FastNews 目录运行：

   ```bash
   python serve.py
   ```

   服务监听 `127.0.0.1:4173`。浏览器直开会 302 到 Panel；从 Panel 点击 FastNews 后才会兑换票据并展示报告。不要使用 `python -m http.server`。

   HTTP 接口：页面门禁、`POST /api/related-work`、`POST /api/field-briefing`、`POST /api/summary-brief`、`POST /api/fastread` 与 `GET /api/content/inbox`（补今日推送）由 `serve.py` 本地处理，其余 `/api/*` 反代到 FastResearch。完整清单见 `../FastResearch/docs/api.md`。

> PDF 生成依赖 WeasyPrint，需要系统图形库：Ubuntu 安装 `libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 libffi-dev libcairo2 fonts-noto-cjk`，macOS 安装 `brew install pango`。缺少时脚本会自动跳过 PDF、仅输出 HTML。

## 📂 项目结构

```text
.
├── generate_homepage.py        # 生成统一主页（index.html / top-conf / secnews / field-briefing / summary-brief / inbox / impression）
├── field_briefing.py           # 领域导读检索与导读生成
├── summary_brief.py            # 总结汇报统计与简报生成
├── inbox_push.py               # 每日私信选文
├── field-briefing/             # 领域导读页面
│   └── index.html
├── summary-brief/              # 总结汇报页面
│   └── index.html
├── inbox/                      # 私信
│   └── index.html
├── impression/                 # 研究印象
│   └── index.html
├── api/
│   ├── related-work.js         # 顶会 related work
│   ├── field-briefing.js       # 领域导读
│   ├── summary-brief.js        # 总结汇报
│   ├── fastread.js             # 跳转 FastRead
│   └── _lib/field-search.js    # 领域导读 / 总结汇报检索
├── assets/                     # 页面静态资源
│   ├── field-briefing.css
│   ├── field-briefing.js
│   ├── summary-brief.css       # 总结汇报
│   └── summary-brief.js
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
│       ├── daily_summaries/    # 每日 AI 翻译与概括（按日期 JSON）
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

# 3. 为最新日期生成中文标题与摘要（按 source_hash 增量处理）
uv run python -m secnews.generate_daily_summary

# 指定日期，或补齐所有历史日期
uv run python -m secnews.generate_daily_summary --date 2026-08-19
uv run python -m secnews.generate_daily_summary --all

# 4. 生成周报（默认汇总最近 7 天，可传天数参数）
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
# 0. 批量抓取并总结 2023-2026 四大顶会（按 _id 断点续传）
uv run python top-conf/update_range.py --since 2023 --until 2026 --batch-size 12

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

HTML 报告保存在 `top-conf/data/report/`。总览页与 [顶会论文总结](top-conf/index.html) 右侧都单列顶会报告，可打开或下载 HTML/PDF。当前覆盖四大顶会 2023–2026：

- **USENIX Security 2023** [[HTML]](top-conf/data/report/USENIX_2023_Report.html)
- **USENIX Security 2024** [[HTML]](top-conf/data/report/USENIX_2024_Report.html)
- **USENIX Security 2025** [[HTML]](top-conf/data/report/USENIX_2025_Report.html) [[PDF]](top-conf/data/report/USENIX_2025_Report.pdf)
- **USENIX Security 2026** [[HTML]](top-conf/data/report/USENIX_2026_Report.html)
- **IEEE S&P 2023** [[HTML]](top-conf/data/report/IEEE-SP_2023_Report.html)
- **IEEE S&P 2024** [[HTML]](top-conf/data/report/IEEE-SP_2024_Report.html)
- **IEEE S&P 2025** [[HTML]](top-conf/data/report/IEEE-SP_2025_Report.html)
- **IEEE S&P 2026** [[HTML]](top-conf/data/report/IEEE-SP_2026_Report.html)
- **NDSS 2023** [[HTML]](top-conf/data/report/NDSS_2023_Report.html)
- **NDSS 2024** [[HTML]](top-conf/data/report/NDSS_2024_Report.html)
- **NDSS 2025** [[HTML]](top-conf/data/report/NDSS_2025_Report.html)
- **NDSS 2026** [[HTML]](top-conf/data/report/NDSS_2026_Report.html)
- **ACM CCS 2023** [[HTML]](top-conf/data/report/CCS_2023_Report.html)
- **ACM CCS 2024** [[HTML]](top-conf/data/report/CCS_2024_Report.html)
- **ACM CCS 2025** [[HTML]](top-conf/data/report/CCS_2025_Report.html)
- **ACM CCS 2026** [[HTML]](top-conf/data/report/CCS_2026_Report.html)

CCS 2026 目前仅有录用标题、尚无官方摘要；IEEE S&P 2026 约 188/262 篇带官方摘要。其他会议把 `usenix 2026` 换成对应标识与年份即可，例如：

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
| `FASTRESEARCH_API_URL` | 否 | `http://127.0.0.1:8787` | FastNews `serve.py` 兑换票据与反代 `/api` 的地址 |
| `FASTRESEARCH_PANEL_URL` | 否 | `http://127.0.0.1:5173` | 无会话直开时 302 的 Panel 地址 |
| `FASTNEWS_HOST` / `FASTNEWS_PORT` | 否 | `127.0.0.1` / `4173` | 本地门禁服务监听地址 |
| `FASTREAD_URL` | 否 | `http://127.0.0.1:3015` | `POST /api/fastread` 跳转 FastRead 的地址 |

## 🛠️ GitHub Actions 流水线

项目配置了 4 条工作流，实现数据抓取、总结、发布全自动化：

| 工作流 | 触发时机 | 作用 |
| --- | --- | --- |
| `update` | 每天 06:00 UTC | 抓取 3 个 RSS 源，追加到 `secnews/data/articles/` 并提交 |
| `gen_newspaper` | 每天 22:30 UTC | 调用 LLM 生成报纸 JSON、每日 AI 导读并提交 |
| `weekly_release` | 每周六 06:00 UTC | 汇总近 7 天报纸生成周报，提交 HTML 备份并发布至 [GitHub Releases](https://github.com/FastR-D/FastNews/releases) |
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

**Q：主页的关注作者列表存在哪里？**
A：按 FastResearch 个人 Key 保存在服务端，并显示“已登录 {成员} 的关注作者”。直开 FastNews 端口不会进入产品。首次从 Panel 进入时，如果服务端还没有作者，会把当前浏览器里的本地作者迁移过去一次。

**Q：研究印象和私信存在哪里？**
A：同样按个人 Key 存在 FastResearch（`data/access.json` 的 `researchImpression` / `inbox`），不走 localStorage。每天第一次打开 FastNews 任意页面时，`GET /api/content/inbox` 会补一篇当日论文。

## 自托管与自动部署

生产环境用 `python3 serve.py`（systemd 单元 `fastnews.service`），经 nginx 挂在 `/news/`。需要在 `.env` 中设置：

```env
FASTRESEARCH_API_URL=http://127.0.0.1:8787
FASTRESEARCH_PANEL_URL=http://47.110.133.67
FASTNEWS_HOST=127.0.0.1
FASTNEWS_PORT=8788
FASTNEWS_PUBLIC_PATH=/news
```

`main` 推送后 GitHub Actions `CD FastNews` 做语法检查；配置 SSH Secrets 后会自动在服务器执行 `scripts/deploy-local.sh`。服务器本机也有定时 `git pull` 热更新。

