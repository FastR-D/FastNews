# FastNews JSON API

所有路径相对 `FASTNEWS_PUBLIC_PATH`。返回 UTF-8 JSON；错误为 `{"error":"..."}`。写入大小在服务端限制，个人接口写入最多 256 KiB。

前后端可独立构建和部署；开发时 Vite 同源代理，生产推荐 nginx 同源分流，避免跨域 Cookie。默认全站要求登录；语料、报告、来源目录与生成接口需要有效会话。

| Method | 路径 | 请求/响应 |
| --- | --- | --- |
| GET/HEAD | `/api/health` | SQLite 可读后 `{"ok":true,"runtime":"go"}` |
| GET | `/api/catalog` | 统计、会议、年份、类别、日期与报告目录 |
| GET | `/api/papers` | 参数 `q,source,conference,year,category,page,pageSize`；返回 `papers,total,page,pageSize`，pageSize 最大 100 |
| GET | `/api/news?date=YYYY-MM-DD&source=articles` | 合并资讯与已有导读；source 支持 all/news/security/ai/arxiv/articles，articles 为非 arXiv；日期留空取该范围最近非空日；含 source_name/channel |
| GET | `/api/sources` | `{sources,archiveDate}`；目录条目含配置状态、调研出处和最近归档日计数；只读，不触发采集 |
| GET | `/api/report?path=…` | `{report,content}`；读取目录中的 JSON 文档树，不接受任意文件路径 |
| GET | `/api/reports` | `{reports:[{title,kind,path,pdf?,size,updated}]}` |
| POST | `/api/field-briefing` | `{query,impression?,category?,source?,limit?}` → `briefing,papers,surveys,coverage` |
| POST | `/api/summary-brief` | 同上，可用 `conference/conferences/years`；返回 `brief,stats,papers`，留空全景或使用印象 |
| POST | `/api/related-work` | `{topic,keywords?,impression?,candidates}` → 仅候选 ID 的 `items:[{id,score,reason}]`；需要 LLM |
| POST | `/api/fastread` | 论文元数据 → `redirect,paper`，本地会话校验 CSRF 后直达，已关联 CAS 时附加 `auth=cas`；Research 会话申请 `fast-read` 票据 |
| POST | `/api/authors/preview` | `{url}` → `title,description,papers`；登录/CSRF，拒绝内网地址和 DNS 重绑定 |

`source` 为 `all/top-conf/arxiv`。论文检索始终向量召回。领域导读/总结汇报无 LLM 或上游失败时返回 `source=corpus,fallback=true,warning`，展示本地证据与统计；不把离线整理标为生成综述。

`/api/sources` 与报告使用相同访问策略。`configured/disabled/channel` 来自当前配置，`verification/reviewedAt/references` 是调研记录，`recentCount` 是单个 `archiveDate` 的条数，均不等同于实时健康状态。未经单独调研的自定义来源只公开 URL origin，省略路径和查询参数。

## 本地账号

1. `GET /api/auth/session-init` 获取 `csrf` 与 HttpOnly `fastnews_preauth` Cookie。
2. `POST /api/auth/login` 提交 `{email,password}`，带 `X-CSRF-Token`；返回会话 CSRF 和 `fastnews_session` Cookie。
3. `GET /api/content/me` 返回个人资料和当前会话 `csrf`。所有个人写入必须携带此 token。

| Method | 路径 | 请求 |
| --- | --- | --- |
| GET | `/api/auth/info` | 本地能力与可选 FastCAS 状态 |
| GET | `/api/auth/me` | 当前账号、来源、csrf |
| POST | `/api/auth/register` | `{token,password}`，使用 preauth CSRF |
| POST | `/api/auth/recover` | 同上；保留用户/内容并撤销原会话 |
| POST | `/api/auth/profile` | `{name,email,currentPassword,newPassword?}`，验证当前密码；仅修改本人资料，变更邮箱/密码会撤销其他会话 |
| POST | `/api/auth/logout` | `{}`，会话 CSRF |
| GET/PUT | `/api/content/authors` | `{authors:[{id,name,homepage,tags}],customTags:[]}` |
| GET/PUT | `/api/content/impression` | PUT `{text}`；GET `{impression:{text,updatedAt}}` |
| GET/PUT | `/api/content/inbox` | GET 补当日推送；PUT **仅允许** `{readIds:[]}` |
| GET/PUT | `/api/content/settings` | `{settings:{...}}` |

