# FastNews Go / React 部署

发布包包含静态链接的 Linux Go 二进制 `bin/fastnews`、React `web/dist` 和 systemd 样例。业务语料、SQLite、`.env` 和开发依赖不进入发布包。阅读跳转资源由前端构建复制到 `web/dist/reports/`，历史报告的资源地址由 Go 提供兼容映射。

```bash
make install
make test
pnpm --dir web exec playwright install --with-deps chromium
make test-browser
# 浏览器测试使用根路径；发布前按生产路径重建。
FASTNEWS_PUBLIC_PATH=/news make build-release
./scripts/package-release.sh
```

包位于 `dist/release/release.tar.gz`，`manifest.json` 记录 repository、commit SHA 与 archive SHA256。正式发布使用 CI 对确切提交构建的包。

## GitHub Actions

| 工作流 | 触发 | 行为 |
| --- | --- | --- |
| `ci.yml` | main 的 PR / 推送、`v*` 标签、手动 | Go race / vet、格式检查、桌面/手机/子路径/私有报告浏览器测试、原生构建和产物上传；标签检查通过后发布 GitHub Release |
| `update.yml` | 每日 06:00 UTC、手动 | Go 采集 BleepingComputer、arXiv CS.CR / CS.AI |
| `gen_newspaper.yml` | 每日 22:30 UTC、手动 | Go 生成中文摘要、日报，提交检查点 |
| `conf_release.yml` | 手动选择会议与年份 | Go 采集、摘要、HTML/PDF，提交数据并发布该会议报告 |
| `weekly_release.yml` | 每周六 06:00 UTC、手动 | Go 生成周报 HTML/PDF，提交 HTML 并发布附件 |

数据任务仅在 main 运行，共用并发组，避免互相覆盖提交。它们只提交指定数据目录；生成失败时仍尝试保存已有检查点，失败状态保留。报告发布可重跑更新附件，无需删除原 Release 或标签。生成摘要需要仓库 secrets `OPENAI_API_KEY`，可选 `OPENAI_BASE_URL`、`LLM_MODEL`。

CI 产物保留七天，`v*` 标签的包发布到 GitHub Releases。发布步骤只上传验证通过的原生包，不连接服务器或重启服务。旧运行时对应的部署、回滚工作流已移除。

## FastDeploy 接入

[Go profile 样例](../deployments/fastdeploy-profile.json) 定义原生命令、健康检查和共享目录。平台必须支持该 profile 的 `bin` / `web` 产物与 `release_env` 后才能接入；仓库没有调用旧平台部署工作流。

生产 runtime-env 至少设置：

```env
FASTNEWS_HOST=127.0.0.1
FASTNEWS_PORT=8788
FASTNEWS_ROOT=/home/dev/FastNews
FASTNEWS_DATA_DIR=/home/dev/FastNews/.fastnews-data
FASTNEWS_WEB_DIR=<release>/web/dist
FASTNEWS_PUBLIC_PATH=/news
FASTNEWS_PUBLIC_ORIGIN=https://news.fastrd.io
FASTNEWS_COOKIE_SECURE=true
```

`<release>` 为实际发布目录；profile 使用 `{release}` 占位。域名根路径部署时，前端构建和后端运行的 `FASTNEWS_PUBLIC_PATH` 同时设为空。`FASTNEWS_ROOT` 保留现有语料和报告，`FASTNEWS_DATA_DIR` 保留独立账号库。

## systemd / nginx

可直接使用 [systemd 样例](../deployments/fastnews.service) 和 [nginx 样例](../deployments/nginx.conf)。业务数据由服务用户持有。`scripts/deploy-local.sh` 用于原生服务的本机构建部署，会检查 unit 启动 Go、安装冻结依赖、测试、构建、重启并检查健康状态；运行前需配置生产环境和前端构建路径。

Go 默认同时提供 SPA。前后端独立部署时，nginx 提供 `web/dist`，将同源 `/news/api/`、`/news/top-conf/data/`、`/news/secnews/data/` 转发到 Go，并确保历史报告的 `/news/assets/fastread.js`、`/news/assets/fastread.css` 转发到 Go 或映射到新资源。

回滚使用已归档并验证过的原生发布包，切换发布目录后重启同一 Go unit。SQLite、语料和报告保持在独立共享目录，代码发布与回滚均不清理业务数据。
