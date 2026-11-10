# FastUI 0.1.0

构建时执行，生成资产与页面一同部署：

```sh
python scripts/supply_fastui.py
python generate_homepage.py
```

离线构建可将第一条改为 `python scripts/supply_fastui.py --artifact /path/to/fastrd-ui-foundation-0.1.0.tgz`。两种入口校验同一个固定 SHA-256；`assets/fastui/provenance.json` 记录版本、release URL、包摘要和逐文件摘要。该目录是生成物，升级时改供应脚本的版本和摘要并重新构建；不编辑供应的 CSS/JS。运行时只请求本站资产，无 npm/CDN。

主页模板生成根页面和 top-conf、secnews、field-briefing、summary-brief、inbox、impression 七个入口。head 从 `asset_prefix` 同步加载经典脚本 `fastui/theme-init.js`，先迁移旧 key 再由唯一 foundation controller 初始化首屏；`gate.js` 放行内容前颜色已解析。`assets/theme.js` 为 defer 脚本，只连接同一 controller 的按钮/图标，不再初始化或监听系统/storage。

沿用 `fastresearch-theme`，缺失时一次性读取旧 `fastnews.theme`；保留 `light/dark/system`，不双写，不由 pageshow 维护第二套主题。供应器将已校验的 foundation `index.js` 去掉固定 ESM export list，再与 `scripts/theme-init.js` 适配代码封装成经典入口；源文件与生成文件摘要都进入 provenance。不会手工 vendor 或修改 foundation 实现。

会议/资讯报告是固定浅色出版文档：`assets/report.css` 单独拥有纸张、正文和打印颜色；screen chrome 使用同一蓝灰出版配色，报告不加载站点 workbench CSS、foundation 颜色 bootstrap，也不读取读者的 storage/OS 主题。模板已删除旧的深色 media/绿色 console 色板，输出内嵌出版 CSS；主页生成器为既有19份归档移除上一轮主题注入并内嵌相同出版边界，保留正文与布局。打印为白底深字，禁用 JS 仍成立。

本变更没有新增归档对外部 UI 包的运行依赖；历史 FastRead CSS/JS 链接仍存在，因此不将整个下载 HTML 宣称为完全自包含。正文和报告数据不会进入 FastUI 包。

账号页源模板为 `prompt/account.html`，供应脚本生成 `assets/account.html` 并内嵌颜色资产；private 模式认证前无需请求被登录保护的 `/assets` 文件。修改账号界面应改源模板后重新执行供应脚本。

主题/打印回归：设置 `PYTHONPATH=.` 后执行 `python tests/theme_print_browser.py /path/to/chromium /path/to/evidence`（需要 Playwright、WeasyPrint、PyMuPDF 和平台 Pango）。覆盖延迟应用脚本首屏、同一 controller 的按钮、OS/保存偏好相反组合、模板/真实归档 screen/print、Git HEAD 对照、全部归档打印及真正 WeasyPrint PDF/像素/文本。Windows 可通过 `WEASYPRINT_DLL_DIRECTORIES` 指向已有 Pango/GTK DLL。
