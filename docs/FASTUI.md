# FastUI 0.3.0

React 前端固定使用公开 npm 包 `@fastrd/ui-react@0.3.0` 和 `@fastrd/ui-foundation@0.3.0`，依赖与完整性校验记录在 `web/pnpm-lock.yaml`。执行 `make install` 安装冻结依赖，`make build` 构建，无同级源码 alias 或本地 vendor。

`web/uno.config.ts` 使用官方 `presetFastUI` 和 `fastUIContent`，页面通过 FastUI 控件、工作台组件与语义 token 组成。`web/src/theme.ts` 只初始化一个 foundation controller，沿用 `fastresearch-theme`，缺失时迁移 FastNews 的历史主题偏好；页面与按钮共用该 controller。

归档 HTML/PDF 是出版文档，保留归档内嵌的固定浅色正文、布局和打印样式，不依赖读者应用主题。历史阅读按钮资源 URL 由 Go 映射到 `web/public/reports/` 的新实现，生产构建自动将资源复制进 `web/dist/reports/`。新报告由 Go 模板生成，不加载应用主题控制脚本。

旧静态站点、供应脚本、0.1.2 vendor 和对应测试已删除。桌面、手机、子路径、私有报告及历史阅读跳转由 `make test-browser` 验证；Go 的静态文件测试验证归档资源映射与发布目录边界。
