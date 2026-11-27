# 工作台界面规范

前端保留 FastUI 0.3.0 的可访问组件，统一由 `web/src/components/Reading.css` 管理产品主题、排版、控件与响应式布局。参考通过 Edge 扩展查看的 [HeroUI Card](https://heroui.com/en/docs/react/components/card) 实践：用表面层级区分内容、统一圆角与间距、明确键盘焦点与亮暗选中态。没有另行安装 HeroUI 组件库。

## 布局与字体

所有业务页面共享 `workspace-content`：桌面边距 32px、平板 24px、手机左右 16px，最大内容宽度 1440px。页面不再自行增加第二层最大宽度或左右边距；专注文章阅读可以控制正文行宽。`PageHeading` 和 `ReadingHeader` 只显示标题与必要操作，不加图标和描述段落。

字体使用 [HarmonyOS Sans SC 分片 CDN](https://www.jsdelivr.com/package/npm/harmonyos-sans-sc-webfont-splitted)，固定 1.1.0，`font-display: swap`；网络失败时使用系统中文字体。正文 14px，文章阅读 16–18px。正文、按钮、输入框和侧栏统一字体。CDN 为 jsDelivr 社区镜像，字体协议沿用 HarmonyOS Sans Fonts License Agreement。

配色集中定义 FastUI 语义变量，亮暗各一套。深色侧栏选中项使用浅色文字，不能复用浅色模式的深蓝字。卡片圆角 16px，控件圆角 10px，表单高度 40px，手机触控目标至少 44px。通知横幅左上、左下为直角，右侧沿用统一圆角。不要在单个页面另建配色或复制控件规则。

## 内容与交互

首页保留统计、报告库、研究资讯和个人研究内容。信源目录只展示来源、主题、状态和简介；调研证据仍在仓库文档及 API 数据中，不放进日常浏览界面。错误信息、表单标签、来源、日期和研究证据限制属于必要信息；宣传、重复说明和实现细节不展示。

报告通过 `/report/?path=…` 在 React 工作台内阅读。报告数据是有限标签的文档树，React 创建节点，不使用 iframe、`dangerouslySetInnerHTML` 或归档脚本。论文阅读调用现有 FastRead API，PDF 使用下载链接。19 份历史报告已转换为 JSON，旧 HTML 页面、handoff 脚本、报告样式和旧 `/index.html`、`/auth/login` 等兼容入口已删除。新的报告任务直接生成 JSON；HTML 仅作为 PDF 导出的临时打印输入。

全站默认登录保护。未登录只显示账号表单，业务 API、报告及原始数据都由服务端校验会话；登录后返回原先请求的页面。管理员可以使用 `fastnews create --admin --email … --name …` 配置，密码通过交互输入或 `FASTNEWS_INITIAL_PASSWORD` 传入。

## 验证

运行 Go race/vet、根路径和 `/news` 构建，以及 Playwright 桌面、手机、子路径、登录模式回归。界面检查覆盖统一边距、320px 顶栏、亮暗对比、字体、报告站内阅读和删除项。测试使用独立数据目录，管理员密码不进入仓库或测试日志。

本轮验证：Go race/vet 通过；桌面、手机、子路径和登录模式共 49 项通过、2 项按项目跳过；末轮资讯/信源/报告 15 项定向回归通过。HarmonyOS CDN CSS 返回 200，浏览器实测加载 11 个字体分片。

论文使用独立卡片，右上角排列「阅读原文」与「跳转 FastRead」，摘要使用浅底阅读区。资讯与 arXiv 统一使用日期输入组件和「最新」快捷操作。领域导读的查询与筛选行同边对齐。管理员工作台使用 FastWrite 风格的用户表格与编辑弹窗，定时计划位于采集后台首屏，展示频率、下次执行时间与启停状态，手动补采独立操作。任务表区分定时/手动触发，信源结果表沿用相同边距、行高与亮暗状态色。

账号菜单仅包含账号设置和退出登录。账号设置只呈现账号信息编辑与 FastCAS 认证；移除独立 FastRead 连接码、Research Key 与快照导入界面，跨应用授权复用已绑定的 FastCAS 身份与现有服务接口。实例尚未配置 FastCAS 时明确显示未启用，不伪造认证状态。

本轮验证涵盖论文卡片、日期筛选、表单对齐、管理员用户编辑、定时计划启停、采集任务监控和账号资料持久化；Go race/vet 与桌面、手机、子路径回归通过。真实服务首轮定时采集 14 个信源，13 个完成、新增 3 条，BleepingComputer 的 HTTP 403 已记录；本地 FastCAS 尚未配置，跨应用实网认证不计作已验收。
