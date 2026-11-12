# Go / React 重构与验收

## 参考基线

- 同级 FastTask：根 Go module、`cmd/` / `internal/` / `web/`、Go 1.26.8、SQLite、独立账号与 FastCAS Go SDK。
- 同级 FastCAS：原生 HTTP 适配、可选身份提供器、事务持久化、签名通知与来源隔离。
- 同级 FastUI 0.3.0：React 控件和工作台组件、UnoCSS preset 按需样式、语义 token、浅深色与触控适配。没有导入已删除的框架全量样式入口，也没有源码 alias 或同级目录依赖。
- [Go 官方目录组织](https://go.dev/doc/modules/layout) 与 [React 官方 TypeScript 指南](https://react.dev/learn/typescript)。

## 功能对应

| 原入口/模块 | Go / React 对应 | 验证方式 |
| --- | --- | --- |
| 首页和六个栏目、账号入口 | `web/src/App.tsx` 和各页面 | 桌面、手机、子路径浏览器契约 |
| 论文语料和列表 | `internal/catalog`、`GET /api/papers` | 真实仓库语料、会议/年份/类别和分页 |
| 安全资讯、日历、Top Picks | `GET /api/news`、React News | 原 URL source 与中文日报合并、月份、推荐与详情 |
| 领域导读与总结汇报 | `internal/ai` / `internal/rag` | 离线真实语料、统计，模型上游 stub |
| related work / FastRead | `/api/related-work`、`/api/fastread` | 仅允许候选 ID，保留本地账号 409 授权边界 |
| 关注作者与自定义标签 | `/api/content/authors`、Authors | 保存、刷新保留、编辑、删除、主页解析 |
| 研究印象、私信、设置 | `/api/content/*`、Go SQLite | 用户隔离、CSRF、上海日期、每日幂等、只读投递 |
| 本地账号与管理命令 | `internal/store`、Go CLI | scrypt、单次凭证、恢复保留 UUID / 内容并撤销旧会话 |
| FastCAS | `internal/identity`，正式 Go SDK 0.1.2 | 原子 Take、状态版本、事件回滚/幂等、CAS 来源会话撤销、加密 vault |
| Research 导入与实时委托 | `internal/identity/research.go` / `cas.go` | 固定 origin、拒绝跳转、快照原子写入/不覆盖、会话绑定加密 |
| RSS / 顶会 / 摘要 / 指标 / 报告 | Go CLI 数据任务 | RSS/Atom、四会页面 fixture、摘要检查点、模板转义 |
| 原 HTML/PDF | 原地址直接提供 | 附件头、子路径阅读跳转、发布目录符号链接 |
| 定时工作流与产物 | Go CLI + `package-release.sh` | Go / TypeScript 构建、race、浏览器、产物检查 |

现有顶会记录在迁移核对时为 4595 篇，近期 arXiv 为 3827 篇（最近 90 天，以核对日计算），迁移前后的加载数量一致。数量和时间窗口由实际文件决定，不写死在前端。

## 运行时和数据分离

构建产物只含 Go 二进制、React `web/dist`（包括 `reports/` 阅读跳转资源）和 systemd 样例。个人 SQLite、语料、生成报告和 `.env` 不进发布包。

```env
FASTNEWS_ROOT=/home/dev/FastNews
FASTNEWS_DATA_DIR=/home/dev/FastNews/.fastnews-data
FASTNEWS_WEB_DIR=/opt/fastnews/current/web/dist
FASTNEWS_PUBLIC_PATH=/news
FASTNEWS_PUBLIC_ORIGIN=https://news.example.org
```

`FASTNEWS_ROOT` 指向原数据目录；`FASTNEWS_WEB_DIR` 指向当前发布的前端目录。静态路径校验兼容 `current` 符号链接，同时拒绝越界符号链接、源码、隐藏文件与账号库。

旧源码、模板、serverless API 与旧测试已移除；历史报告中 `/assets/fastread.js` 和 CSS 地址保留映射，实际使用 `web/public/reports/` 的新实现。

## 切换

1. 构建并运行 `make test`、`make test-browser`。模型、CAS、Research 按实际环境配置。
2. 停止原服务，使用 SQLite backup 或停机文件备份保存 `accounts.sqlite` 及其一致性状态；保留数据目录与原 `.env`。
3. Go 直接打开同一个 `FASTNEWS_DATA_DIR`。旧用户、UUID、密码、个人内容、本地会话和 CAS 关系不转换格式。委托 vault 沿用原 AES-GCM 的密钥、nonce 和 AAD 格式。
4. 旧运行时已发起但未完成的 OIDC 事务需要重新发起，避免跨版本复用短时认证流程。
5. 使用原生 systemd 或 FastDeploy Go profile 启动，再核对健康检查、登录、报告、个人内容和退出。

保留旧版本产物即可回滚代码，账号与报告数据不随代码替换。不要让旧发布工具把业务数据目录当作代码清理。

## 已执行与边界

已执行 Go race tests、vet、前端类型检查与生产构建，及桌面、手机和 `/news/` 浏览器契约。浏览器契约使用真实 Go API 与仓库语料；模型相关单元测试使用受控 HTTP 上游，验证非法 ID 过滤、离线回退和检查点。

真实 FastCAS/OIDC/Research 的生产凭据联调、官方会议网站所有年份的在线采集和生产部署未在本次本地重构中执行。正式上线前仍应使用真实提供方完成绑定、登录、同意、刷新轮换、解绑、事件投递与 Research 快照的环境验收。
