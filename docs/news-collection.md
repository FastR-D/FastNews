# 新闻、安全与 AI 资讯采集

本轮将原安全资讯扩展为综合新闻、安全资讯、AI 资讯三个频道，保留独立的 arXiv 导读。公开页面仍是 `/secnews/`，可用 `?channel=news|security|ai&date=YYYY-MM-DD` 保留筛选。

## 当前科研范围

界面调整后已移除 BBC World 与 Hacker News 两路综合资讯源；旧归档中的这两个来源也不再由资讯 API 返回。当前启用配置 14 路，目录合并后 81 项。下方 213 条采集记录是移除之前的历史验收数据。

## 默认来源与配置

内置源定义于 `internal/catalog/news_sources.go`。仓库的 `config/news-sources.json` 增加 5 个机构 feed；使用其他 `FASTNEWS_ROOT` 时，应将需要的配置复制到该数据根目录的 `config/`，或传 `--sources-file`。

| 范围 | ID | 名称 | 本轮实测新增记录 |
| --- | --- | --- | ---: |
| news | bbc_world | BBC World | 31 |
| news | hackernews | Y Combinator Hacker News | 31 |
| security | bleepingcomputer | BleepingComputer | 0，HTTP 403 |
| security | thehackernews | The Hacker News | 50 |
| security | securityweek | SecurityWeek | 10 |
| security | krebs | Krebs on Security | 1 |
| security | trailofbits | Trail of Bits | 11 |
| security | cisco_talos | Cisco Talos | 8 |
| ai | openai | OpenAI News | 43 |
| ai | huggingface | Hugging Face Blog | 14 |
| ai | stanford_sail | Stanford AI Lab | 0，feed 条目均超过 90 天 |
| ai | berkeley_bair | Berkeley AI Research | 1 |
| ai | mit_ai | MIT News Artificial Intelligence | 13 |
| arxiv | arxiv_cs_cr | arXiv cs.CR | 0，feed 本次无条目 |
| arxiv | arxiv_cs_ai | arXiv cs.AI + cs.CL | 0，feed 本次无条目 |
| arxiv | arxiv_cs_se | arXiv cs.SE | 0，feed 本次无条目 |

2026-11-27 UTC 采集档案共有 **213 条新记录**：综合新闻 62、安全 80、AI 71，来自 11 个有新增的来源。`_id` 和原始链接均为 213 个唯一值。此数字是本轮采集结果，不是这些站点当天发表的全部文章；慢更新研究源窗口为 90 天。第一次运行暴露出部分博客 feed 返回多年历史，本轮加入了新鲜度过滤，只清理了本轮新建档案中过期的条目，未删除原有历史档案。

SAIL 主页与 feed 存在时效差异；BleepingComputer 的失败被报告并保留其他成功结果。arXiv 的空响应不能据此判断站点故障。没有调用 LLM 为这些新记录生成摘要/评分，页面会如实显示“尚未评分”。

## 运行

```bash
go build -o bin/fastnews ./cmd/fastnews
./bin/fastnews fetch-news                       # 默认 all
./bin/fastnews fetch-news --source news
./bin/fastnews fetch-news --source security
./bin/fastnews fetch-news --source ai
./bin/fastnews fetch-news --source arxiv
./bin/fastnews fetch-news --source mit_ai
./bin/fastnews fetch-news --source all --sources-file config/news-sources.json

# 后续处理；daily-summary / newspaper 使用已有模型配置，可能产生模型费用。
./bin/fastnews daily-summary --date 2026-11-27
./bin/fastnews newspaper
./bin/fastnews weekly-report --days 7 --pdf
```

`--source` 接受源 ID 或上述频道。单个源可以用 `--url` 临时替换 feed；组合范围不允许 `--url`，避免把同一 feed 误标为多个来源。

配置是 JSON 数组，按 `id` 合并内置源，新增源需提供 `url/channel`。下面是另建文件时的示例，不建议直接覆盖仓库中已有的机构源：

```json
[
  {"id": "bleepingcomputer", "disabled": true},
  {
    "id": "my_lab",
    "name": "My Lab",
    "url": "https://example.org/feed.xml",
    "channel": "ai",
    "max_age_days": 90
  }
]
```

