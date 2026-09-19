#!/usr/bin/env python3
"""Fetch, summarize, and render Big 4 conference reports for a year range."""

from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFERENCES = ("usenix", "ieee-sp", "ndss", "ccs")


def run(args, check=True):
    print("+", " ".join(str(part) for part in args), flush=True)
    completed = subprocess.run([sys.executable, '-u', *args], cwd=ROOT)
    if check and completed.returncode != 0:
        raise RuntimeError(f"command failed ({completed.returncode}): {' '.join(str(part) for part in args)}")
    return completed.returncode == 0


def main():
    parser = argparse.ArgumentParser(description="Build FastNews top-conf corpus for a year range")
    parser.add_argument("--since", type=int, default=2023, help="First conference year (inclusive)")
    parser.add_argument("--until", type=int, default=datetime.now(UTC).year, help="Last conference year (inclusive)")
    parser.add_argument(
        "--conference",
        action="append",
        dest="conferences",
        choices=CONFERENCES,
        help="Limit to one or more conferences. Defaults to all Big 4.",
    )
    parser.add_argument("--skip-fetch", action="store_true")
    parser.add_argument("--skip-summary", action="store_true")
    parser.add_argument("--skip-report", action="store_true")
    parser.add_argument("--batch-size", type=int, default=12)
    args = parser.parse_args()

    if args.until < args.since:
        parser.error("--until must be >= --since")

    conferences = args.conferences or list(CONFERENCES)
    years = list(range(args.since, args.until + 1))
    failures = []

    for year in years:
        for conference in conferences:
            label = f"{conference} {year}"
            print(f"\n=== {label} ===", flush=True)
            try:
                if not args.skip_fetch:
                    ok = run(
                        ["top-conf/fetch_big4.py", conference, str(year)],
                        check=False,
                    )
                    if not ok:
                        failures.append(f"{label}: fetch")
                        continue
                if not args.skip_summary:
                    ok = run(
                        [
                            "top-conf/generate_conf_summary.py",
                            conference,
                            str(year),
                            "--batch-size",
                            str(args.batch_size),
                        ],
                        check=False,
                    )
                    if not ok:
                        failures.append(f"{label}: summary")
                        continue
                if not args.skip_report:
                    ok = run(
                        ["top-conf/generate_conf_report.py", conference, str(year)],
                        check=False,
                    )
                    if not ok:
                        failures.append(f"{label}: report")
            except Exception as exc:
                print(f"Error while processing {label}: {exc}", file=sys.stderr)
                failures.append(f"{label}: {exc}")

    if not args.skip_report:
        run(["generate_homepage.py"], check=False)

    if failures:
        print("\nCompleted with failures:")
        for item in failures:
            print(f"  - {item}")
        sys.exit(1)

    print("\nAll requested conference years completed.")


if __name__ == "__main__":
    main()
