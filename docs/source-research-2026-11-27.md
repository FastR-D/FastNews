# 新闻、安全、AI 与学术信源调研

调研日期：2026-11-27。检索与阅读均通过 Edge 的 ChatGPT 扩展。此文的重点是**用户汇总过哪些信源，以及这些信源能否实际使用**，不是把“知乎、Reddit”笼统登记为资讯来源。

发现路径保留为“社区原帖 → 推荐的上游 → 官方页面/订阅验证 → 是否接入”。社区推荐是发现证据，不能替代上游真实性、时效、内容许可与采集可用性的验证。平台赞数、作者自称的源数量、搜索摘要均不作为可靠性评分。

状态定义：**已采集**表示本轮已有新记录落盘；**已配置**表示采集器支持且地址已登记，但本轮可能无新增或失败；**页面核验**表示阅读了上游官网，不等于验证了订阅接口；**候选**只在原帖/清单中发现，尚未逐一打开上游。建议优先级是本次判断，非网站官方评级。

## 先选这几组

| 用途 | 优先来源 | 原因与处理方式 |
| --- | --- | --- |
| 漏洞事实与优先级 | CVE List V5、NVD、CISA KEV、OSV | 四者分别解决编号记录、评估、已知在野利用、开源包受影响范围，不能互相替代；需要 JSON/API 适配，未伪装为 RSS 已接入 |
| 安全新闻 | Krebs、The Hacker News、SecurityWeek、BleepingComputer | 同时出现在中文/英文社区推荐中；保留记者/媒体出处；BleepingComputer 本次采集 403 |
| 安全研究 | Trail of Bits、Cisco Talos；候选 Unit 42、Quarkslab、Citizen Lab、PortSwigger Research | 研究方法、漏洞细节和检测依据比转述新闻更接近一手；前两项已采集 |
| AI 官方发布 | OpenAI、Hugging Face；DeepMind、Anthropic 作为补充 | 一手产品/研究变化可靠，但产品效果仍需独立证据；前两项已采集 |
| 学术团队 | MIT AI、BAIR、SAIL、Transformer Circuits | 校方/研究组研究动态；慢更新源按研究周期设置窗口，不能简单按日更淘汰 |
| 人工精选/解释 | Lil’Log、科学空间、Raschka、Import AI、Interconnects、Latent Space AI News | 用于发现与理解论文，再回到论文/代码；本轮主要列候选，不能混称全部接入 |
| Telegram 通报 | `cibsecurity`、`cyber_security_channel` | 已核验公开预览及近期消息；前者有原媒体链接，后者含广告。用于个人读取试点，不自动送入公开/AI 管线 |

## 用户汇总的出处索引

后面表格的 Z/R/T 编号对应本节原帖，便于追踪来源。相对时间保留原页面显示，不倒推出不确定的日期。

