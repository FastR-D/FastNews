# 多领域论文采集

`internal/jobs/PaperSource` 定义 `URLs` 与 `Fetch`：适配器只读取、分页、验证来源并返回记录，Pipeline 负责整批校验、原子落盘、稳定 ID 去重和目录刷新。`NewPaperSources` 为每个 Pipeline 创建独立注册表，可注入新适配器；新增会议在 `catalog.Conferences` 声明领域和默认 provider，在管理员采集计划中配置已核验年份。

| Provider | 来源与范围 |
| --- | --- |
| html | 安全会议的官方录用页 |
| dblp | ICSE、ASE、ISSTA 的会议书目；保留 venue，区分主会、Companion、Workshop 与未知轨道 |
| researchr | ICSE / FSE 2026 官方 Research 录用列表；仅解析 Accepted Papers 容器，保留作者、主页和单位，不将混合 session 中的其他轨道当成主会 |
| openreview | ICLR 精确 accepted venue ID、分页总数、作者 profile、keywords、presentation；拒绝跨会场记录 |
| iclr-proceedings | ICLR 官方论文集 2024–2026；校验主会 URL、年度和声明数量，可替代受限的 OpenReview API |
| pmlr | ICML 已核验卷 2022–2025，索引和 RSS 数量一致；保留完整原始摘要 |
| neurips-proceedings | NeurIPS 已核验卷 2022–2025，仅 conference 轨道；摘要逐篇补全并检查卷/PDF 身份 |

```bash
FASTNEWS_ROOT=/path/to/corpus ./bin/fastnews fetch-conf --conference icse --year 2026 --provider researchr --topic coding-agents
FASTNEWS_ROOT=/path/to/corpus ./bin/fastnews fetch-conf --conference fse --year 2026 --topic coding-agents
FASTNEWS_ROOT=/path/to/corpus ./bin/fastnews fetch-conf --conference ase --year 2025
FASTNEWS_ROOT=/path/to/corpus ./bin/fastnews fetch-conf --conference issta --year 2025
FASTNEWS_ROOT=/path/to/corpus ./bin/fastnews fetch-conf --conference iclr --year 2025 --provider iclr-proceedings
FASTNEWS_ROOT=/path/to/corpus ./bin/fastnews enrich-abstracts --conference iclr --year 2025 --topic coding-agents --all
FASTNEWS_ROOT=/path/to/corpus ./bin/fastnews enrich-abstracts --conference neurips --year 2025 --all
```

`fetch-conf --topic` 返回主题匹配数量，保留整个会议语料；它不是破坏性的采集过滤器。`enrich-abstracts --topic` 只补全该方向候选的摘要，省略则补全所有论文。管理员进程页的论文计划会补全最多 30 篇 Coding Agent 候选，下一次从未完成记录继续。资讯与论文可共用定时计划，任务互斥、可取消并保留进度和失败状态。DBLP / OpenReview 可能限流；失败不会伪造或清空已有记录。

## 识别与证据

三大会按 NeurIPS、ICML、ICLR 处理。`catalog/topics.go` 提供稳定、多标签方向：Coding Agents、代码生成、程序修复、测试、程序分析、仓库任务、评测、多智能体、工具调用、推理规划、检索记忆、对齐安全、强化学习、效率、多模态、生成模型、理论优化、图学习、机器人、AI for Science。

识别读取发布者的标题、摘要与关键词，不用生成摘要充当证据。每个标签附 `basis` 和原文片段；仅标题命中显示“候选”。Coding Agent 要求明确术语或同时包含智能体与软件任务信号，普通代码生成或交通多智能体不自动归入。该规则用于检索召回，不等于人工判定，也不保证召回所有相关工作。无命中保持未分类。主题分类与会议录用状态、轨道、报告总结状态是独立维度。

采集后原始论文立即可读。模型总结过期时回退到原文摘要，标为“原文摘要”，不会继续展示旧总结。`GET /api/papers` 支持 `domain`、`topic`、`track` 与现有会议/年份/类别联合过滤。

## 作者与机构

优先使用结构化作者 profile、ORCID、ROR、机构名称；旧档案支持分号分组的“姓名, 单位”格式。资料页按明确 profile URL 限定匹配；无标识符时仅按完整姓名汇总并提示可能同名。官网解析仅提取公开简介和论文/资料链接，ORCID 读公开 person 记录，ROR 读 v2 机构记录。可配置 `FASTNEWS_ORCID_TOKEN`（/read-public）；受限时保留来源跳转并显示读取失败。外链统一校验，主页抓取逐次 DNS/重定向检查，禁止内网地址。

Edge 中核对的官方来源：

- [ICSE 2026 Research Track](https://conf.researchr.org/track/icse-2026/icse-2026-research-track)
- [ICLR 官方论文集](https://proceedings.iclr.cc/)
- [ORCID 公开记录读取](https://info.orcid.org/documentation/api-tutorials/api-tutorial-read-data-on-a-record/)
- [ROR 单个机构记录接口](https://ror.readme.io/docs/api-single)

所有语料、摘要和报告都只写 `FASTNEWS_ROOT` 下的忽略目录；仓库不包含采集结果，发布包也不包含它们。测试使用小型合成数据和来源响应夹具。
