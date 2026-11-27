# 信源核验与启用记录（2026-11-27）

核验覆盖目录原有 78 个条目及 3 条 arXiv 实际订阅；同时比较主服务器与新加坡出口，检查响应是否可被采集器解析。网页可访问不等于已接入。依用户要求删除 15 个停更、受限、失效或重复条目；保留 66 个目录条目，其中计划启用 37 个采集来源。

## 启用来源

| 信源 | 采集接口 | 网络 | 保留窗口 |
| --- | --- | --- | --- |
| NVD | nvd | 直连 | 14 天 |
| CISA KEV | cisa-kev | 直连 | 30 天 |
| OSV | RSS / Atom / RDF | 直连 | 365 天 |
| JVN | RSS / Atom / RDF | 直连 | 90 天 |
| GitHub Security Advisories | RSS / Atom / RDF | 新加坡 | 7 天 |
| FIRST | RSS / Atom / RDF | 直连 | 90 天 |
| JPCERT/CC Incident | RSS / Atom / RDF | 直连 | 90 天 |
| Krebs on Security | RSS / Atom / RDF | 直连 | 14 天 |
| The Hacker News | RSS / Atom / RDF | 直连 | 14 天 |
| SecurityWeek | RSS / Atom / RDF | 直连 | 14 天 |
| Trail of Bits | RSS / Atom / RDF | 直连 | 90 天 |
| Cisco Talos | RSS / Atom / RDF | 直连 | 14 天 |
| Unit 42 | RSS / Atom / RDF | 直连 | 90 天 |
| Quarkslab | RSS / Atom / RDF | 新加坡 | 90 天 |
| PortSwigger Research | RSS / Atom / RDF | 直连 | 90 天 |
| Citizen Lab | RSS / Atom / RDF | 新加坡 | 90 天 |
| 腾讯科恩实验室 | RSS / Atom / RDF | 直连 | 365 天 |
| 奇安信 XLab | RSS / Atom / RDF | 直连 | 90 天 |
| OpenAI News | RSS / Atom / RDF | 直连 | 14 天 |
| Hugging Face Blog | RSS / Atom / RDF | 新加坡 | 14 天 |
| Google DeepMind Research | RSS / Atom / RDF | 直连 | 90 天 |
| Transformer Circuits | RSS / Atom / RDF | 直连 | 90 天 |
| MIT AI News | RSS / Atom / RDF | 直连 | 14 天 |
| Berkeley AI Research | RSS / Atom / RDF | 新加坡 | 90 天 |
| Lil’Log | RSS / Atom / RDF | 直连 | 365 天 |
| 科学空间 | RSS / Atom / RDF | 直连 | 90 天 |
| Raschka | RSS / Atom / RDF | 直连 | 90 天 |
| Import AI | RSS / Atom / RDF | 直连 | 90 天 |
| Interconnects | RSS / Atom / RDF | 直连 | 90 天 |
| Latent Space AI News | RSS / Atom / RDF | 直连 | 90 天 |
| AlphaSignal | RSS / Atom / RDF | 直连 | 30 天 |
| PyTorch Blog | RSS / Atom / RDF | 直连 | 90 天 |
| Alignment Forum | RSS / Atom / RDF | 直连 | 90 天 |
| The Gradient | RSS / Atom / RDF | 直连 | 365 天 |
| arXiv cs.AI + cs.CL / cs.CR / cs.SE | Atom（3 条独立订阅） | 直连 | 14 天 |

CISA 使用新增入库日期；NVD 只保留 HIGH/CRITICAL，评级与在野利用事实分开。OSV 为团队研究博客。低频研究笔记使用较长窗口，不把没有每日更新误判为停更。订阅与 HTTP 可达性由本次实测确认；实际新增数量以进程管理的任务结果为准。

## 已删除条目

| 信源 | 删除原因 |
| --- | --- |
| 360 CERT | 证书已过期，入口不可用 |
| BleepingComputer | 两地 RSS 均返回 HTTP 403 |
| Security Boulevard | 入口返回 HTTP 403 |
| Threatpost | 停止常规更新 |
| NCC Group | 旧入口迁移，RSS 返回 HTML/403 |
| inforsec | 两地连接超时或拒绝 |
| 腾讯安全每日资讯 | 入口返回 HTTP 404 |
| Stanford AI Lab | 订阅停留在 2022 年 |
| MIT CSAIL | 与已接入的 MIT AI News 重叠 |
| arXiv | 已有 cs.AI/cs.CL、cs.CR、cs.SE 订阅 |
| Cameron Wolfe | 入口返回 HTTP 404 |
| Sebastian Ruder | 订阅停留在 2024 年 |
| LessWrong | 与保留的 Alignment Forum 重叠 |
| Distill | 停止常规更新的历史知识库 |
| Cybersecurity & Privacy | 与 The Hacker News 高度重复 |