| 编号 | 原帖与作者 | 时间/性质 | 提供的线索 |
| --- | --- | --- | --- |
| Z1 | 强化学徒：[AI 领域有哪些值得关注的博主或网站？](https://www.zhihu.com/question/439891521/answer/3394027625) | 2024-02-12 发布、2025-04-23 编辑；个人经验 | Lil’Log、科学空间、CoolPapers、HF Papers、MIT News、智源汇总、研究者/实验室账号 |
| Z2 | 星尘安全：[十个获取海外网络安全资讯的最佳网站](https://zhuanlan.zhihu.com/p/718174636) | 2024-09-04；媒体推荐清单 | Krebs、SecurityWeek、THN、Dark Reading、SC Media、BleepingComputer、Threatpost、CSO、Security Boulevard、Infosecurity Magazine |
| Z3 | 网络研究观：[网络安全开源情报源（书签收藏夹）](https://zhuanlan.zhihu.com/p/16541522067) | 2025-01-05 编辑；大型书签 | 大量安全厂商、研究组、CERT、漏洞与日报站；混有重复、过时和不相关条目，仅选取本任务所需部分 |
| Z4 | 越哥聊 AI：[高质量的 AI 技术网站、社区、博客](https://zhuanlan.zhihu.com/p/1889713359533889288) | 2025-03-30；分类推荐 | 官方研究博客、AI 社区、The Gradient、Alignment Forum、LessWrong、课程和研究报告 |
| Z5 | 程启烨：[AI 前沿技术博客与动态网站盘点](https://zhuanlan.zhihu.com/p/2062748683502883827) | 2026-07-21；个人清单 | Transformer Circuits、DeepMind Research、Distill、Alignment Forum；文中夸大/错误型号不采纳 |
| Z6 | Dong Shaoyang：[51 个 AI 信息源阅读地图](https://zhuanlan.zhihu.com/p/2093292723524654340) | 2026-10-13 编辑；X 账号分类 | 按研究、安全、工程、产品、商业拆分阅读目标；Raschka、Karpathy、Lil’Log、swyx、LiteLLM、Chroma 等线索 |
| Z7 | 梁川：[Telegram 搜索机器人汇总](https://zhuanlan.zhihu.com/p/705762707) | 2024-06-27 编辑；搜索工具清单 | Telegram 索引 bot，不能当成已经验证的新闻 bot |
| R1 | [r/cybersecurity：Best News Sources](https://www.reddit.com/r/cybersecurity/comments/1oiy7ik/best_news_sources/) | 页面显示约 1 年前；用户问答 | BleepingComputer、Ars Technica、Daily Cyberwire；包含自推广与个人好恶 |
| R2 | [r/cybersecurity：可靠资讯源与付费意愿](https://www.reddit.com/r/cybersecurity/comments/1xzmlp9/what_are_your_favorite_and_most_reliable_new/) | 页面显示 9 天前；用户问答 | Krebs、The Hacker News，Security Now、Hacked、Risky Business、Darknet Diaries 等播客 |
| R3 | [r/MachineLearning：实质性 ML 内容](https://www.reddit.com/r/MachineLearning/comments/1ko64s6/d_who_do_you_all_follow_for_genuinely_substantial/) | 页面显示约 2 年前；用户问答 | smol.ai、Raschka、Cameron Wolfe、Ruder、Import AI、HF Papers、研究者与播客 |
| R4 | [r/MachineLearning：常用 feeds](https://www.reddit.com/r/MachineLearning/comments/1fpo0z8/d_which_feeds_do_you_look_at/) | 页面显示约 2 年前；用户问答 | ScholarInbox、HF Papers、arXiv/OpenReview、AlphaSignal、Interconnects、Cerebral Valley、PyTorch、The Journal Club |
| T1 | SentinelOne：[Telegram 网络安全社区清单](https://www.sentinelone.com/blog/top-10-telegram-cybersecurity-groups-you-should-join/) | 2023-01-17 更新；厂商编辑文章 | 10 类频道/讨论群。清单较旧，本轮另核验其中两个公开频道，不沿用旧订阅人数 |
| T2 | [mehrazino/tg-cybersec](https://github.com/mehrazino/tg-cybersec) | 社区维护仓库 | Telegram 网络安全目录；README 明示有置顶赞助、与频道无隶属关系，不能把排名当可靠性保证 |

小红书的研究自动化和 AI Safety HOT 原帖也已阅读，需求证据与链接见[竞品报告](competitive-research-2026-11-27.md)。其“800+”等数字仅为作者陈述，未导入为已验证源数量。

## 漏洞、CERT 与结构化安全数据

以下“官方补充核验”是为了满足 CVE 需求主动检查的一级来源，未虚构成某个 Reddit 用户推荐。

| 来源 | 发现路径 | 已核验或拟用的入口 | 状态与边界 |
| --- | --- | --- | --- |
| [CVE Program](https://www.cve.org/Downloads) | 官方补充核验 | [cvelistV5](https://github.com/CVEProject/cvelistV5) JSON V5；每日基线、小时增量 | 页面核验。旧 CSV/XML 等格式已于 2024-06-30 结束支持；需独立适配器 |
| [NVD](https://nvd.nist.gov/developers/vulnerabilities) | 官方补充核验 | `https://services.nvd.nist.gov/rest/json/cves/2.0`，分页与修改记录 | 页面核验。CVSS/CWE/CPE 等评估不等于已实际被利用；限流/key 策略接入前再按官方要求配置 |
| [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) | Z3 CISA 线索 + 官方补充核验 | [官方 JSON](https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json) / CSV | 页面核验。确认在野利用的优先级输入；不在 KEV 中不代表不存在利用 |
| [OSV](https://osv.dev/) | 官方补充核验 | `https://api.osv.dev/v1/query`，按包版本/commit 查受影响范围 | 页面核验。适合依赖漏洞，与泛新闻分库；支持生态来源与别名关联 |
| [JVN](https://jvn.jp/) | Z3 | 日本漏洞通报 | 候选；待验证 feed、语言和更新频率 |
| [GitHub Security Advisories](https://securitylab.github.com/advisories/) | Z3 | Security Lab 公告 | 候选；与 GHSA 全量数据库是相关但不同入口 |
| [Snyk Vulnerability DB](https://security.snyk.io/vuln) | Z3 | 包/漏洞库 | 候选；核对服务条款与 API 后接入 |
| [huntr](https://huntr.com/) | Z3 | AI/ML 等软件漏洞披露 | 候选；需要区分披露、赏金、修复与厂商确认 |
| [FIRST](https://www.first.org/) | Z3 | 标准、事件响应社区，可进一步核验 EPSS | 候选；本轮未实现 EPSS 接口 |
| [360 CERT](https://cert.360.cn/) | Z3 | 中文预警与分析 | 候选；需核验稳定订阅入口 |
| [JPCERT/CC Incident](https://blogs.jpcert.or.jp/en/incident/) | Z3 | 官方事件分析博客 | 候选；优先于无出处中文转载 |
| [Inthewild](https://inthewild.io/feed)、[CVECrowd](https://cvecrowd.com/)、[CVEShield](https://www.cveshield.com/) | Z3 | 社区聚合/漏洞发现线索 | 候选；不与 CVE/NVD/CISA 官方记录同等级使用 |

建议数据模型将 `cve_id`、受影响产品/版本、发布时间、更新时间、CNA/NVD 评分来源、KEV 加入日期、原始公告 URL 分开。相同 CVE 的新利用证据或厂商修复应作为更新保留，不应被普通文章 URL 去重吞掉。此模型是设计建议，尚未落地。

## 安全媒体与研究机构

| 来源 | 发现路径 | 本轮核验/接入 | 选择理由或风险 |
| --- | --- | --- | --- |
| [Krebs on Security](https://krebsonsecurity.com/) | Z2、R2 | 已采集；`/feed/` | 原创调查与评论，更新未必每日 |
| [The Hacker News](https://thehackernews.com/) | Z2、R2 | 已采集；现有 FeedBurner feed | 安全新闻；与 Y Combinator Hacker News 不是同一站 |
| [SecurityWeek](https://www.securityweek.com/) | Z2 | 已采集；`/feed/` | 安全行业与事件报道 |
| [BleepingComputer](https://www.bleepingcomputer.com/) | Z2、R1 | 已配置；本次 HTTP 403，无新增 | 返回错误而非绕过访问限制；其他源继续落盘 |
| [Dark Reading](https://www.darkreading.com/) | Z2 | 候选 | 研究/企业安全媒体，需筛分广告与编辑报道 |
| [SC Media](https://www.scmagazine.com/) | Z2 | 候选 | 行业新闻，待核验稳定订阅 |
| [CSO](https://www.csoonline.com/) | Z2 | 候选 | 管理与产业视角，部分内容可能有访问限制 |
| [Security Boulevard](https://securityboulevard.com/) | Z2 | 候选 | 含联合发布，必须保留原作者并跨站去重 |
| [Infosecurity Magazine](https://www.infosecurity-magazine.com/) | Z2 | 候选 | 安全新闻，待 feed 实测 |
| [Threatpost](https://threatpost.com/) | Z2 | 历史清单候选，未确认当前时效 | 不因旧清单“最佳”就直接默认启用 |
| [Trail of Bits](https://blog.trailofbits.com/) | Z3 | 官网核验且已采集；`/index.xml`，90 天窗口 | 软件安全、审计、密码学、供应链与 AI 工程；低频深度源 |
| [Cisco Talos](https://blog.talosintelligence.com/) | Z3 | 官网核验且已采集；`/rss/` | 威胁研究、漏洞和研究组通讯；含不同内容栏目 |
| [Unit 42](https://unit42.paloaltonetworks.com/) | Z3 | 候选 | 威胁研究团队；与厂商产品宣传分开 |
| [Quarkslab](https://blog.quarkslab.com/) | Z3 | 候选 | 逆向、密码学、漏洞研究 |
| [Mandiant](https://www.mandiant.com/resources/blog) | Z3 | 候选；需核验迁移后的规范 URL | 威胁情报与事件响应研究 |
| [PortSwigger Research](https://portswigger.net/research/articles) | Z3 | 候选 | Web 安全一手技术研究 |
| [DEVCORE](https://devco.re/en/blog/) | Z3 | 候选 | 漏洞与攻防研究，有中英文重复内容需去重 |
| [NCC Group](https://research.nccgroup.com/category/public-reports/) | Z3 | 候选 | 公开安全研究报告 |
| [Citizen Lab](https://citizenlab.ca/) | Z3 | 候选 | 学术研究团队，数字威胁与公民社会议题 |
| [腾讯科恩实验室](https://keenlab.tencent.com/zh/) | Z3 | 候选 | 安全研究组，注意历史内容与最新动态区别 |
| [奇安信 XLab](https://blog.xlab.qianxin.com/) | Z3 | 候选 | 恶意软件、僵尸网络等研究 |
| [inforsec](https://www.inforsec.org/wp/) | Z3 | 本次导航超时，未完成官网核验 | 中文学术安全社区线索，保留候选不宣称可用 |
| [腾讯安全每日资讯](https://sectoday.tencent.com/info-today)、[sec.today](https://sec.today/pulses/) | Z3 | 候选 | 二次编辑摘要，需要追原文 |
| [ufofly/yarb](https://github.com/ufofly/yarb/blob/main/today.md) | Z3 | 仓库入口核验；仅确认“每日安全资讯”定位 | 不把简短 README 推断成完整可复用采集系统 |

R1/R2 还提供 Ars Technica、Daily Cyberwire 以及 Security Now、Hacked、Risky Business、Darknet Diaries 等播客线索。本轮未验证其全部 feed、字幕/音频使用条件，不计入已接入来源。

## AI、论文与学术团队

| 来源 | 发现路径 | 本轮核验/接入 | 适合的内容 |
| --- | --- | --- | --- |
| [OpenAI News](https://openai.com/news/) | Z4 + 官方 | 已采集；`/news/rss.xml` | 模型、产品与研究官方发布 |
| [Hugging Face Blog](https://huggingface.co/blog) | Z4 | 已采集；`/blog/feed.xml` | 模型、数据集、工程实践；作者可能为社区贡献者 |
| [Google DeepMind Research](https://deepmind.google/research/) | Z4、Z5 | 页面核验，含 publications、frontier safety 入口 | 官方论文与研究，未接入网页采集 |
| [Transformer Circuits](https://transformer-circuits.pub/) | Z5 | 页面核验，明确为 Anthropic 可解释性团队；看到 2026-10 更新 | 机制可解释性一手研究；低频更新有价值 |
| [MIT AI News](https://news.mit.edu/rss) | Z1 MIT News + 官网主题订阅 | 已采集；官方 Artificial intelligence RSS | 研究成果、跨学科应用；校方新闻仍需关联论文 |
| [Stanford AI Lab](https://ai.stanford.edu/blog/) | 定向补充检索 + 官方 | 主页核验，RSS 已配置；本次 15 条均早于 90 天窗口 | 主页有 2026-11 文章但 feed 落后，应做源健康提示，不能宣称已拿到最新内容 |
| [Berkeley AI Research](https://bair.berkeley.edu/blog/) | 定向补充检索 + 官方 | 已采集；`/blog/feed.xml`，90 天窗口 | 研究解读、会议论文集合、实验室动态 |
| [MIT CSAIL](https://www.csail.mit.edu/news) | 补充搜索结果 | 候选；本轮只核验 MIT News 上游 | 实验室新闻，后续去除与 MIT News 的重叠 |
| [Lil’Log](https://lilianweng.github.io/) | Z1、Z6 | 候选 | 深度技术综述，不应强求日更 |
| [科学空间](https://spaces.ac.cn/) | Z1 | 候选 | 苏剑林的技术推导与研究笔记 |
| [CoolPapers](https://papers.cool/) | Z1 | 候选 | 论文发现与辅助阅读，应回溯 arXiv |
| [Hugging Face Papers](https://huggingface.co/papers) | Z1、R3、R4 | 候选 | 社区精选论文；不等于全部论文或客观影响力排名 |
| [arXiv](https://arxiv.org/) | Z1、R3、R4 + 现有系统 | 3 路已配置；本次 feed 为 0 条 | 预印本，不等于同行评审；已有会议语料另行保留 |
| [Raschka](https://magazine.sebastianraschka.com/) | R3、Z6 | 候选 | ML/LLM 研究解读与实践 |
| [Cameron Wolfe](https://cameronrwolfe.me/blog) | R3 | 候选 | 深度学习论文解读 |
| [Sebastian Ruder](https://newsletter.ruder.io/) | R3 | 候选 | NLP 与语言模型研究通讯 |
| [Import AI](https://jack-clark.net/) | R3 | 候选 | Jack Clark 的研究、产业与政策摘要 |
| [Interconnects](https://www.interconnects.ai/) | R4 | 候选 | 后训练、开放模型与产业分析 |
| [Latent Space AI News](https://latent.space/news/) | R3 推荐 `news.smol.ai` | 页面核验；旧地址本次跳转至此，近期可见更新 | 已有每日简报，适合发现事件；本轮未确认批量复用许可/当前 RSS |
| [AlphaSignal](https://alphasignal.ai/) | R4 | 候选 | AI 工程/研究摘要，需评估营销与独立内容比例 |
| [Cerebral Valley](https://cerebralvalley.ai/) | R4 | 候选 | AI 社区与产业动态 |
| [PyTorch Blog](https://pytorch.org/blog/) | R4 | 候选 | 框架工程、发布与生态实践 |
| [The Journal Club](https://www.thejournal.club/c/pulse/) | R4 | 候选 | 论文发现/阅读入口 |
| [papers-feed](https://dmarx.github.io/papers-feed/) | R3 | 候选 | 社区论文阅读流 |
| [智源社区信息源汇总](https://hub.baai.ac.cn/view/24040) | Z1 引用 | 二级汇总候选，未打开全文核验 | 原帖称含 Twitter、工具和 newsletter 清单；不直接采用其数量作为本次统计 |
| [Alignment Forum](https://www.alignmentforum.org/)、[LessWrong](https://www.lesswrong.com/) | Z4、Z5 | 候选 | AI 对齐讨论，作者观点与实验证据分开 |
| [The Gradient](https://thegradient.pub/) | Z4 | 候选 | AI 技术与研究评论 |
| [Distill](https://distill.pub/) | Z5 | 历史资料候选 | 原帖明确指出停止常规更新，放知识库而非日更资讯源 |
| Papers with Code | Z1、Z4 的旧推荐 | 未验证当前独立服务状态，不启用 | 旧清单中的高知名度不能替代当下可用性检查 |

Z1 的天津大学郝建业强化学习实验室账号、Z6 的研究者 X 清单可继续向团队主页扩展；本轮没有把社交账号旧简介当成当前任职证明。Z4 的 MIT OCW、Stanford 课程、AI Index 属于课程/周期报告，不与突发新闻混用。

## Telegram 频道、讨论群与 bot

| 候选 | 发现路径 | 核验结果 | 处理建议 |
| --- | --- | --- | --- |
| [Cybersecurity & Privacy](https://t.me/s/cibsecurity) | T1 | 公开预览可读；最后可见消息为 2026-11-25 UTC；样例标注 Via The Hacker News 并附原文 | 优先试点；与已接 THN 高度重叠，需要按原文 URL 去重，不能算两份独立证据 |
| [Cyber Security News](https://t.me/s/cyber_security_channel) | T1 | 公开预览可读；最后可见消息为 2026-11-27 UTC；有短摘要/原文链接，也有 `#ad/#sponsored` | 可试点；将广告标识保留在原文，不把频道订阅数当可信度 |
| [CyberSecurity Experts](https://t.me/cybersecurityexperts) | T1 | 候选讨论群，未加入 | 用户讨论与编辑通报不同，噪声和作者权限需另评估 |
| [Cloud & Cybersecurity](https://t.me/cloudandcybersecurity) | T1 | 候选，未核验近期内容 | 核验原文链接与云安全覆盖后再启用 |
| [Android Malware](https://t.me/androidMalware) | T1 | 候选，未核验近期内容 | 移动安全垂直方向 |
| [Malware Research](https://t.me/MalwareResearch) | T1 | 候选，未核验近期内容 | 仅考虑研究资讯，不下载样本执行 |
| [BugCrowd](https://t.me/BugCrowd) | T1 | 候选；未验证品牌官方隶属 | 同名不等于官方账号 |
| [Red Team Alerts](https://t.me/itsecalert) | T1 | 候选，未核验近期内容 | 漏洞/技术线索，回溯厂商公告 |
| [Reverse Engineering](https://t.me/reverseengineeringz)、[Frida](https://t.me/fridadotre) | T1 | 候选讨论社区，未加入 | 适合技术问题发现，不作为默认新闻全文源 |
| APT Intelligence 邀请群 | T1 | 私有/邀请入口，未加入、未读取 | 不对内容和质量作判断 |
| So1234Bot、TeleTop123Bot、jisou2bot、TeleindexBot、PolarisseekBot 等 | Z7 | 只在汇总文章中确认名称；未发消息/启动 bot | 是搜索索引工具，不能称为可信新闻摘要 bot |

两个实际核验的频道均不是对全部消息事实的背书。“群聊”“频道”和“bot”必须区分：频道适合单向通报；群聊有多人内容和更高噪声；检索 bot 只是入口，发送查询还会向对方传递信息。本轮没有发送查询、加入群、登录 Telegram 或配置任何真实凭据。

Telegram 的 [消息历史 API](https://core.telegram.org/method/messages.getHistory) 明确只供用户账号调用；[API ID 文档](https://core.telegram.org/api/obtaining_api_id) 要求自己的 `api_id/api_hash`。其 [API 条款](https://core.telegram.org/api/terms) 与 [内容许可条款](https://telegram.org/tos/content-licensing) 限制平台内容用于 AI，例外涉及相关内容主体的具体同意。因此“拥有自己的 Telegram 账号”不等于取得公共转载或 AI 处理许可。可运行的本地只读准备、凭据位置和未完成条件见 [Telegram 方案](telegram-sources.md)。

## 接入与筛选次序

1. **直接读取上游公开 feed。** 已落地的 16 路配置与 213 条当日入库记录见[采集说明](news-collection.md)。不同信源同时报道同一事件不能简单累加可信度，特别是转自同一家媒体的通报。
2. **增加漏洞专用适配。** CVE/NVD/KEV/OSV 应按标识、版本和修改时间增量更新；与普通文章分开建模。本轮完成接口调研，没有实现这些 API 采集。
3. **候选源逐批验证。** 核验规范 URL、原始作者、可用订阅、更新周期、原文覆盖、重复比例、广告比例和使用方式；先测再启用，禁止一次性照抄整份书签。
4. **把汇总帖本身当发现索引维护。** 保存推荐者、原帖、原文推荐名称、上游链接和核验时间；旧帖继续提供线索，但不覆盖最新官网结论。
5. **给来源分工。** 官方记录用于确认发布/漏洞事实；原创研究用于解释方法；媒体用于持续报道；个人精选用于发现与理解；群聊用于发现线索。所有二手总结保留出处链，未知字段保持未知。

限制：这是分层抽样调研，不是全网穷举。候选表中的站点未逐个采集，也未审计所有文章；网页可读、RSS 可解析、内容可复用是三个不同条件。当前代码尚无跨媒体事件聚类、全源健康面板或 CVE 实体库。
