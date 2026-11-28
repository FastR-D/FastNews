# FastNews

研究报告与资讯工作台：Go 后端与 React / TypeScript 前端分离，前端使用 **FastUI 0.3.0**。总览、安全与 AI 研究资讯、多领域会议论文、领域导读、总结汇报、关注作者、每日私信及账号管理共用同一套 JSON API。

## 开发

要求 Go 1.26（模块固定 toolchain 1.26.8）、C 编译器（SQLite）、Node 22+、pnpm 10.33.0。

```bash
make install
cp .env.example .env
make build
# 环回 HTTP 开发允许非 Secure Cookie；生产保持 true。
FASTNEWS_COOKIE_SECURE=false ./bin/fastnews serve
```

打开 `http://127.0.0.1:4173`。全站默认需要登录，包括业务 API、报告和原始数据。先用 `./bin/fastnews create --admin --email admin@example.com --name 管理员` 创建管理员；密码交互输入。

前后端分别开发：

```bash
# 终端一：Go API，默认 4173
make dev-api
# 终端二：React Vite，默认 5178，/api 代理到 Go
make dev-web
```

Go 可直接提供构建后的 SPA，也可由 nginx / 静态服务器提供 `web/dist`，把同源 `/api/` 及报告文件路径转发到 Go。前端只通过 API 获取业务数据，不读取后端源码，不依赖 Python 服务。

## 栏目与兼容入口

| 功能 | React 路由 | 行为 |
| --- | --- | --- |
| 总览 | `/` | 最新快讯、统计、研究入口、报告与下载、作者列表 |
| 顶会报告 | `/top-conf/` | 领域/会议/年份/轨道/细分方向筛选、向量搜索、分页、related work、报告打开与下载 |
| 数据覆盖 | `/coverage/` | 论文数、原始摘要和有效/过期总结计数、最近落盘与任务成功时间、任务失败类别 |
| 领域导读 | `/brief/` | 印象补全方向、向量召回、分类综述、综述/SoK、论文推荐 |
| 总结汇报 | `/summary/` | 全景或主题简报、发现、统计表与条形图、问答、局限与讨论 |
| 新闻与资讯 | `/updates/` | 安全/AI 频道、搜索/来源筛选、分页、独立阅读与字号；筛选及当前文章随 URL 保存 |
| 信源目录 | `/sources/` | 按领域、名称和配置状态查找来源，按领域、状态筛选科研来源 |
| arXiv 导读 | `/arxiv/` | 按采集日期浏览预印本、论文领域筛选、分页、摘要与 FastRead 阅读跳转 |
| 研究趋势 | `/trends/` | AI、安全与软件工程的 7 / 14 / 30 天热度榜、占比变化、关键词与原论文证据 |
| 关注作者 | `/following/` | 增删改、研究标签、主页解析、解析结果与论文链接 |
| 私信 | `/inbox/` | 上海日历日每天一篇、关注作者优先、去重、已读和历史 |
| 研究印象 | 顶栏弹窗 | 最长 4000 字，按当前账号保存 |
| 登录 | `/login` | 登录、邀请注册、恢复账号 |
| 账号设置 | `/account/` | 账号信息修改与 FastCAS 认证 |

arXiv 仅采集主分类为 `cs.*` 的论文，其他主分类、仅交叉列入 CS 和缺失分类的记录不入库；历史读取、趋势和摘要同样执行此范围。优先使用官方 `primary_category`，已存官方数据使用第一分类。arXiv 导读默认打开最近有预印本的采集日。`source=arxiv` 始终由服务端分页，默认每页 12 篇；`page` 从 1 开始，`page_size` 最大 50。`q` 搜索标题、作者、摘要和分类，`category` 精确筛选领域，先过滤整天语料再分页，按发表时间倒序；响应提供 `total/page/pageSize/pages/categories`，其中分类选项来自整天语料。日期、搜索、领域、每页条数和翻页在同一工具栏，手机自动换行。`GET /api/news?source=arxiv|news|security|ai|articles` 分别返回对应范围的最近非空日期及内容，其中 `articles` 为全部非 arXiv 资讯；指定 `date` 时保留该日期，即使该范围当天为空。不指定来源时保留总览使用的全部资讯行为。旧调用若需要全部非 arXiv 内容，应从 `source=security` 改为 `source=articles`。

前端统一页面边距、卡片与控件，使用 HarmonyOS Sans SC CDN 字体和亮暗主题。会议报告在 `/top-conf/<conference>/<year>/` 站内阅读，例如 `/top-conf/usenix/2026/`；旧 `/report/?path=…` 路由与 `api/report?path=…` 接口已移除，不做兼容跳转。其他报告使用 `/reports/<kind>/<slug>/`。历史报告已转换为 JSON 文档数据；旧独立 HTML、阅读脚本和兼容页面入口已删除。实现约定见 [界面规范](docs/FASTUI.md)。

