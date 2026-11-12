# FastUI 0.3.0

React 前端固定使用公开 npm 包 `@fastrd/ui-react@0.3.0` 和 `@fastrd/ui-foundation@0.3.0`，依赖与完整性校验记录在 `web/pnpm-lock.yaml`。执行 `make install` 安装冻结依赖，`make build` 构建，无同级源码 alias 或本地 vendor。

## 组件与样式边界

旧的 `web/src/style.css` 和 `web/public/reports/report.css` 已全部删除。应用没有手写 CSS、组件样式覆盖、产品色板或内联样式。布局、间距、响应式和排版使用 UnoCSS 工具类；背景、正文及辅助文字直接引用 FastUI 语义 token，不重新声明 token。

`web/uno.config.ts` 组合官方 `presetFastUI`、`fastUIContent` 与 `presetWind3`。FastUI 负责控件与组件的配色、字体、尺寸、圆角、焦点、状态及触控密度，UnoCSS 负责宿主布局。

- 工作台：`Toolbar`、`PanelHeader`、`InspectorSection`、`StatusBar`。
- 内容：`Section`、`ListRow`、`AssetCard`、`TabBar`、`SegmentedControl`。
- 表单与反馈：`Button`、`TextField`、`TextArea`、`Select`、`Checkbox`、`Dialog`、`Alert`、`Badge`、`Loading`、`EmptyState`。
- 原生 HTML：官方 `fastui-link`、`fastui-heading`、`fastui-field`、`fastui-fieldset`、`fastui-legend`、`fastui-table`、`fastui-table-scroll`、`fastui-progress`，链接形式的按钮使用官方 `fastui-button` 类。

新增页面应组合这些组件与工具类，不添加自定义 CSS 文件、不覆盖 `.fastui-*` 选择器，不以高优先级工具类改变官方控件的颜色、尺寸或交互状态。

## 应用结构

`web/src/context.tsx` 管理资料库、账号、CSRF 和通知，资料库支持失败重试。`web/src/App.tsx` 组合导航与路由，各页面按路由延迟加载；`navigation.tsx` 集中定义入口。`components/Common.tsx` 提供基于 FastUI 的页面标题、面板、指标、报告列表、论文摘要和分页。`ImpressionDialog.tsx` 独立管理研究印象编辑。

桌面仅保留一套宽版可折叠分组导航，参考 FastWrite `/panel`：56px 单层顶栏、左侧品牌和收起按钮、右侧账号与主题操作；侧栏为 224px（中等桌面 200px）的语义浅灰底，上方研究操作入口，下方左对齐的分组导航及数量。选中状态直接使用 FastUI quiet 按钮，不另外绘制选中条。手机使用官方 Dialog 打开同一导航。总览报告库支持页签键盘操作、名称筛选和下载。论文检索条件写入 URL，刷新、浏览器前进后退及全站搜索复用同一状态。领域导读和总结汇报独立挂载，切换时不遗留另一种生成结果。

`web/src/theme.ts` 只初始化一个 foundation controller，沿用 `fastresearch-theme`，缺失时迁移 FastNews 的历史主题偏好；页面与按钮共用该 controller。

## 归档报告

归档 HTML/PDF 是出版文档，保留归档内嵌的正文、布局和打印样式。它们不加载 React 应用外壳。

报告阅读按钮通过 `web/public/reports/handoff.js` 直接使用官方 foundation 控件类。`web/vite.config.ts` 从已安装的 npm 包读取未修改的 `tokens.css` 与 `controls.css`，构建为 `reports/report.css`，开发模式也提供该资源。此文件是构建产物，源码中没有另一套报告按钮样式；历史 `/assets/fastread.css` URL 继续映射到这个资源。

## 验证

`make test-browser` 覆盖桌面、手机、`/news` 子路径、私有报告、登录与个人内容、历史报告阅读跳转、页签键盘操作、报告筛选、导航收起与弹窗、论文筛选持久化及全站搜索。`pnpm --dir web format:check` 检查格式。Go 静态文件测试验证归档资源映射与发布目录边界。
