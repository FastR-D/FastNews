# FastNews 账号与 FastCAS

设置 `FASTNEWS_INVITE_CODE` 后启用本地账号。注册、登录、恢复和个人资料使用 `fastnews_session`；未绑定 Research 的 FastCAS 身份会回到登录页，不会创建本地账号。

FastCAS 是可选入口，需要同时配置 issuer、client ID、secret 和 redirect URI。已有本地账号可以在账号页输入本地密码发起绑定。Research 内容只有在用户明确证明 Research 会话并执行导入后才进入本地资料；导入会保存计数和内容 hash。

公开报告生成不需要 CAS。没有本地会话时，未启用本地账号的旧部署继续使用 Research 门户跳转；启用邀请注册后，首页进入本地登录页。启用 CAS 时安装 FastCAS Python SDK 的依赖 `authlib` 和 `httpx`。