研究趋势使用已有 arXiv 采集档案，不请求外部模型。`GET /api/trend?scope=ai&days=30` 按 UTC 采集日比较相邻等长窗口，以档案最新论文日为统计终点。按 arXiv ID 去重，覆盖现有 AI/NLP、安全和软件工程订阅及其中的交叉分类，不代表全量 arXiv 或引用影响力。

方向由原始标题和摘要主要贡献中的技术短语识别，合并同义词和有原文全称支持的缩写，不强行给未匹配论文归类。方向至少有 3 篇独立论文才上榜；同篇论文可属于多个方向。占比变化以百分点计，两期各至少 20 篇且各有至少三分之一窗口天数的记录才展示。另列跨至少 2 个采集日、由至少 3 篇论文标题和摘要共同支持的候选术语。

## 账号和身份

```bash
# 交互读取密码；自动化环境可使用 FASTNEWS_INITIAL_PASSWORD。
./bin/fastnews create --email reader@example.com --name Reader
./bin/fastnews invite --email new@example.com
./bin/fastnews recovery --email reader@example.com
# 可用 --root 指定原有账号数据目录。
```

邀请和恢复凭证由管理员交付，一小时内有效、单次消费。恢复保留用户 UUID 和内容，撤销旧会话。SQLite 默认位于 `.fastnews-data/accounts.sqlite`，兼容原 Python 数据库及 Werkzeug scrypt 密码；无需导出重建账号。Cookie 为 HttpOnly / SameSite=Lax，写入要求 CSRF，登录和密码证明有速率限制。

FastCAS 使用正式 Go SDK **v0.1.2**，需要同时配置 issuer / client ID / secret / redirect URI。本地账号独立存在；同名或同邮箱不会自动合并。绑定需要本地会话、密码、CSRF 与浏览器绑定。撤销、身份停用和后端退出事件只影响 CAS 来源会话，事件提交失败可重试。

账号设置只保留账号信息修改与 FastCAS 认证。修改资料需要当前密码；变更邮箱或密码会撤销其他登录会话。Read 与 Research 的服务联动复用同一 FastCAS 身份，不再在账号页提供连接码、Research Key 或快照导入设置。服务端仍按绑定状态、服务令牌与 scope 校验权限，未配置 FastCAS 时不会显示已认证。详见 [账号与 FastCAS](docs/fastcas-integration.md)。

论文入口可以向 FastRead 交接元数据，已绑定 CAS 时携带 `auth=cas` 进入统一认证流程。配置与验证见 [FastRead 联动](docs/fastread-integration.md)。

## 向量检索与生成

领域导读、总结汇报、related work、论文搜索和每日推送使用同一套向量检索。默认离线哈希向量；设置 `RAG_EMBEDDING_URL` 和 `EMBEDDING_MODEL` 可接 OpenAI 兼容 embeddings。远端失效时同时重建语料和查询的离线向量，避免混用不同空间。

配置 `OPENAI_API_KEY`、可选的 `OPENAI_BASE_URL` 和 `LLM_MODEL` 后启用生成。未配置或生成失败时，领域导读与总结汇报仍展示**明确标记的本地证据整理和真实统计**。related work 的模型解释仍需要 LLM。引用次数和奖项仅显示已有元数据。

```bash
./bin/fastnews search-papers --query 'LLM jailbreak' --limit 16  # 只读 JSON 检索
./bin/fastnews field-briefing --query 'LLM jailbreak' --limit 5 --format text
./bin/fastnews summary-brief                         # 会议论文全景
```

## 论文采集与人物资料

采集适配器、轨道校验、Coding Agent 与 AI 三大会细分方向见 [论文采集接口](docs/paper-collection.md)。卡片与报告中的作者、机构支持悬浮简介、关注和站内论文汇总；个人官网、ORCID 和 ROR 公开资料可在资料页读取，未确认的同名记录不自动合并。

## Go 数据任务

采集语料、摘要检查点与生成报告不进入 Git，服务器负责持久保存。现有 JSON/JSONL 无需转换，CLI 按原目录与命名写入。任务可从仓库根目录运行，或设置 `FASTNEWS_ROOT` 指向语料目录。服务首次启动时自动采集一次 RSS/Atom，随后默认每 6 小时采集。管理员从侧栏「进程管理」查看定时计划、下次执行时间、逐信源进度和历史，调整或暂停计划，也可手动补采、停止当前任务。论文会议也可选择定时或手动采集，已发布年份通过内置计划维护；摘要生成与报告导出可用 CLI。

