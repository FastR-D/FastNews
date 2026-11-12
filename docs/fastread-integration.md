# FastRead 连接

在账号页的 **FastRead 联动** 卡片生成连接码，将连接码粘贴到 FastRead 的 FastNews 设置。FastRead 可以读取当前个人印象，并将所选论文提炼出的方向追加或替换到这里。个人印象最多 4000 字。

连接码只在生成时显示，归当前 FastNews 本地账号所有。重新生成立即替换旧连接码；撤销连接后，原连接码立即失效。FastCAS 登录的已绑定账号也使用同一份本地个人内容。

## 接口

| 接口 | 认证 | 内容 |
| --- | --- | --- |
| `GET /api/integrations/fastread/token` | 当前会话 | 返回 `{connected, created}` |
| `POST /api/integrations/fastread/token` | 当前会话及 `X-CSRF-Token` | 生成并返回 `{connected, token}` |
| `DELETE /api/integrations/fastread/token` | 当前会话及 `X-CSRF-Token` | 撤销连接 |
| `GET /api/integrations/fastread/directions` | `Authorization: Bearer <连接码>` | 返回 `{text, updatedAt}` |
| `PUT /api/integrations/fastread/directions` | 同上 | 接收 `{text, mode: "append" \| "replace"}`，返回保存后的内容 |

`append` 在现有个人印象后追加一个空行和新方向；`replace` 保存新方向。服务端校验归属账号仍处于启用状态，数据库保存连接码摘要，不保存连接码原文。News 论文页原有的导入 FastRead 按钮继续使用现有元数据交接入口。
