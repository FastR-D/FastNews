# FastNews 同类产品与开源项目调研

调研日期：2026-11-27。网站检索、原帖阅读和官网核验使用 Edge 的 ChatGPT 扩展。阅读了本仓库的 Go 采集、摘要、报告、目录/API、React 页面及定时任务；以下产品能力来自当日可见的 README、产品页或价格页，未购买或完整部署第三方服务。价格是页面快照，不含税费和未来变更。

配套文档：[信源调研与出处](source-research-2026-11-27.md)、[已落地采集与操作说明](news-collection.md)、[Telegram 读取方案](telegram-sources.md)。

## 结论

FastNews 最适合继续做“可追溯资讯 + 研究语料 + 个人研究工作台”。已有会议/arXiv 语料、证据约束简报、关注作者、每日站内推荐和账号体系，不能只用热榜聚合器衡量。当前最值得借鉴的是 AIHOT 的事件聚合与编辑流程、ClawFeed 的信源包和分时摘要、Elicit 的持续研究任务，以及 Feedly 的漏洞/威胁实体关联。

本轮已先完成新闻、安全、AI 资讯的配置化采集和分类入口。事件级聚类、基于兴趣的多渠道通知、CVE 实体库和信源健康面板仍是后续工作，不能把本轮 RSS 扩容写成这些能力已经上线。

## FastNews 基线与差距

| 维度 | 调研前的实现 | 本轮与后续判断 |
| --- | --- | --- |
| 输入 | 3 个安全媒体 RSS、3 个 arXiv 订阅；安全/ML/SE 会议数据 | 本轮扩至 16 路配置，包含综合新闻、AI 官方博客和学术机构；详见实测记录 |
| 内容处理 | 原始档案、逐篇摘要检查点、日报/周报；ID 与链接去重 | 本轮补全历史去重、跟踪参数归一化、源级分类和过期文章过滤；事件聚类未实现 |
| 研究 | 向量检索、领域导读、全景/主题简报、论文证据 | 保持优势，加入“新资讯关联已有论文”比单纯扩大热榜更有价值 |
| 趋势 | 本地 arXiv 档案相邻 7/14/30 天的方向占比 | 是语料变化，不是全网热度或引用影响力 |
| 个性化 | 研究印象、关注作者、上海日历日每日一篇站内私信 | 尚不是邮件、Telegram 或企业 IM 订阅推送 |
| 部署 | Go/React、SQLite、离线 CLI、GitHub Actions | 继续配置驱动；浏览器 API 不触发采集任务 |

## 开源与公开项目