```bash
./bin/fastnews fetch-news --source bleepingcomputer
./bin/fastnews fetch-news --source thehackernews
./bin/fastnews fetch-news --source securityweek
./bin/fastnews fetch-news --source arxiv_cs_cr
./bin/fastnews fetch-news --source arxiv_cs_ai
./bin/fastnews fetch-news --source arxiv_cs_se
./bin/fastnews fetch-news --source all              # 逐源采集，失败源不阻止其他源落盘，最后汇总错误
./bin/fastnews fetch-news --source ai               # 官方博客与已配置的研究机构
./bin/fastnews fetch-news --source security         # 安全媒体与研究团队
./bin/fastnews daily-summary                       # 最新资讯日期
./bin/fastnews daily-summary --date 2026-09-04
./bin/fastnews daily-summary --all                 # 全历史，逐篇保存检查点
./bin/fastnews newspaper
./bin/fastnews weekly-report --days 7 --pdf

./bin/fastnews fetch-conf --conference usenix --year 2026
./bin/fastnews fetch-conf --conference icml --year 2025     # PMLR 索引 + 同卷 RSS 完整摘要
./bin/fastnews fetch-conf --conference neurips --year 2025  # 官方卷中 conference 主会轨道
./bin/fastnews enrich-abstracts --conference neurips --year 2025 --limit 12
./bin/fastnews enrich-abstracts --conference neurips --year 2025 --all # 逐篇补全，已完成文章不再请求
./bin/fastnews summarize-conf --conference usenix --year 2026
./bin/fastnews conference-report --conference usenix --year 2026 --pdf
./bin/fastnews update-range --since 2023 --until 2026
./bin/fastnews fetch-awards --conference ieee-sp --year 2026
./bin/fastnews enrich-metrics --conference usenix --year 2026 --limit 12
./bin/fastnews index
```

会议支持安全四会 `usenix / ieee-sp / ndss / ccs`、机器学习 `iclr / icml / neurips` 以及软件工程 `icse / ase`。安全会议读取官方页面；ICLR 读取 OpenReview API v2 指定年份的正式会议 venue。ICML 直接读取 PMLR 官方索引及同卷 RSS，以论文链接核对完整集合并保留原始摘要；NeurIPS 直接读取官方卷中声明为 `conference` 的主会轨道，排除其他轨道，索引不提供摘要时保持未知。ICML/NeurIPS 官方格式目前支持已核对的 2022–2025 年，未验证的年份明确报错，不自动切换其他来源。ICSE/ASE 读取 DBLP 中对应年份、会议流的会议及研讨会论文记录，并保留原始 venue。没有摘要时，生成结果必须说明仅依据标题，不补造实验。分类参考会议领域，支持 Coding Agents 等细分方向，不通过标题关键词自动判定类别。

采集地址可通过 `--url` 指定同协议、同年份格式的来源，PMLR 来源同时需要可访问的 `assets/rss/feed.xml`。来源要求登录、返回验证页、分页或论文集合不完整、会议/年份不符时返回错误并保留已有文件。新闻以 ID / URL 去重，结构化会议记录和论文摘要按稳定 ID 续跑：PMLR 有官方 OpenReview 交叉链接时复用该身份，否则使用论文页面 URL；NeurIPS 使用官方论文页面 URL，不按标题猜测旧 OpenReview 记录是否等价。日报保持原 `source_hash` 检查点算法。`update-range` 仍按原安全四会运行，其他会议按 `fetch-conf → summarize-conf → conference-report` 单独选择年份；手动报告工作流支持全部已接入会议，ICML/NeurIPS 请显式选择已验证年份。`enrich-metrics` 使用 OpenAlex 并要求标题规范化后完全匹配。

HTML 报告由 Go 模板生成。PDF 使用 Chromium，通过 `FASTNEWS_CHROME` 指定可执行文件；不请求 PDF 时不需要浏览器。周报同时输出到 `output/` 及 `secnews/data/report/`。采集、摘要与报告任务由服务器上的 Go CLI 执行。

新闻来源可用 `config/news-sources.json` 或 `--sources-file` 扩展/禁用，按来源固定频道，默认仅导入近 14 天文章并跨全部历史去重。机构研究源可独立扩大时间窗口。配置、16 路来源及实测限制见 [资讯采集](docs/news-collection.md)。[同类产品调研](docs/competitive-research-2026-11-27.md) 与[社区信源调研](docs/source-research-2026-11-27.md) 保留原帖和官方出处。可选 [Telegram 个人读取准备](docs/telegram-sources.md) 独立运行，只保存本地私有快照，不改变 Go/React 服务依赖。

