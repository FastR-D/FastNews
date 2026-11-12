# FastNews 账号与 FastCAS

当前 Go 服务拥有独立 SQLite 账号与个人内容。本地登录、单次邀请注册、恢复与管理命令不依赖中心可用性。正式 Go SDK 固定为 `github.com/FastR-D/FastCAS/sdk/go v0.1.2`，不使用同级源码 replace。

配置四项：`FASTNEWS_FASTCAS_ISSUER`、`FASTNEWS_FASTCAS_CLIENT_ID`、`FASTNEWS_FASTCAS_CLIENT_SECRET`、`FASTNEWS_FASTCAS_REDIRECT_URI`。部分配置会启动失败，未配置时不会发起中心请求。登录/绑定还可分别通过 `FASTNEWS_FASTCAS_LOGIN_ENABLED` 和 `FASTNEWS_FASTCAS_LINK_ENABLED` 关闭；本地密码与恢复保持独立。

`/api/auth/fastcas/` 保留 `available/login/callback/status/link/reconcile/revoke/events/backchannel-logout`。本地账号绑定需要当前会话、密码和 CSRF。事务持久化并原子消费，回调绑定原浏览器，pending 关系可对账；同邮箱或同名不会自动创建或合并账号。

签名通知经 SDK 验证后在 SQLite 事务内去重、更新关系、撤销对应 CAS 来源会话。解绑、停用或后端退出不会删除本地用户、个人内容与本地密码会话。会话有效性每五分钟复核关系；refresh token 使用 AES-GCM 并绑定来源会话。

Research 内容只有在账号页显式验证 Key 并导入，或启用委托连接并得到用户同意后才会读取。快照默认拒绝覆盖本地内容。持续连接需要 `FASTNEWS_FASTCAS_RESEARCH_CONNECT=true`、独立 vault key 以及中心的相应 scope 和 token exchange 策略。

迁移和本地验收范围见 [Go / React 重构](go-react-migration.md)，接口与 CSRF 使用见 [API 说明](api.md)。正式上线前需与实际身份提供方完成环境验收。