`max_age_days` 为 0 或未指定时使用 14 天；-1 表示显式导入全部历史，其他值为最大回溯天数。无法解析/缺失发布时间的文章保留原始时间而不伪造；目前没有专门的未来日期异常规则。SAIL、BAIR、Trail of Bits 使用 90 天以匹配低频研究更新。未知配置字段、重复/非法 ID、非 HTTP(S) 或带用户名密码的地址、非法频道会直接报错。不要将凭据放进源 URL。

## 存储与行为

- `secnews/data/articles/YYYY-MM-DD.jsonl` 仍按 UTC **采集日**落盘；每行保存源 ID、`source_name`、固定 `channel`、原始发布时间、标题、描述、链接及稳定 ID。
- RSS description、Atom content、WordPress encoded 内容可作为描述，转为纯文本并去掉脚本/样式内容。此处理不等于事实核验或允许全文再分发。
- 一次批处理读取全历史档案，按 ID 与 URL 去重；URL 去重键移除 fragment、`utm_*` 等跟踪参数，存储时保留原始链接。
- 同一链接跨源只保存一条记录，尚不保存所有转载者列表；不同链接报道同一事件仍可能多条存在。这不是事件聚类。
- 一个来源失败不阻止其余来源；成功记录先落盘，最终返回汇总错误/非零退出码。重复运行不会因为旧的 7 天窗口失效而再次导入旧文。
- 采集 CLI 与只读信源目录 API 共用配置解析；读取目录不会请求外部来源。没有新增可被网页调用的写入/爬虫接口，也没有把 Telegram 会话放进 Web 服务。
- 独立采集进程之间目前没有档案写锁，应按现有 workflow 串行运行；数据量很大时全档案去重可进一步迁移到持久化索引。

## API 与兼容性

`GET /api/news` 的 `source` 范围：

| source | 返回范围 |
| --- | --- |
| 省略 / all | 全部资讯，兼容总览 |
| articles | 全部非 arXiv 资讯 |
| news | 综合新闻 |
| security | 安全资讯 |
| ai | AI 资讯 |
| arxiv | arXiv 预印本 |

未传日期时，各范围各自寻找最近非空采集日；传日期时保留该日期，即使结果为空。**兼容性变化：`source=security` 现在严格表示安全频道，旧的“所有非 arXiv”调用应改为 `source=articles`。** 旧档案按已知来源补齐分类和展示名称；旧模型生成的分类不会覆盖原始来源分类。

既有 GitHub Actions 已调用 `fetch-news --source all`，代码合并并使用对应配置后会覆盖扩展源。定时表达式未改：采集 06:00 UTC、摘要 22:30 UTC、周报周六 06:00 UTC。本轮只在本地运行，未推送、部署或验证远端定时执行。

## 信源目录与阅读

`/sources/` 纳入调研文档中的 78 个来源条目，保留社区推荐帖子、官方地址、核验日期及候选说明。与当前采集配置合并后为 81 项，其中 14 路启用配置；配置来源不自动标为已核验。CVE、Telegram 等候选收录不代表已经接入采集。条数来自最近单日归档，不代表最近一次请求成功率。

`/secnews/` 支持频道、关键词、来源、排序、20 条分页和独立阅读；筛选状态保存在 URL。默认显示最多 10 条推荐，有评分时优先展示评分内容，无评分时按发布时间排序。原文始终通过单独链接访问。

## 验证记录

- `make test`：Go 全量 race tests 与 vet 通过。
- React TypeScript/Vite 根路径与 `/news` 构建通过。
- 前次 Playwright 全量回归 **47 项通过、2 项按项目跳过**，覆盖桌面、手机、`/news` 子路径及登录模式；阅读与信源目录另有 6 项定向回归，检查筛选、分页、来源出处、320px 顶栏控件边界及亮暗模式截图。
- 配置、频道、全历史去重、跟踪参数、过期过滤、HTML 正文、逐源失败与 API 最近非空日均有对应测试。
- 可选 Telegram 本地读取器的配置校验、私有快照权限、来源链接测试通过；没有真实 Telegram 登录/联网验收。

前端完整验证等价命令（在 `web/` 内运行，避免根目录的 Corepack 选择其他 pnpm 版本）：

```bash
FASTNEWS_PUBLIC_PATH=/ pnpm build
FASTNEWS_PUBLIC_PATH=/news pnpm exec vite build --outDir dist-news
pnpm test
```

上述全量回归在新增机构配置与实际档案之后完成；前端格式检查、配置 JSON 和本地文档链接检查也通过。CVE API、事件聚类、源健康面板和 Telegram 到公开资讯库的导入均尚未实现。