NeurIPS 原始摘要补全读取官方论文详情页，按 PDF 路径中的论文 ID 和卷号核对身份，不用出版日期推断会议年份。每篇成功结果追加到 `top-conf/data/abstracts/<conf>_<year>.jsonl` 并同步落盘；后续运行只请求缺少摘要的文章，失败保留此前进度。默认每次补全 12 篇，`--limit 0` 或 `--all` 处理全部缺失文章。摘要来源与正文合并后提供给分类器；已有总结若对应旧材料则不会作为当前总结进入目录/报告，重新执行 `summarize-conf` 只更新材料发生变化的记录。未补全语料的既有断点保持原行为；这里的摘要补全不调用 LLM。

`GET /api/coverage` 根据当前本地档案统计覆盖率，不把已注册会议当作已采集语料。会议 CLI 的采集、摘要补全和总结任务会在 `top-conf/data/job_status/` 保存开始/结束、最近成功与安全的错误类别；不保存原始错误或认证 URL。开始后未留下结束记录时，页面明确说明未记录结束，不据此断言进程仍在运行。历史任务没有状态文件时显示未记录。覆盖率刷新读取已落盘的断点，统计与报告遵守同一公开/登录访问边界。

## 验证

```bash
make test                    # Go race tests 和 vet
make test-browser            # 构建 + 桌面、手机和 /news 的浏览器契约
pnpm --dir web format:check
FASTNEWS_PUBLIC_PATH=/news make build-release # Linux 原生发布构建
./scripts/package-release.sh # 仅打包 bin 和 React dist
```

测试使用临时账号目录，覆盖内容隔离、CSRF、恢复撤销会话、一次性凭证并发消费、每日推送幂等、事件事务回滚、vault 会话绑定、RAG 降级、离线简报、采集解析和摘要断点。浏览器测试使用真实 Go API 与仓库语料，账号操作不写入实际用户资料。

## 目录与部署

```text
cmd/fastnews/          服务、管理员与离线数据任务入口
internal/config/      环境配置
internal/store/       SQLite 账号、会话与个人内容
internal/identity/    FastCAS Go SDK、加密凭据与 Research 快照
internal/catalog/     语料、报告和资讯索引
internal/rag/         向量索引与 embedding provider
internal/ai/          证据约束生成、离线整理与统计
internal/httpapi/     HTTP、CSRF、静态报告和 SPA 适配
internal/jobs/        RSS、顶会、摘要、指标、HTML/PDF
web/src/              React 页面、组件、类型与 API 客户端
web/src/pages/ReportReader.tsx   原生报告阅读页
web/pnpm-lock.yaml    前端唯一依赖锁文件
deployments/         systemd、nginx 与 FastDeploy 原生配置样例
```

`Dockerfile` 提供 Go/React 多阶段构建，数据和账号分别挂载 `/data`、`/state`。子路径部署须在**前端构建时和后端运行时**使用相同的 `FASTNEWS_PUBLIC_PATH`。默认根路径，生产 `/news` 示例：

```bash
FASTNEWS_PUBLIC_PATH=/news make build
FASTNEWS_PUBLIC_PATH=/news FASTNEWS_PORT=8788 ./bin/fastnews serve
```

`ci.yml` 在 main 的 PR、推送和手动运行时执行 Go、React 与浏览器检查；推送 `v*` 标签时，对该提交完成相同校验后构建生产包，通过 HTTPS 接收端部署。GitHub Release 发布 job 已移除，不创建 Release 或上传 Release 附件。采集与报告生成由服务器执行，结果保存在独立语料目录。

旧 Python、serverless API、模板、静态应用页面、依赖和对应测试已删除。历史语料、报告与账号数据保留；历史报告资源 URL 由 Go 映射到当前前端资源。失效的旧部署与回滚入口已移除。main 提交只验证；版本标签触发正常部署，使用 FastDeploy 原子切换版本并检查健康，失败时恢复前态。配置见 [部署说明](docs/fastdeploy.md)。

页面统一使用简短路径：`/updates/`、`/brief/`、`/summary/`、`/trends/`、`/following/`、`/admin/jobs/`。人物与机构分别使用 `/authors/<name>/` 和 `/institutions/<name>/`；可选 `ref` 仅用于区分同名资料。旧页面路由已删除，不做别名或跳转适配；研究印象只使用弹窗。会议报告继续使用 `/top-conf/<conference>/<year>/`。
