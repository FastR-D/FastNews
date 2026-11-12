# FastNews

安全研究报告工作台：Go 后端与 React / TypeScript 前端分离，前端使用 **FastUI 0.3.0**。总览、安全资讯、四大顶会论文、领域导读、总结汇报、关注作者、每日私信及账号管理共用同一套 JSON API。

## 开发

要求 Go 1.26（模块固定 toolchain 1.26.8）、C 编译器（SQLite）、Node 22+、pnpm 10.33.0。

```bash
make install
cp .env.example .env
make build
# 环回 HTTP 开发允许非 Secure Cookie；生产保持 true。
FASTNEWS_COOKIE_SECURE=false ./bin/fastnews serve
```

打开 `http://127.0.0.1:4173`。报告默认公开；个人内容需要登录。设置 `FASTNEWS_REQUIRE_LOGIN=true` 后报告页面也要求会话。

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
| 顶会报告 | `/top-conf/` | 会议/年份/类别筛选、向量搜索、分页、related work、报告打开与下载 |
| 领域导读 | `/field-briefing/` | 印象补全方向、向量召回、分类综述、综述/SoK、论文推荐 |
| 总结汇报 | `/summary-brief/` | 全景或主题简报、发现、统计表与条形图、问答、局限与讨论 |
| 安全资讯 | `/secnews/` | 资讯日历、Top 10、BleepingComputer/arXiv 频道、价值分、详情折叠 |
| 关注作者 | `/authors` | 增删改、研究标签、主页解析、解析结果与论文链接 |
| 私信 | `/inbox/` | 上海日历日每天一篇、关注作者优先、去重、已读和历史 |
| 研究印象 | `/impression/` 或顶栏 | 最长 4000 字，按当前账号保存 |
| 账号 | `/login` | 本地登录、邀请注册、恢复、FastCAS、Research 导入及持续连接 |

原 `/index.html`、各栏目 `/index.html`、`/auth/login`、`/auth/account` 和 `?date=YYYY-MM-DD` 继续可用。原 `top-conf/data/report/`、`secnews/data/report/` 下的 HTML/PDF 地址保持；`?download=1` 返回附件。主题、可折叠导航和手机布局由 React 管理，控件、弹窗、状态与语义色由 FastUI 提供。

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

Research Key 导入为显式快照复制，不保存 Key 或临时 Research 会话；默认拒绝覆盖已有本地内容。可选委托读取需要 FastCAS consent、`research:read` / `offline_access` 和独立的 32 字节 AES-GCM vault key。详见 [迁移与验收](docs/go-react-migration.md) 和 [账号与 FastCAS](docs/fastcas-integration.md)。

FastRead 保留现有授权边界：Research 会话申请 `fast-read` 一次性票据；本地账号未具备相应跨产品授权时明确返回 409，不转发本地会话、不把个人 Key 放进 URL。

## 向量检索与生成

领域导读、总结汇报、related work、论文搜索和每日推送使用同一套向量检索。默认离线哈希向量；设置 `RAG_EMBEDDING_URL` 和 `EMBEDDING_MODEL` 可接 OpenAI 兼容 embeddings。远端失效时同时重建语料和查询的离线向量，避免混用不同空间。

配置 `OPENAI_API_KEY`、可选的 `OPENAI_BASE_URL` 和 `LLM_MODEL` 后启用生成。未配置或生成失败时，领域导读与总结汇报仍展示**明确标记的本地证据整理和真实统计**。related work 的模型解释仍需要 LLM。引用次数和奖项仅显示已有元数据。

```bash
./bin/fastnews search-papers --query 'LLM jailbreak' --limit 16  # 只读 JSON 检索
./bin/fastnews field-briefing --query 'LLM jailbreak' --limit 5 --format text
./bin/fastnews summary-brief --query '四大顶会全景'
```

## Go 数据任务

现有 JSON/JSONL 无需转换，CLI 按原目录与命名写入。任务可从仓库根目录运行，或设置 `FASTNEWS_ROOT` 指向语料目录。默认 Web 服务没有可触发这些写入任务的 HTTP 接口。

```bash
./bin/fastnews fetch-news --source bleepingcomputer
./bin/fastnews fetch-news --source arxiv_cs_cr
./bin/fastnews fetch-news --source arxiv_cs_ai
./bin/fastnews daily-summary                       # 最新资讯日期
./bin/fastnews daily-summary --date 2026-09-04
./bin/fastnews daily-summary --all                 # 全历史，逐篇保存检查点
./bin/fastnews newspaper
./bin/fastnews weekly-report --days 7 --pdf

./bin/fastnews fetch-conf --conference usenix --year 2026
./bin/fastnews summarize-conf --conference usenix --year 2026
./bin/fastnews conference-report --conference usenix --year 2026 --pdf
./bin/fastnews update-range --since 2023 --until 2026
./bin/fastnews fetch-awards --conference ieee-sp --year 2026
./bin/fastnews enrich-metrics --conference usenix --year 2026 --limit 12
./bin/fastnews index
```

会议支持 `usenix / ieee-sp / ndss / ccs`，采集地址可通过 `--url` 指定。官方页面改版导致解析不到论文时返回错误，不用空结果覆盖历史文件。新闻以 ID / URL 去重，论文摘要按 ID 续跑，日报保持原 `source_hash` 检查点算法。`enrich-metrics` 使用 OpenAlex 并要求标题规范化后完全匹配。

HTML 报告由 Go 模板生成。PDF 使用 Chromium，通过 `FASTNEWS_CHROME` 指定可执行文件；不请求 PDF 时不需要浏览器。周报同时输出到 `output/` 及 `secnews/data/report/`。CI 的采集、摘要与报告工作流已改为 Go CLI。

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
web/public/reports/   新生成与历史报告共用的阅读跳转资源
web/pnpm-lock.yaml    前端唯一依赖锁文件
deployments/         systemd、nginx 与 FastDeploy 原生配置样例
```

`Dockerfile` 提供 Go/React 多阶段构建，数据和账号分别挂载 `/data`、`/state`。子路径部署须在**前端构建时和后端运行时**使用相同的 `FASTNEWS_PUBLIC_PATH`。默认根路径，生产 `/news` 示例：

```bash
FASTNEWS_PUBLIC_PATH=/news make build
FASTNEWS_PUBLIC_PATH=/news FASTNEWS_PORT=8788 ./bin/fastnews serve
```

`ci.yml` 在 PR、main、`v*` 标签和手动运行时执行 Go、React 与浏览器检查并打包；推送 `v*` 标签会在检查通过后发布同一份原生包到 GitHub Releases，并调用固定版本的 FastDeploy 部署到 fastrd。其余四个工作流负责采集、日报、顶会报告和周报，统一调用 Go CLI，并串行提交生成数据。

旧 Python、serverless API、模板、静态应用页面、依赖和对应测试已删除。历史语料、报告与账号数据保留；历史报告资源 URL 由 Go 映射到当前前端资源。失效的旧部署与回滚入口已移除。普通 main 提交只验证；标签部署由 FastDeploy 原子切换版本并检查健康，失败时恢复前态。配置见 [部署说明](docs/fastdeploy.md)。
