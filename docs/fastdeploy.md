# FastNews Go / React 部署

发布包包含静态链接的 Linux Go 二进制 `bin/fastnews` 和 React `web/dist`。业务语料、SQLite、`.env` 和开发依赖不进入发布包。阅读跳转资源由前端构建复制到 `web/dist/reports/`，历史报告的资源地址由 Go 提供兼容映射。

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
| `ci.yml` | main 的 PR / 推送、`v*` 标签、手动 | Go race / vet、格式检查、桌面/手机/子路径/私有报告浏览器测试、原生构建和产物上传；标签检查通过后发布 GitHub Release 并部署 fastrd |
| `update.yml` | 每日 06:00 UTC、手动 | Go 采集 BleepingComputer、arXiv CS.CR / CS.AI |
| `gen_newspaper.yml` | 每日 22:30 UTC、手动 | Go 生成中文摘要、日报，提交检查点 |
| `conf_release.yml` | 手动选择会议与年份 | Go 采集、摘要、HTML/PDF，提交数据并发布该会议报告 |
| `weekly_release.yml` | 每周六 06:00 UTC、手动 | Go 生成周报 HTML/PDF，提交 HTML 并发布附件 |

数据任务仅在 main 运行，共用并发组，避免互相覆盖提交。它们只提交指定数据目录；生成失败时仍尝试保存已有检查点，失败状态保留。报告发布可重跑更新附件，无需删除原 Release 或标签。生成摘要需要仓库 secrets `OPENAI_API_KEY`，可选 `OPENAI_BASE_URL`、`LLM_MODEL`。

CI 产物保留七天，`v*` 标签的包发布到 GitHub Releases。普通 main 提交和手动验证不部署。推送 `v*` 标签后，CI 通过 production Environment 用 HTTPS 上传经过验证的原生包。服务器仍由固定版本的 FastDeploy 原子切换、启动服务并进行健康检查，失败时恢复前态。

## FastDeploy 接入

[Go profile](../deployments/fastdeploy-profile.json) 与 FastDeploy v2.0.3 的 FastNews 配置同步，定义原生命令、健康检查和共享目录。接收端只用服务器上固定版本的 profile、`remote.py` 和 `launch.py`，不执行上传方提供的部署脚本，也不接收运行时密钥。`FASTNEWS_WEB_DIR` 由平台指向当前发布目录内的前端。

### 首次启用 HTTPS 接收端

以下命令在生产机执行，使用现有运行 `fastnews.service` 的用户。先确认有可用的 Go 1.26 工具链（也可在 CI 之外交叉构建后由管理员安装接收端二进制）、FastDeploy 所需的 Python 3.12 和 `jq`。

```bash
umask 077
config="$HOME/.config/fastnews-deploy"
engine="$HOME/.local/share/fastnews-deploy/FastDeploy"
install -d -m 0700 "$config" "$(dirname "$engine")" "$HOME/.local/bin" "$HOME/.config/systemd/user"
CGO_ENABLED=0 go build -trimpath -o "$HOME/.local/bin/fastnews-deploy" ./cmd/fastnews-deploy
git clone --no-checkout https://github.com/FastR-D/FastDeploy.git "$engine"
git -C "$engine" checkout --detach 30ef06dac8aa820a9550a22799b72025609b36fd
```

在 `~/.config/fastnews-deploy/runtime.json` 配置 FastNews 运行环境，格式为 JSON 字符串键值对象。若已有 FastDeploy 发布，可迁移当前版本的本地配置，不把密钥传回 GitHub：

```bash
if [ ! -e "$config/runtime.json" ]; then
  jq -e '.env | select(type == "object") | del(.FASTNEWS_WEB_DIR)' \
    "$HOME/ci-releases/news/current/.fastdeploy/runtime.json" > "$config/runtime.json.tmp" &&
    mv "$config/runtime.json.tmp" "$config/runtime.json"
fi
```

如果没有可迁移的配置，按现有生产配置填写（下方有基础示例），确认 `runtime.json` 已就绪后再启动接收端：

```bash
if [ ! -s "$config/token" ]; then
  openssl rand -hex 32 > "$config/token"
fi
chmod 0600 "$config/runtime.json" "$config/token" &&
install -m 0644 deployments/fastnews-deploy.service "$HOME/.config/systemd/user/fastnews-deploy.service" &&
systemctl --user daemon-reload &&
systemctl --user enable --now fastnews-deploy.service
```