| 项目 / 一手来源 | 已核验的主要能力 | 开放范围与部署 | 对 FastNews 的价值和限制 |
| --- | --- | --- | --- |
| [AIHOT](https://github.com/KKKKhazix/AIHOT) | RSS、网页列表、JSON、X、微信、外部推送；预筛选、双次打分、中文编译、同事件聚合、热度、日/周/月报、后台审核 | 代码 MIT；Node/TypeScript、React Router、Fastify、PostgreSQL、pg-boss、Docker。品牌和字体另有约束 | 新闻引擎最接近。可学习合并判定和人工复核。仓库提供 18 个海外 AI 演示源，不是线上全部信源/数据；部分线上专属功能未开放 |
| [TrendRadar](https://github.com/sansan0/TrendRadar) | 多平台热榜、RSS/Atom、关键词/AI 筛选、定时网页搜索、摘要与多平台推送 | GPL-3.0；Docker/GitHub Actions；页面显示 6.12.0 | 借鉴快速配置、增量/当前/日报模式和通知矩阵。热榜排名与研究证据可靠性是不同指标 |
| [ClawFeed](https://github.com/kevinho/clawfeed) | RSS、Twitter、HN、Reddit、GitHub Trending 等来源；信源包、多用户、收藏、深挖、4 小时/日/周/月摘要、RSS/JSON 输出 | MIT；Node/SQLite；可独立部署或配合 Agent Skill | 信源包、阅读工作流与 FastNews 互补；不能仅凭 README 推断独立部署时所有 Agent 生成流程都会自动完成 |
| [ArxivDigest](https://github.com/AutoLLM/ArxivDigest) | 自然语言兴趣、arXiv 分类、LLM 相关性评分、HTML 邮件、SMTP/SendGrid、CLI/Gradio/GitHub Actions | MIT | 可借鉴个性化论文邮件。README 存在旧模型配置和未完成路线图，需单独验证维护与兼容性 |
| [RSSHub](https://github.com/DIYgod/RSSHub) | 将大量网站转换为 RSS，路由与自托管采集 | 当日仓库为 AGPL-3.0 | 适合作输入适配层。路由存在不代表知乎/小红书当前可匿名稳定抓取；不替代摘要、研究库与权限体系 |
| [Folo](https://github.com/RSSNext/Folo) | RSS/Atom/JSON、RSSHub、Newsletter Inbox、OPML、规则；AI 问答、摘要/翻译、定时简报、阅读工具连接 | 客户端 AGPL-3.0；图标等附加约束 | 借鉴信源组织和阅读体验。开源客户端不等于所有云端服务均可完整自托管 |
| [AI Safety HOT](https://github.com/wuyoscar/AISafetyHot) / [网站](https://aisafetyhot.com/zh) | AI 安全论文、新闻、事件、分类索引、日报、RSS/Newsletter，公开资料与技能入口 | 看到了公开归档/资源仓库，未核实完整后端源码 | 垂直安全领域的编辑分类有参考价值。“800+ 源”来自作者推广，未逐一验证；不能写成已审计的源规模 |
| [news-digest](https://github.com/alxyrgin/news-digest) | Telegram 用户账号读取 + RSS；LLM 过滤分类、日/周报、问答、收藏、费用跟踪、Bot 输出 | MIT；Python 3.12、Telethon、aiogram；单用户为主 | 提供“用户账号收、Bot 发”的实现参照。仅阅读 README，未执行或审计其代码；采用前仍需核对 Telegram 内容条件 |

AIHOT 的 [RSS/API 说明](https://aihot.news/agent?tab=rss) 还值得单列：精选、全量、日/周/月报有不同 feed；提供 ETag/304 并建议约 30 分钟轮询。当前站点是 `aihot.news`，旧域名与旧 `/api/public/*` 入口不能直接照搬。其公开内容的对外复用需要另行授权，代码 MIT 不等于资讯内容可批量转载。本轮没有把它作为默认公开入库源。

## 商业产品

| 产品 / 一手来源 | 对应需求与已见功能 | 价格页快照 | 借鉴重点 |
| --- | --- | --- | --- |
| [Feedly Threat Intelligence](https://feedly.com/threat-intelligence/pricing) | 威胁情报聚合；CVE、攻击组织、恶意软件、TTP/IOC 关联；带引用报告、Ask AI；MISP/OpenCTI/XSOAR/STIX 等集成依套餐而定 | 联系销售。Standard 50 个 AI Feeds、5 个模板；Advanced 100/10，并扩展报告与集成 | 从“文章列表”转向“实体—事件—证据”。不要虚构公开统一美元价格 |
| [Inoreader](https://www.inoreader.com/pricing) | RSS、网页监控、Newsletter、监测源、规则、过滤、AI 阅读 | Free 150 个 RSS；Pro 2,500 个 RSS，年付折合 $7.50/月或月付 $9.99；情报报告/邮件摘要有额外付费项 | 配置、规则、源健康和成熟阅读器体验；不是科研语料工作台 |
| [切问 WisPaper](https://qiewenpaper.com/zh/pricing) / [产品](https://qiewenpaper.com/zh/home) | 自然语言文献检索、文献库、综述、知识图谱、Feeds 持续追踪，研究 Agent | 月付 Plus ¥35、20,000 credits/10 GB；Pro ¥150、200,000 credits/50 GB | 用自然语言维护研究主题、持续发现论文。宣传准确率不是本次验证结果 |
| [Elicit](https://elicit.com/pricing) / [Routines](https://elicit.com/solutions/routines) | 文献检索、证据报告、系统综述、提取表；Routines 定时监测变化，更新研究产物并保留运行/来源 | 调研时 Industry 年付选项中 Pro $49/人/月（年付 $588），含 Routines；Scale $229/月（年付 $2,748）；另有免费档 | 最值得借鉴“持续问题 → 新证据 → 更新报告”的闭环，而不是每天重复生成同一份概览 |
| [AIBase](https://www.aibase.com/) / [资讯](https://news.aibase.com/zh) | AI 新闻、产品目录、排行、热点和会员/商业入口 | 未核实可稳定引用的统一会员价格 | 作为中文资讯发现入口；更接近内容门户，不能视作已经可自托管的私有采集系统 |

## 社区原帖提供的需求证据

这些是定性样本，包含作者推广，不代表市场份额或全体用户意见。

| 原帖 | 观察到的需求 | 对实现的启发 |
| --- | --- | --- |
| 小红书云舒：[论文推荐自动化](https://www.xiaohongshu.com/search_result/69f8a989000000003502da40)；通过站内搜索阅读，页面显示 05-04，未显示年份 | arXiv 信息过载、公共推荐夹杂推广、黑箱遗漏小众工作、手机/电脑工作流切换 | 每条推荐展示入选理由与来源，保留不依赖热点排名的细分领域订阅；分享链接可能要求登录/签名 |
| 小红书 wuyoscar：[AI safety 资讯工具](https://www.xiaohongshu.com/search_result/6ac68329000000001901ffb5)；页面显示编辑于 10-10，未显示年份 | 作者介绍多源汇总、处理成本与日报；评论讨论 AIHOT 基础和 API/Agent 配置 | 垂直领域比全平台抓取更容易形成用途；源数量需要实际验证 |
| 知乎工藤正男：[科研 AI 工具回答](https://www.zhihu.com/question/666179553/answer/2034044420224500869)，2026-05-02 发布、11-19 编辑 | 持续论文 Feeds 和知识库 Agent；链接含推广性质 | 可作为需求发现，不能作为独立产品效果评测 |
| 知乎数字生命卡兹克：[AIHOT 作者介绍](https://zhuanlan.zhihu.com/p/2036057281629003792)，2026-05-08 | 信源筛选、去重、评分和多形态摘要 | 当前功能和许可仍以仓库及官网为准 |
| [Reddit：实质性 ML 内容来源](https://www.reddit.com/r/MachineLearning/comments/1ko64s6/d_who_do_you_all_follow_for_genuinely_substantial/) | 希望少看炒作，多看论文、工程解读与研究者一手内容 | 原文与评论推荐来源分开记，回到一手页面核验 |
| [Reddit：常用论文/资讯 feeds](https://www.reddit.com/r/MachineLearning/comments/1fpo0z8/d_which_feeds_do_you_look_at/) | 个性化论文、HF Papers、newsletter，同时抱怨广告噪声 | “源质量 + 个人主题”双层筛选比单一热度榜更适合研究 |

## 建议的产品路线

1. **本轮已做：配置化采集。** 综合新闻/安全/AI 分栏、来源名、全历史 ID/URL 去重、默认 14 天新鲜度、逐源失败隔离；慢速研究博客可单独扩大窗口。保留 CLI 和既有日报/周报入口。
2. **下一步：质量可观测。** 每源最近尝试/成功/新增、连续空数据、HTTP 错误、feed 与主页时效差异、原文链接覆盖率。SAIL 的 RSS 滞后和 BleepingComputer 的 403 是已经观察到的验收案例。
3. **随后：事件与研究关联。** 将同一 CVE、论文、模型发布的多篇文章合并；保留首发、补充报道、纠正和出处链。不要用标题相似就删除不同观点。
4. **持续主题简报。** 借鉴 Elicit Routines：保存问题、关注的实体/源、上次结论及新证据，用可验证变化触发简报。给每个主题设条数和模型费用上限。
5. **通知与外部通报。** 先验证一到两个目的明确的订阅；账号读取和外发 Bot 分开。Telegram、公众号和第三方摘要先确认具体内容使用方式，避免丢失原出处或把二手总结当原始事实。

本轮没有购买产品、发送外部消息、加入 Telegram 群或部署到生产，也没有对第三方宣传的准确率、节省时长、信源规模作独立背书。
