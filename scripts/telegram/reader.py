#!/usr/bin/env python3
"""Optional personal read-only client. Never writes into the public news corpus."""

import argparse
import asyncio
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / ".fastnews-data" / "telegram"


def sources(path):
    rows = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        raise ValueError("sources must be a JSON array")
    result, seen = [], set()
    for row in rows:
        if not isinstance(row, dict) or set(row) - {"id", "peer", "enabled"}:
            raise ValueError("invalid source fields")
        key, peer = row.get("id"), row.get("peer")
        if not isinstance(key, str) or not re.fullmatch(r"[a-z][a-z0-9_-]*", key) or key in seen:
            raise ValueError("invalid or duplicate source id")
        if not isinstance(peer, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{3,31}", peer):
            raise ValueError("peer must be a public username, without @ or a URL")
        if type(row.get("enabled", False)) is not bool:
            raise ValueError("enabled must be boolean")
        seen.add(key)
        if row.get("enabled", False):
            result.append(row)
    return result


def message_row(source, message, public_channel):
    body = (message.raw_text or "").strip()
    if not body or not message.date:
        return None
    return {
        "id": f"{source['id']}:{message.id}",
        "source": source["id"],
        "peer": source["peer"],
        "message_id": message.id,
        "published": message.date.isoformat(),
        "edited": message.edit_date.isoformat() if message.edit_date else None,
        "link": f"https://t.me/{source['peer']}/{message.id}" if public_channel else None,
        "text": body,
        "outbound_links": sorted({entity.url for entity in (message.entities or []) if getattr(entity, "url", "").startswith(("https://", "http://"))}),
        "visibility": "local_private",
        "ai_processing": False,
    }


def save_snapshot(path, rows, truncated):
    # Restrictive mode before creation; atomic replacement preserves the last
    # successful snapshot if a fetch or write fails.
    payload = {"collected_at": datetime.now(timezone.utc).isoformat(), "truncated": truncated, "messages": rows}
    fd, temporary = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


async def run(args):
    selected = sources(args.sources)
    if not selected and not args.login:
        raise ValueError("no enabled sources; edit the local source configuration first")
    api_id, api_hash = os.environ.get("TELEGRAM_API_ID"), os.environ.get("TELEGRAM_API_HASH")
    if not api_id or not api_id.isdigit() or not api_hash:
        raise ValueError("set TELEGRAM_API_ID and TELEGRAM_API_HASH locally")
    from telethon import TelegramClient, types

    os.umask(0o077)
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    STATE.chmod(0o700)
    client = TelegramClient(str(STATE / "reader"), int(api_id), api_hash,
                            receive_updates=False, flood_sleep_threshold=0)
    # Usernames are resolved explicitly; do not cache unrelated user entities.
    client.session.save_entities = False
    try:
        await client.connect()
        if not await client.is_user_authorized():
            if not args.login or not sys.stdin.isatty():
                raise ValueError("not signed in; run --login in your own terminal")
            await client.start()
        if args.login:
            print("Session ready. Run without --login to read configured sources.")
            return 0
        cutoff = datetime.now(timezone.utc) - timedelta(days=args.days)
        failures = 0
        for source in selected:
            try:
                entity = await client.get_entity(source["peer"])
                if not isinstance(entity, types.Channel) and not (isinstance(entity, types.User) and entity.bot):
                    raise ValueError("only public channels/groups and existing bot conversations are supported")
                rows, scanned, exhausted = [], 0, True
                async for message in client.iter_messages(entity, limit=args.limit + 1, wait_time=1):
                    if message.date and message.date < cutoff:
                        break
                    scanned += 1
                    if scanned > args.limit:
                        exhausted = False
                        break
                    row = message_row(source, message, isinstance(entity, types.Channel))
                    if row:
                        rows.append(row)
                save_snapshot(STATE / (source["id"] + ".json"), rows, not exhausted)
                print(f"{source['id']}: saved={len(rows)} truncated={not exhausted}")
            except Exception as error:
                failures += 1
                # RPC error strings can contain account information. Log only type.
                print(f"{source['id']}: {type(error).__name__}; previous snapshot retained", file=sys.stderr)
        return 1 if failures else 0
    finally:
        await client.disconnect()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", default=str(STATE / "sources.json"))
    parser.add_argument("--login", action="store_true")
    parser.add_argument("--days", type=int, default=2)
    parser.add_argument("--limit", type=int, default=200)
    args = parser.parse_args()
    if not 1 <= args.days <= 30 or not 1 <= args.limit <= 1000:
        parser.error("days must be 1..30 and limit must be 1..1000")
    try:
        return asyncio.run(run(args))
    except (ValueError, FileNotFoundError) as error:
        print(str(error), file=sys.stderr)
        return 2
    except Exception as error:
        print(f"Reader failed: {type(error).__name__}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