浏览器不能创建私信消息。每日生成在写事务外检索，提交前在写事务内再次检查日期，避免并发投递重复。`HEAD` 不触发投递。

## FastCAS 与 Research

`/api/auth/fastcas/` 保持 `available,login,callback,status,link,reconcile,revoke,events,backchannel-logout`。绑定与撤销需要本地密码、CSRF 和与回调相同的 Origin。通知内容类型分别为 `application/jwt` 与 `application/x-www-form-urlencoded`，上限 64 KiB。

- `GET /api/auth/research/status`：已导入快照与持续连接能力。
- `POST /api/auth/research/import`：`{key,replace:false}`，验证 Key 后单次导入；不保存凭证。
- `GET /api/auth/research/live`：CAS 来源会话的只读委托内容。
- `POST /api/auth/research/sync`：`{replace:false}`，明确将实时内容复制至本地。

本地 Cookie 不发给 Research。Research 会话集成仅限明确的 `/api/content/*` 接口。

## 管理员采集任务

- `GET /api/admin/collection`：返回 `runs`（最近 50 次）、已启用 `sources`、定时配置 `schedule`、调度器状态 `schedulerRunning` 与写入告警 `warning`。
- `POST /api/admin/collection`：`{"source":"all|security|ai|arxiv|已启用信源ID"}`，返回 202 和任务。只读取服务端信源配置，不接受 URL 或命令。
- `POST /api/admin/collection/{id}/cancel`：停止当前任务；保留已写入的条目。

所有接口检查管理员会话，写操作额外校验 CSRF。同一服务实例只能运行一个采集任务，重复启动返回 409；任务最多运行 30 分钟。状态包括 running/stopping/completed/partial/failed/cancelled/interrupted，各信源提供读取、过期和新增条数及错误。任务历史原子写入账号数据目录的 `collection-runs.json`（0600），重启将未结束任务标记为中断。页面每 2.5 秒更新，监控本服务定时触发和工作台手动触发的采集；外部 CLI、GitHub Actions 和其他机器任务不在此列表中。

`POST /api/admin/collection/schedule` 保存 `{enabled,intervalHours,source}`，间隔 1–168 小时，仍要求管理员与 CSRF。首次启动默认立即采集一次，此后每 6 小时运行；管理员可以修改频率/范围、暂停或恢复。配置保存在账号数据目录 `collection-schedule.json`（0600），与浏览器是否打开无关。服务每 30 秒检查到期任务；当前有采集时等待其结束再执行，服务离线期间错过多个周期只补采一次。手动补采不改变下次定时时间，修改计划从保存时重新计时。记录的 `trigger` 区分 `scheduled/manual`；生产只在一个服务实例启用调度，多实例的其他进程可设置 `FASTNEWS_COLLECTION_DISABLED=true`。

### 管理员模型配置

- `GET /api/admin/models`：返回 `settings`、`scenes` 和 `environment`。模型密钥不回传，只提供 `hasKey`。
- `PUT /api/admin/models`：保存 `{revision,default,profiles,assignments}`。需管理员会话与 CSRF；版本冲突返回 409。`default` 为空沿用环境配置，场景分配为空继承默认，`disabled` 使用该场景本地模式。
- `POST /api/admin/models/test`：测试一个模型连接，需管理员会话与 CSRF；支持未保存连接，空密钥会按连接 ID 读取已保存密钥。发送一次短文本测试，返回 `{ok:true}` 或脱敏错误。

连接字段：`id,name,kind,baseUrl,model,apiKey?,clearKey?,temperature,maxTokens,timeoutSeconds`。`kind` 为 `chat` 或 `embedding`；API 地址为 OpenAI 兼容接口根地址（例如以 `/v1` 结尾），向量接口也支持完整 `/embeddings` 地址。输出上限和温度仅用于聊天。连接删除或类型更改前须解除冲突的场景/默认分配。