将 `deployments/nginx-upload.conf` 的精确路径配置加入部署域名的 **HTTPS** server 块，执行 `nginx -t` 后再 reload。接收器默认监听 `127.0.0.1:8790`，可以用 `--listen` 指定反代或 SSH relay 对应的回环地址和端口。只代理该路径，保持接收端口仅限回环。入口应直接到 TLS 反代，前置 CDN 的请求时限短于激活时间时可使用专用 TLS 域名。反代日志应排除 Authorization 请求头。

在 GitHub 仓库的 `production` Environment 中添加变量 `FASTNEWS_DEPLOY_URL`（例如 `https://news.fastrd.io/__fastnews/deploy`），并把服务器 `token` 文件的值设为 Secret `FASTNEWS_DEPLOY_TOKEN`。该令牌具有生产发布权限，不提供给应用或其他仓库。FastCAS、模型等密钥只放在服务器的 `runtime.json`，轮换时更新本地文件并重启接收端。原有组织 SSH Secrets 仍可能被其他项目使用，不需要删除。

打新标签前，对 HTTPS 入口发一个无令牌的空 `POST`，预期返回 401；404 表示路由未接入，502 表示接收端不可用。正式部署返回 200 才表示 FastDeploy 完成激活和本机健康检查。上传或激活失败时查看 `journalctl --user -u fastnews-deploy.service`；不要用同一个运行强行覆盖失败后保留的发布目录。

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://news.fastrd.io/__fastnews/deploy
```

确认新工作流已推送到 GitHub，再从包含这次改动的提交打新标签。例如：

```bash
git tag -a v2026.11.19.2 -m "Deploy FastNews over HTTPS"
git push origin v2026.11.19.2
```

每次部署使用新的版本标签，不移动或复用已发布标签。news 独立域名的根入口由浏览器规范化到 `/news/`，兼容网关 strip-prefix；API 与 FastCAS 回调同时支持原根路径。

生产 `runtime.json` 的基础配置示例：

```json
{
  "FASTNEWS_HOST": "127.0.0.1",
  "FASTNEWS_PORT": "8788",
  "FASTNEWS_ROOT": "/home/dev/FastNews",
  "FASTNEWS_DATA_DIR": "/home/dev/FastNews/.fastnews-data",
  "FASTNEWS_PUBLIC_PATH": "/news",
  "FASTNEWS_PUBLIC_ORIGIN": "https://news.fastrd.io",
  "FASTNEWS_COOKIE_SECURE": "true"
}
```

保留现有 FastCAS 的 `FASTNEWS_FASTCAS_ISSUER`、`FASTNEWS_FASTCAS_CLIENT_ID`、`FASTNEWS_FASTCAS_CLIENT_SECRET` 和 `FASTNEWS_FASTCAS_REDIRECT_URI`，以及当前服务使用的其他环境变量。不使用 FastCAS 时才显式设 `FASTNEWS_FASTCAS_ENABLED` 为 `"false"`。不要手工设置 `FASTNEWS_WEB_DIR`，FastDeploy 会按当前版本生成。域名根路径部署时，前端构建和后端运行的 `FASTNEWS_PUBLIC_PATH` 同时设为空。`FASTNEWS_ROOT` 保留现有语料和报告，`FASTNEWS_DATA_DIR` 保留独立账号库。

## systemd / nginx

可直接使用 [systemd 样例](../deployments/fastnews.service) 和 [nginx 样例](../deployments/nginx.conf)。业务数据由服务用户持有。`scripts/deploy-local.sh` 用于原生服务的本机构建部署，会检查 unit 启动 Go、安装冻结依赖、测试、构建、重启并检查健康状态；运行前需配置生产环境和前端构建路径。

Go 默认同时提供 SPA。前后端独立部署时，nginx 提供 `web/dist`，将同源 `/news/api/`、`/news/top-conf/data/`、`/news/secnews/data/` 转发到 Go，并确保历史报告的 `/news/assets/fastread.js`、`/news/assets/fastread.css` 转发到 Go 或映射到新资源。

回滚使用已归档并验证过的原生发布包，切换发布目录后重启同一 Go unit。SQLite、语料和报告保持在独立共享目录，代码发布与回滚均不清理业务数据。
