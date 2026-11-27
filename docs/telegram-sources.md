# Telegram 通报：调研结果与本地读取准备

已核验的两个公开频道是 [cibsecurity](https://t.me/s/cibsecurity) 和 [cyber_security_channel](https://t.me/s/cyber_security_channel)。前者样例有原媒体链接，后者还包含标注广告。发现出处、消息时效和其他候选见[信源报告](source-research-2026-11-27.md)。没有启动 bot、加入群、发送消息或使用任何用户凭据。

## 已准备的入口

`scripts/telegram/reader.py` 是一个可选的本地个人读取器，使用 Telegram API 和 Telethon，独立于 Go/React 服务。它只访问配置中显式启用的公开 username；支持公开频道/群和已有 bot 对话，不读取个人联系人聊天，也不自动加入群或发送 `/start`。

默认读取近 2 天最多 200 条消息，保存当前窗口快照。每条包含来源、消息 ID、时间、编辑时间、消息原链（公开频道/群）、原始文本和嵌入式外链。普通文本 URL 仍保留在文本中；不是完整的链接解析/事件聚合器。若消息超过数量上限，输出 `truncated: true`，不能宣称抓取完整。

快照和会话只写到被 Git 忽略的 `.fastnews-data/telegram/`，目录权限 0700、快照 0600。重复读取替换同一源快照，抓取失败保留上次成功文件；不下载媒体，不无限回填历史。Telegram 限流时记录错误类型并退出该源，不执行长时间自动重试。

此入口**尚未使用真实账号验收**。已通过不联网的配置、消息出处和私有文件权限测试。它不是成熟的常驻客户端或自动化部署，运行时还需要用户自己的 API 凭据、登录和最终频道选择。

## 在自己的终端配置

用户 API 与 Bot Token 不同。[Telegram 官方文档](https://core.telegram.org/api/obtaining_api_id) 要求在自己的开发者账号取得 `api_id` 和 `api_hash`；[消息历史方法](https://core.telegram.org/method/messages.getHistory) 只供用户账号调用。Bot Token 不替代用户会话读取任意第三方频道历史。

在仓库根目录运行：

```bash
mkdir -p .fastnews-data/telegram
chmod 700 .fastnews-data/telegram
cp config/telegram-sources.example.json .fastnews-data/telegram/sources.json
python3 -m venv .fastnews-data/telegram/venv
.fastnews-data/telegram/venv/bin/pip install -r scripts/telegram/requirements.txt

# 在本地终端输入，不粘贴到聊天、仓库或 shell 命令历史。
read -r -p 'Telegram API ID: ' TELEGRAM_API_ID
read -r -s -p 'Telegram API Hash: ' TELEGRAM_API_HASH
export TELEGRAM_API_ID TELEGRAM_API_HASH

# 交互输入自己的手机号、验证码和已有两步验证密码。
.fastnews-data/telegram/venv/bin/python scripts/telegram/reader.py --login
```

示例配置全部 `enabled: false`。将需要读取的频道改为 `true`，然后执行：

```bash
.fastnews-data/telegram/venv/bin/python scripts/telegram/reader.py --days 2 --limit 200
```

失败时日志只打印源 ID 和错误类型，避免泄露账号信息。凭据不写进 JSON 配置；会话文件本身具有登录能力，应只保留在本地。不要对 `.fastnews-data/telegram/` 启动公共静态文件服务；本轮也没有把该目录挂入现有 Web 静态目录。

撤销时，在 Telegram 官方客户端的设备/活动会话页面终止对应会话，并清理本地保存；删除本地文件本身不等于撤销服务器会话。Telethon 对会话作用的说明见[官方库文档](https://docs.telethon.dev/en/stable/concepts/sessions.html)。

## 复用已有总结的方式

本地读取器不会把消息写入 `secnews/data/articles/`，不会调用 LLM、向量模型，也不自动转发/公开。理由来自实际读到的条款：[Telegram API 条款 1.5](https://core.telegram.org/api/terms) 和[内容许可条款](https://telegram.org/tos/content-licensing) 对内容用于 AI 作了限制，并规定具体内容/上下文的同意条件；频道作者也可能另有转载条件。拥有账号仅解决访问身份。

可直接推进的路径是：先个人阅读通报，发现有用的**原媒体/研究机构来源**，再按原站提供的 RSS/API 接入。对于已经拿到适用授权的摘要，可以后续设计单独导入规则，保留作者、频道消息链、原始外链、编辑时间与许可记录；不要把“Telegram 聚合站 → 同一媒体”重复算成多源佐证。

若要上线持续读取，还需完成目标频道配置、用户本人登录、真实消息与限流验收，以及所选内容用途的确认。本轮没有请求用户在对话中提供密钥、验证码或 session。
