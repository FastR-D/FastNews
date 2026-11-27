# FastRead 连接

账号页只保留 FastCAS 认证，不再展示单独的 FastRead 连接码配置。跨应用服务根据已绑定的同一 FastCAS 身份授权；个人印象仍按账号隔离，最多 4000 字。

以下连接码接口作为已有服务调用的兼容接口保留，页面不再提供生成、复制和撤销连接码操作。推荐使用下文的 CAS 服务认证。

| 接口 | 认证 | 内容 |
| --- | --- | --- |
| `GET /api/integrations/fastread/token` | 当前会话 | 返回 `{connected, created}` |
| `POST /api/integrations/fastread/token` | 当前会话及 `X-CSRF-Token` | 生成并返回 `{connected, token}` |
| `DELETE /api/integrations/fastread/token` | 当前会话及 `X-CSRF-Token` | 撤销连接 |
| `GET /api/integrations/fastread/directions` | `Authorization: Bearer <连接码>` | 返回 `{text, updatedAt}` |
| `PUT /api/integrations/fastread/directions` | 同上 | 接收 `{text, mode: "append" \| "replace"}`，返回保存后的内容 |

`append` 在现有个人印象后追加一个空行和新方向；`replace` 保存新方向。服务端校验归属账号仍处于启用状态，数据库保存连接码摘要，不保存连接码原文。News 论文页原有的导入 FastRead 按钮继续使用现有元数据交接入口。

## 同一 CAS 身份连接

两端认证同一 CAS 账号后，服务间通过 CAS 身份建立连接，FastNews 账号页不再暴露应用联动设置。接收端新增 `POST /api/integrations/fastread/cas-connect`，仅接收服务身份 `fastread-sync`、scope `fastread:connect`、audience 为本应用实际 CAS client ID 的有效令牌。中心需将本应用 client ID 加入该服务身份 resources；其密钥只配置在 Read 的 `FASTREAD_SYNC_CLIENT_SECRET`。

subject 由 Read 从当前登录账号绑定确定；News 校验中心与本地绑定一致，不按邮箱映射或自动开户。连接凭证固定 CAS 绑定 ID 与版本，每次使用复核。解绑、重绑或账号停用使旧连接失效。手动连接方式保留。

本地 News 账号现在可直接交接论文元数据，无须 Research 授权；要求会话与 CSRF。已绑定 CAS 时入口携带 `auth=cas`，由 Read 发起自己的 CAS 登录；浏览器 URL 不含源应用会话或连接码。旧 Research SSO 票据路径保持兼容。`FASTREAD_URL` 同时用于论文与连接页面跳转。

验证：`go test ./internal/httpapi ./internal/store` 与前端构建。CAS 服务校验使用隔离 SDK fixture，实际中心授权需按部署配置登记。