删除目录、采集配置和对应待执行队列，不删除历史收录文章或原始调研证据。主服务器可用而新加坡返回限制的来源（如 CISA、科学空间、Import AI）继续直连。

## 保留但未订阅

| 信源 | 当前处理 |
| --- | --- |
| CVE Program | 数据库或交互查询平台；本轮通过 CISA/NVD/JVN/GHSA 收集公告，不把首页当作数据接口 |
| Snyk Vulnerability DB | 数据库或交互查询平台；本轮通过 CISA/NVD/JVN/GHSA 收集公告，不把首页当作数据接口 |
| huntr | 数据库或交互查询平台；本轮通过 CISA/NVD/JVN/GHSA 收集公告，不把首页当作数据接口 |
| Inthewild | 数据库或交互查询平台；本轮通过 CISA/NVD/JVN/GHSA 收集公告，不把首页当作数据接口 |
| CVECrowd | 数据库或交互查询平台；本轮通过 CISA/NVD/JVN/GHSA 收集公告，不把首页当作数据接口 |
| CVEShield | 数据库或交互查询平台；本轮通过 CISA/NVD/JVN/GHSA 收集公告，不把首页当作数据接口 |
| Dark Reading | 主要为行业/社区资讯，本轮优先原始技术研究与学术信源 |
| SC Media | 主要为行业/社区资讯，本轮优先原始技术研究与学术信源 |
| CSO | 主要为行业/社区资讯，本轮优先原始技术研究与学术信源 |
| Infosecurity Magazine | 主要为行业/社区资讯，本轮优先原始技术研究与学术信源 |
| Mandiant | 暂无经实测验证的稳定机器订阅，保留研究入口，未宣称开始采集 |
| DEVCORE | 暂无经实测验证的稳定机器订阅，保留研究入口，未宣称开始采集 |
| sec.today | 暂无经实测验证的稳定机器订阅，保留研究入口，未宣称开始采集 |
| ufofly/yarb | 论文发现或信源汇总入口；保留人工研究价值，自动资讯通过原始上游采集并去重 |
| CoolPapers | 论文发现或信源汇总入口；保留人工研究价值，自动资讯通过原始上游采集并去重 |
| Hugging Face Papers | 论文发现或信源汇总入口；保留人工研究价值，自动资讯通过原始上游采集并去重 |
| Cerebral Valley | 主要为行业/社区资讯，本轮优先原始技术研究与学术信源 |
| The Journal Club | 论文发现或信源汇总入口；保留人工研究价值，自动资讯通过原始上游采集并去重 |
| papers-feed | 论文发现或信源汇总入口；保留人工研究价值，自动资讯通过原始上游采集并去重 |
| 智源社区信息源汇总 | 论文发现或信源汇总入口；保留人工研究价值，自动资讯通过原始上游采集并去重 |
| Cyber Security News | 频道/群组身份与读取账号待配置；不假设群组允许匿名读取 |
| CyberSecurity Experts | 频道/群组身份与读取账号待配置；不假设群组允许匿名读取 |
| Cloud & Cybersecurity | 频道/群组身份与读取账号待配置；不假设群组允许匿名读取 |
| Android Malware | 频道/群组身份与读取账号待配置；不假设群组允许匿名读取 |
| Malware Research | 频道/群组身份与读取账号待配置；不假设群组允许匿名读取 |
| BugCrowd | 频道/群组身份与读取账号待配置；不假设群组允许匿名读取 |
| Red Team Alerts | 频道/群组身份与读取账号待配置；不假设群组允许匿名读取 |
| Reverse Engineering | 频道/群组身份与读取账号待配置；不假设群组允许匿名读取 |
| Frida | 频道/群组身份与读取账号待配置；不假设群组允许匿名读取 |

## 专用采集账号

`fastnews-fetch` 仅允许读取 FastDeploy 白名单中的 5 个 HTTPS 端点，禁止交互终端、任意命令和端口转发。应用机固定主机公钥，密钥持久化到私有目录；GitHub `production` Environment 已配置 5 项 `FASTNEWS_RELAY_SSH_*` Secrets，用于恢复，值不进入仓库、日志、发布包或前端。

FastDeploy：`5ad81d7d0ceae560fcd0825ebee1dae18a9942e4`。自动采集继续沿用服务器现有 6 小时计划，另安排一次手动补采验证。
