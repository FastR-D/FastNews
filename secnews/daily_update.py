"""每日新闻更新流水线：抓取 → LLM 概括 → 刷新页面 → 提交推送。

设计给 Windows 任务计划程序（或 cron）每日调用，与 GitHub Actions 的
update.yml / gen_newspaper.yml 共享同一仓库。gen_newspaper 需要仓库 secrets，
本机跑则直接使用 FastNews/.env 中的 LLM 配置，作为 CI 失败时的兜底。

流程：
  1. 抓取三个源（bleepingcomputer / arxiv_cs_cr / arxiv_cs_ai），单个源失败不阻塞其余
  2. 对最近 N 天中「尚无摘要 / complete=false / 摘要数落后于文章数」的日期
     运行 generate_daily_summary（内置 checkpoint，已概括的文章自动跳过）
  3. 重新生成 index.html / secnews/index.html / top-conf/index.html
  4. git add → commit → pull --rebase → push（无变化则跳过）

rebase 若因远端（CI）同时改写同一 JSONL 而冲突，会放弃 rebase 并以非零码
退出，绝不强推；由人工或下次运行对齐后重试。

用法（工作目录任意，脚本会自行切换到项目根；注意要用文件路径而非 -m，
因为 -m 的模块查找依赖调用方的工作目录）：
  E:\\project\\FastRead\\FastNews\\.venv\\Scripts\\python.exe E:\\project\\FastRead\\FastNews\\secnews\\daily_update.py
可选：
  --days N       概括最近 N 天（默认 3，UTC 日期）
  --no-git       只抓取与概括，不执行 git 提交推送
  --skip-fetch   跳过抓取（只概括 + 刷新页面 + 推送）
  --dry-run      只打印将要做的事，不真正执行
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ("bleepingcomputer", "arxiv_cs_cr", "arxiv_cs_ai")
SUMMARIES_DIR = ROOT / "secnews" / "data" / "daily_summaries"
ARTICLES_DIR = ROOT / "secnews" / "data" / "articles"
GIT_PATHS = ["secnews/data", "index.html", "secnews/index.html", "top-conf/index.html"]
BRANCH = "main"

# 子进程统一 UTF-8，避免 Windows GBK 控制台下的 UnicodeEncodeError
CHILD_ENV = dict(os.environ, PYTHONIOENCODING="utf-8")


def log(message: str) -> None:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"[{stamp}] {message}", flush=True)


def run(command: list[str], *, check: bool = True, capture: bool = False):
    result = subprocess.run(
        command,
        cwd=ROOT,
        env=CHILD_ENV,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=capture,
    )
    if check and result.returncode != 0:
        tail = (result.stderr or result.stdout or "")[-500:]
        raise RuntimeError(f"命令失败 ({result.returncode}): {' '.join(command)}\n{tail}")
    return result


def article_line_count(date_text: str) -> int:
    path = ARTICLES_DIR / f"{date_text}.jsonl"
    if not path.exists():
        return 0
    with path.open(encoding="utf-8") as handle:
        return sum(1 for line in handle if line.strip())


def pending_summary_dates(days: int) -> list[str]:
    """最近 N 天中需要（重新）概括的日期。

    三种情况视为 pending：无摘要文件 / complete=false / article_count 落后于
    jsonl 行数（同一天后续又抓到了新文章）。第三种交给 checkpoint 处理，
    已概括的文章会自动跳过，只补增量。
    """
    dates: list[str] = []
    today = datetime.now(timezone.utc).date()
    for offset in range(days):
        date_text = (today - timedelta(days=offset)).isoformat()
        if not article_line_count(date_text):
            continue  # 当天还没有抓到任何文章

        summary_path = SUMMARIES_DIR / f"{date_text}.json"
        needs_work = True
        if summary_path.exists():
            try:
                payload = json.loads(summary_path.read_text(encoding="utf-8"))
                needs_work = not payload.get("complete") or payload.get(
                    "article_count", 0
                ) < article_line_count(date_text)
            except (json.JSONDecodeError, OSError):
                needs_work = True
        if needs_work:
            dates.append(date_text)
    return sorted(dates)


def step_fetch(skip: bool, dry_run: bool) -> None:
    if skip:
        log("跳过抓取（--skip-fetch）")
        return
    for source in SOURCES:
        if dry_run:
            log(f"[dry-run] 将抓取 {source}")
            continue
        log(f"抓取 {source} ...")
        result = run(
            [sys.executable, "-m", "secnews.update", source], check=False
        )
        if result.returncode != 0:
            log(f"  警告：{source} 抓取失败（已跳过，不影响其他源）")


def step_summarize(days: int, dry_run: bool) -> list[str]:
    dates = pending_summary_dates(days)
    if not dates:
        log("没有需要概括的日期")
        return []
    for date_text in dates:
        if dry_run:
            log(f"[dry-run] 将概括 {date_text}")
            continue
        log(f"概括 {date_text} ...")
        result = run(
            [sys.executable, "-m", "secnews.generate_daily_summary", "--date", date_text],
            check=False,
        )
        if result.returncode != 0:
            log(f"  警告：{date_text} 概括失败（脚本内置 3 次重试均已用尽）")
    return dates


def step_refresh_pages(dry_run: bool) -> None:
    if dry_run:
        log("[dry-run] 将刷新 index.html / secnews/index.html / top-conf/index.html")
        return
    log("刷新页面 ...")
    run([sys.executable, "generate_homepage.py"], check=False)


def step_git(dry_run: bool) -> None:
    if dry_run:
        log("[dry-run] 将执行 git add/commit/rebase/push")
        return

    status = run(["git", "status", "--porcelain", *GIT_PATHS], capture=True, check=True)
    if not status.stdout.strip():
        log("git：没有需要提交的变化")
        return

    run(["git", "add", *GIT_PATHS])
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    run(["git", "commit", "-m", f"daily update {stamp}"])
    log("git：已提交")

    rebase = run(["git", "pull", "--rebase", "origin", BRANCH], check=False)
    if rebase.returncode != 0:
        run(["git", "rebase", "--abort"], check=False)
        raise RuntimeError(
            "git pull --rebase 冲突（远端 CI 可能改写了同一数据文件），"
            "已放弃 rebase 且不推送，请人工对齐后重试"
        )

    run(["git", "push", "origin", BRANCH])
    log("git：已推送")


def main() -> int:
    if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="FastNews 每日更新流水线")
    parser.add_argument("--days", type=int, default=3, help="概括最近 N 天（默认 3）")
    parser.add_argument("--no-git", action="store_true", help="不执行 git 提交推送")
    parser.add_argument("--skip-fetch", action="store_true", help="跳过抓取")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划，不执行")
    args = parser.parse_args()

    if args.days < 1:
        parser.error("--days 至少为 1")

    os.chdir(ROOT)  # 数据路径均为项目根相对路径，不依赖调用方的工作目录
    log(f"开始每日更新（root={ROOT}）")

    exit_code = 0
    step_fetch(args.skip_fetch, args.dry_run)
    summarized = step_summarize(args.days, args.dry_run)
    if summarized:
        log(f"本轮概括了 {len(summarized)} 天：{', '.join(summarized)}")
    step_refresh_pages(args.dry_run)

    try:
        step_git(args.dry_run)
    except RuntimeError as error:
        log(f"git 步骤失败：{error}")
        exit_code = 1

    log(f"每日更新结束（exit={exit_code}）")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
