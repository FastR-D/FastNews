# 本地账号与可选 FastCAS

FastNews 的本地登录、邀请注册和恢复独立于 FastCAS。FastCAS 只提供已有账号认证与可选登录；同邮箱或同名不自动合并，也不自动导入 Research 个人内容。

## 本地运行

使用 `uv sync` 安装本地账号依赖，启用 FastCAS 时使用 `uv sync --extra fastcas` 安装同级 FastCAS Python SDK。服务器数据目录由 `FASTNEWS_DATA_DIR` 指定，默认 `.fastnews-data`；SQLite 保存稳定用户 UUID、密码哈希、摘要会话、一次性凭证和个人内容。新目录权限 0700，数据库 0600。

管理员命令：

```sh
uv run python accounts_admin.py create --root .fastnews-data --email reader@example.com
uv run python accounts_admin.py invite --root .fastnews-data --email new@example.com
uv run python accounts_admin.py recovery --root .fastnews-data --email reader@example.com
```

create 交互读取密码，也支持 `FASTNEWS_INITIAL_PASSWORD`；invite/recovery 输出一小时有效、仅消费一次的凭证，由管理员交付目标用户。恢复保留原用户及内容并撤销旧会话；命令不发送邮件。

`/login` 提供登录、邀请注册、恢复、退出和可选 FastCAS 入口。默认公开报告无需登录；设置 `FASTNEWS_REQUIRE_LOGIN=true` 后，匿名访问进入本项目登录页。本地与原 Research 登录路径保留。Cookie 默认 Secure，仅环回 HTTP 开发设置 `FASTNEWS_COOKIE_SECURE=false`；部署应设置 `FASTNEWS_PUBLIC_ORIGIN`。

## 账号与内容边界

本地 Cookie 使用独立的 `fastnews_session`，不会转发给 Research。`/api/content/me/authors/impression/inbox/settings` 按当前用户隔离数据。修改要求 CSRF；收件箱只允许浏览器标记已读，不允许伪造投递消息。新账号不自动导入浏览器遗留作者缓存。本地账号访问未接通的旧远端代理明确拒绝，不静默转换身份。

## FastCAS 配置及流程

四项同时配置：`FASTNEWS_FASTCAS_ISSUER`、`FASTNEWS_FASTCAS_CLIENT_ID`、`FASTNEWS_FASTCAS_CLIENT_SECRET`、`FASTNEWS_FASTCAS_REDIRECT_URI`。回调地址为公开地址的 `/api/auth/fastcas/callback`；环回开发可设置 `FASTNEWS_FASTCAS_ALLOW_LOOPBACK_HTTP=true`。关闭配置不会加载 SDK 或请求中心，本地登录照常工作。

接口前缀 `/api/auth/fastcas/`：`available/login/callback/status/link/reconcile/revoke/events`。绑定和解绑要求当前会话、原密码、CSRF 与回调同源 Origin。回调使用浏览器绑定 Cookie，事务持久化且单次消费。绑定 prepare/activate 支持中断后对账；登录仅映射已绑定本地用户。签名撤销事件有 64 KiB 上限，在同一 SQLite 事务中完成去重、版本检查和 CAS 来源会话删除。访问日志脱敏授权码、state 和旧 SSO 票据。

CAS 来源会话每五分钟复核绑定状态；解绑不删除本地用户、内容或本地会话。嵌入 HTTP 服务器需要同时注入 `server.accounts` 与 `server.cas`，生产 main 已初始化。

## 已验证与剩余项

`uv run --extra fastcas python -m pytest tests -q` 覆盖本地账号、单次凭证、并发事务、事件回滚/重试、来源隔离、真实 HTTP 的 Origin/CSRF/密码证明及日志脱敏。

在同级 FastCAS 目录运行：

```sh
FASTCAS_PROJECT_CONTRACT=1 go test ./internal/httpapi -run '^TestFastNewsAgainstProvider$' -count=1 -v
```

