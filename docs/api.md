# FastNews JSON API

所有路径相对 `FASTNEWS_PUBLIC_PATH`。返回 UTF-8 JSON；错误为 `{"error":"..."}`。写入大小在服务端限制，个人接口写入最多 256 KiB。

前后端可独立构建和部署；开发时 Vite 同源代理，生产推荐 nginx 同源分流，避免跨域 Cookie。默认报告公开；`FASTNEWS_REQUIRE_LOGIN=true` 时语料/报告 API 与生成接口也需要有效会话。

| Method | 路径 | 请求/响应 |
| --- | --- | --- |
| GET/HEAD | `/api/health` | SQLite 可读后 `{"ok":true,"runtime":"go"}` |
| GET | `/api/catalog` | 统计、会议、年份、类别、日期与报告目录 |
| GET | `/api/papers` | 参数 `q,source,conference,year,category,page,pageSize`；返回 `papers,total,page,pageSize`，pageSize 最大 100 |
| GET | `/api/news?date=YYYY-MM-DD` | 合并原资讯与已生成中文导读；日期留空取最新 |
| GET | `/api/reports` | `{reports:[{title,kind,html,pdf?,size,updated}]}` |
| POST | `/api/field-briefing` | `{query,impression?,category?,source?,limit?}` → `briefing,papers,surveys,coverage` |
| POST | `/api/summary-brief` | 同上，可用 `conference/conferences/years`；返回 `brief,stats,papers`，留空全景或使用印象 |
| POST | `/api/related-work` | `{topic,keywords?,impression?,candidates}` → 仅候选 ID 的 `items:[{id,score,reason}]`；需要 LLM |
| POST | `/api/fastread` | 论文元数据 → `redirect,paper`，仅使用 Research 会话申请 `fast-read` 票据 |
| POST | `/api/authors/preview` | `{url}` → `title,description,papers`；登录/CSRF，拒绝内网地址和 DNS 重绑定 |

`source` 为 `all/top-conf/arxiv`。论文检索始终向量召回。领域导读/总结汇报无 LLM 或上游失败时返回 `source=corpus,fallback=true,warning`，展示本地证据与统计；不把离线整理标为生成综述。

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

本地 Cookie 不发给 Research。旧 `fr_session` 和 `?sso=` 入口保留；旧个人代理限于明确的 `/api/content/*` 接口。