该测试使用独立 PostgreSQL schema、真实 FastCAS 服务、Python SDK 与 FastNews HTTP 服务器，验证同邮箱不合并、绑定、原账号/内容登录、回调重放拒绝、解绑及本地密码重新登录。默认使用 FastNews `.venv/bin/python`，可用 `FASTCAS_NEWS_PYTHON` 覆盖。

本地收件箱首次 GET 会根据本项目保存的关注作者和研究印象生成每日论文，SQLite 事务会避免并发请求写入重复条目；无需 Research 在线。账号页提供显式 Research Key 验证和一次性内容快照导入，复制关注作者、研究印象与收件箱。默认拒绝覆盖本地已有内容，用户明确选择替换后才覆盖；一个 Research 账号只能连接一个 FastNews 账号。导入记录包含 Research 稳定账号 ID、旧 Key ID、数量和快照摘要，不保存 Key 或临时会话。导入后两边各自写入，FastNews 不会把本地会话转发给 Research。真实 Research HTTP → FastNews SQLite 契约及并发本地收件箱测试通过。

快照导入使用服务端固定的 `FASTRESEARCH_API_URL`（默认 `http://127.0.0.1:8787`），非环回部署须使用 HTTPS。账号页调用 `/api/auth/research/import`，要求 FastNews 当前会话、同源 Origin、CSRF 和用户输入的 Research Key；Research 返回重定向时拒绝发送后续请求。成功后临时 Research 会话立即退出，FastNews 仅保留导入结果。快照是单次复制，后续 Research 更新不会自动同步。

可选持续连接需设置 `FASTNEWS_FASTCAS_RESEARCH_CONNECT=true` 和独立的 `FASTNEWS_FASTCAS_VAULT_KEY`（32 字节随机值的 base64url 编码），并在 FastCAS 为 News 保密客户端登记 `authorization_code`、`refresh_token`、token exchange、`research-api` 资源及 `offline_access`、`research:read` scope。Research 客户端需有 `research:read` scope，管理员配置 `news → research / research-api / research:read` 策略，用户在 FastCAS 明确同意且两个项目均已绑定。News 的 CAS 登录随后请求这些 scope，刷新令牌仅以 AES-GCM 密文按 News 会话保存在 SQLite；会话撤销会清理密文。本地密码会话和未启用此配置的实例不请求这些权限。

CAS 来源会话可调用 `/api/auth/research/live` 实时读取 Research 的关注作者、研究印象和收件箱，不修改本地内容。账号页可选择 `/api/auth/research/sync` 将该次快照复制到本地，仍默认拒绝覆盖，明确选择后才替换。Research 只读资源端验证委托 JWT、中心 introspection、`act.sub=news`、scope、Research 本地绑定及账号状态；撤销用户同意后实时读取立即失败，本地已导入内容仍归 News 账号。真实 FastCAS/PostgreSQL → News/Python/SQLite → Research/Node/SQLite 三进程契约覆盖同意前拒绝、同意后读取、刷新轮换、显式同步与撤销。

真实 Chrome → FastNews 账号页/HTTP/SQLite → FastCAS/PostgreSQL 浏览器契约已覆盖本地登录、原账号认证、独立浏览器使用 FastCAS 登录、原账号研究印象保持，以及解绑只撤销 CAS 来源会话。契约在临时站点实际生成首页及六个栏目页，逐页验证账号入口并从栏目页点击进入登录页；这验证了全站生成后的导航可达性。尚未完成全站视觉布局验收及生产部署/故障演练；身份状态事件已有真实提供方投递契约，生产投递仍待验收。因此不能把协议联调通过视为全部接入功能已完成。

FastCAS 应用登记还需设置 `backchannel_logout_uri` 为 `/api/auth/fastcas/backchannel-logout`。接收端验证标准签名 `logout_token`，按身份及可选 sid 原子去重，只撤销 FastCAS 来源会话；项目本地登录、账号、内容和权限保持独立。

`events_uri` 同时接收签名 `identity.status_changed` 通知。中心停用只终止对应 FastCAS 来源会话，重新启用不恢复旧会话；本地密码登录、个人印象和收件箱不受影响。真实提供方到 FastNews 接收端的状态事件契约已通过。
