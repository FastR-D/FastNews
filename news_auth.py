"""Independent FastNews accounts and optional FastCAS adapter."""

from __future__ import annotations

import hashlib
import hmac
import html
import json
import os
import secrets
import sqlite3
import sys
import time
import urllib.parse
from http import cookies
from pathlib import Path

COOKIE = "fastnews_session"
BINDING = "fastnews_fastcas_binding"
ROOT = Path(__file__).resolve().parent
_MEMORY_TRANSACTIONS = {}


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc, tb):
        result = super().__exit__(exc_type, exc, tb)
        self.close()
        return result


def database_path():
    return Path(os.environ.get("FASTNEWS_ACCOUNT_DB") or ROOT / "data" / "accounts.sqlite")


def connect(create=False):
    file = database_path()
    if not create and not file.is_file():
        return None
    if create:
        file.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(file, timeout=10, factory=ClosingConnection)
    db.row_factory = sqlite3.Row
    if create:
        db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL, password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '{}');
            CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL,
                source TEXT NOT NULL, subject TEXT, sid TEXT, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS links(id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
                subject TEXT UNIQUE NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS identity_status(subject TEXT PRIMARY KEY, status TEXT NOT NULL,
                version INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS transactions(state TEXT PRIMARY KEY, payload TEXT NOT NULL,
                expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS pending(state TEXT PRIMARY KEY, account_id TEXT,
                session_hash TEXT, purpose TEXT NOT NULL, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS replay(id TEXT PRIMARY KEY, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS imports(account_id TEXT PRIMARY KEY, source_key_id TEXT NOT NULL,
                counts TEXT NOT NULL, content_hash TEXT NOT NULL, imported_at REAL NOT NULL);
        """)
    return db


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(value):
    salt = secrets.token_bytes(16)
    return salt.hex() + "$" + hashlib.scrypt(value.encode(), salt=salt, n=16384, r=8, p=1).hex()


def password_matches(value, encoded):
    try:
        salt, expected = encoded.split("$", 1)
        actual = hashlib.scrypt(value.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1)
        return hmac.compare_digest(actual, bytes.fromhex(expected))
    except (ValueError, TypeError):
        return False


def read_cookie(handler, name):
    jar = cookies.SimpleCookie()
    try:
        jar.load(handler.headers.get("Cookie", ""))
    except cookies.CookieError:
        return ""
    item = jar.get(name)
    return item.value if item else ""


def cookie(name, value, age=28800):
    return f"{name}={urllib.parse.quote(value, safe='')}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}"


def current(handler):
    token = read_cookie(handler, COOKIE)
    if not token:
        return None
    db = connect()
    if not db:
        return None
    try:
        row = db.execute("""SELECT a.*, s.source, s.subject, s.sid, s.token_hash FROM sessions s
            JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires>?""",
            (digest(token), time.time())).fetchone()
        if not row:
            return None
        if row["source"] == "fastcas":
            link = db.execute("SELECT 1 FROM links WHERE account_id=? AND subject=? AND state='active'",
                              (row["id"], row["subject"])).fetchone()
            status = db.execute("SELECT status FROM identity_status WHERE subject=?", (row["subject"],)).fetchone()
            if not link or (status and status["status"] == "disabled"):
                return None
        return dict(row)
    finally:
        db.close()


def issue(db, account_id, source="local", subject="", sid=""):
    token = secrets.token_urlsafe(32)
    db.execute("INSERT INTO sessions VALUES(?,?,?,?,?,?)",
               (digest(token), account_id, source, subject, sid, time.time() + 28800))
    db.commit()
    return token


def same_origin(handler):
    origin = handler.headers.get("Origin", "")
    if not origin:
        return False
    parsed = urllib.parse.urlparse(origin)
    return parsed.scheme in ("http", "https") and parsed.netloc == handler.headers.get("Host", "")


def body(handler):
    length = int(handler.headers.get("Content-Length") or 0)
    if length < 0 or length > 1024 * 1024:
        raise ValueError("Request too large")
    raw = handler.rfile.read(length)
    if handler.headers.get("Content-Type", "").startswith("application/json"):
        value = json.loads(raw or b"{}")
    else:
        value = {key: values[0] for key, values in urllib.parse.parse_qs(raw.decode()).items()}
    if not isinstance(value, dict):
        raise ValueError("Invalid request")
    return value


def respond(handler, status, payload=None, *, location=None, set_cookie=None, html_page=False):
    if location is not None:
        data = b""
    elif html_page:
        data = payload.encode("utf-8")
    else:
        data = json.dumps(payload or {}, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    if location is not None:
        handler.send_header("Location", location)
    if set_cookie:
        handler.send_header("Set-Cookie", set_cookie)
    if location is None:
        handler.send_header("Content-Type", "text/html; charset=utf-8" if html_page else "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    if handler.command != "HEAD" and data:
        handler.wfile.write(data)


def auth_page(mode, message=""):
    title = {"login": "登录 FastNews", "register": "注册 FastNews", "recover": "恢复 FastNews 账号"}[mode]
    fields = {
        "login": '<label>用户名<input name="username" autocomplete="username" required></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label>',
        "register": '<label>邀请码<input name="invite" required></label><label>用户名<input name="username" autocomplete="username" required></label><label>显示名称<input name="display_name" required></label><label>密码<input name="password" type="password" autocomplete="new-password" required minlength="10"></label>',
        "recover": '<label>用户名<input name="username" required></label><label>恢复码<input name="recovery" required></label><label>新密码<input name="password" type="password" required minlength="10"></label>',
    }[mode]
    cas = '<a href="/auth/fastcas/login">使用 FastCAS 登录</a>' if cas_configured() and mode == "login" else ""
    return f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title>
<style>body{{font:16px system-ui;background:#f5f7f6;color:#17252b;max-width:360px;margin:12vh auto;padding:20px}}form{{display:grid;gap:16px}}label{{display:grid;gap:5px}}input{{padding:10px;border:1px solid #a9b7ba;border-radius:4px}}button{{padding:11px;background:#176e58;color:white;border:0;border-radius:4px}}nav{{display:flex;gap:18px;margin-top:20px}}p{{color:#a43d2b}}</style>
<h1>{title}</h1><p>{html.escape(message)}</p><form method="post" action="/auth/{mode}">{fields}<button>{title}</button></form>
<nav><a href="/auth/login">登录</a><a href="/auth/register">注册</a><a href="/auth/recover">恢复账号</a>{cas}</nav></html>'''


def cas_configured():
    return all(os.environ.get("FASTNEWS_FASTCAS_" + key) for key in ("ISSUER", "CLIENT_ID", "CLIENT_SECRET", "REDIRECT_URI"))


def local_auth_enabled():
    return bool(os.environ.get("FASTNEWS_INVITE_CODE")) or database_path().is_file()


class Transactions:
    def put(self, transaction):
        with connect(True) as db:
            db.execute("DELETE FROM transactions WHERE expires<?", (time.time(),))
            db.execute("INSERT INTO transactions VALUES(?,?,?)", (transaction["state"], json.dumps(transaction), transaction["expires_at"]))

    def take(self, state):
        with connect(True) as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT payload FROM transactions WHERE state=?", (state,)).fetchone()
            db.execute("DELETE FROM transactions WHERE state=?", (state,))
            return json.loads(row["payload"]) if row else None


class MemoryTransactions:
    def put(self, transaction):
        _MEMORY_TRANSACTIONS[transaction["state"]] = transaction

    def take(self, state):
        return _MEMORY_TRANSACTIONS.pop(state, None)


def cas_client(transaction_store=None):
    if not cas_configured():
        return None
    sdk = os.environ.get("FASTNEWS_FASTCAS_SDK_PATH") or str(ROOT.parent / "FastCAS" / "sdk" / "python" / "src")
    if sdk not in sys.path:
        sys.path.insert(0, sdk)
    from fastcas import Configuration, FastCAS
    return FastCAS(Configuration(
        issuer=os.environ["FASTNEWS_FASTCAS_ISSUER"], client_id=os.environ["FASTNEWS_FASTCAS_CLIENT_ID"],
        client_secret=os.environ["FASTNEWS_FASTCAS_CLIENT_SECRET"], redirect_uri=os.environ["FASTNEWS_FASTCAS_REDIRECT_URI"],
        allow_loopback_http=os.environ.get("FASTNEWS_FASTCAS_ALLOW_LOOPBACK_HTTP") == "true"), transaction_store or Transactions())


def local_content(row):
    return json.loads(row["content"] or "{}")


def save_content(db, account_id, content):
    db.execute("UPDATE accounts SET content=? WHERE id=?", (json.dumps(content, ensure_ascii=False), account_id))


def handle(handler, parsed, research_request=None):
    path = parsed.path
    if not (path.startswith("/auth/") or path.startswith("/api/me/") or path in
            {"/api/content/me", "/api/content/authors", "/api/content/impression", "/api/content/inbox"}):
        return False
    if handler.command == "OPTIONS":
        respond(handler, 204)
        return True
    if path.startswith("/auth/fastcas/"):
        return handle_cas(handler, parsed)
    if path.startswith("/auth/"):
        handle_auth(handler, path)
        return True
    row = current(handler)
    if not row:
        if path.startswith("/api/me/"):
            respond(handler, 401, {"error": "Login required"})
            return True
        return False
    if path == "/api/me/research/import":
        if handler.command != "POST" or not same_origin(handler):
            respond(handler, 403, {"error": "Same-origin request required"})
            return True
        try:
            token = str(body(handler).get("session") or "")
            if not token or not research_request:
                raise ValueError("Research session required")
            me, _ = research_request("GET", "me", token)
            authors, _ = research_request("GET", "authors", token)
            impression, _ = research_request("GET", "impression", token)
            inbox, _ = research_request("GET", "inbox", token)
            if not me.get("keyId"):
                raise ValueError("Research account proof failed")
            snapshot = {"authors": authors.get("authors", []), "customTags": authors.get("customTags", []),
                        "impression": impression.get("impression", {}), "inbox": inbox.get("items", [])}
            counts = {key: len(value) for key, value in snapshot.items() if isinstance(value, list)}
            content_hash = digest(json.dumps(snapshot, ensure_ascii=False, sort_keys=True))
            with connect(True) as db:
                if db.execute("SELECT 1 FROM imports WHERE account_id=?", (row["id"],)).fetchone():
                    respond(handler, 409, {"error": "Research content already imported"})
                    return True
                save_content(db, row["id"], snapshot)
                db.execute("INSERT INTO imports VALUES(?,?,?,?,?)", (row["id"], me["keyId"], json.dumps(counts), content_hash, time.time()))
            respond(handler, 200, {"counts": counts, "hash": content_hash})
        except Exception:
            respond(handler, 400, {"error": "Research import failed"})
        return True
    if path == "/api/me/research" and handler.command == "GET":
        with connect() as db:
            item = db.execute("SELECT source_key_id,counts,content_hash,imported_at FROM imports WHERE account_id=?", (row["id"],)).fetchone()
        respond(handler, 200, {"import": dict(item) if item else None})
        return True
    if path == "/api/me/account" and handler.command == "GET":
        respond(handler, 200, {"accountId": row["id"], "username": row["username"], "person": row["display_name"], "source": row["source"]})
        return True
    if path == "/api/content/me" and handler.command in ("GET", "HEAD"):
        respond(handler, 200, {"keyId": row["id"], "accountId": row["id"], "person": row["display_name"], "source": row["source"], "expiresAt": int((time.time()+28800)*1000)})
        return True
    if path in {"/api/content/authors", "/api/content/impression", "/api/content/inbox"}:
        if handler.command not in ("GET", "PUT", "HEAD"):
            respond(handler, 405, {"error": "Method not allowed"})
            return True
        content = local_content(row)
        if handler.command == "PUT":
            if not same_origin(handler):
                respond(handler, 403, {"error": "Same-origin request required"})
                return True
            try:
                incoming = body(handler)
            except (ValueError, json.JSONDecodeError):
                respond(handler, 400, {"error": "Invalid request"})
                return True
            if path.endswith("authors"):
                content["authors"] = incoming.get("authors", [])[:200] if isinstance(incoming.get("authors"), list) else []
                content["customTags"] = incoming.get("customTags", [])[:40] if isinstance(incoming.get("customTags"), list) else []
            elif path.endswith("impression"):
                content["impression"] = {"text": str(incoming.get("text", ""))[:4000], "updatedAt": str(time.time())}
            else:
                items = incoming.get("items", content.get("inbox", []))
                if not isinstance(items, list):
                    items = []
                read_ids = {str(item) for item in incoming.get("readIds", []) if isinstance(item, (str, int))}
                content["inbox"] = [{**item, "read": True} if isinstance(item, dict) and str(item.get("id")) in read_ids else item for item in items[:180]]
            with connect() as db:
                save_content(db, row["id"], content)
        if path.endswith("authors"):
            payload = {"authors": content.get("authors", []), "customTags": content.get("customTags", [])}
        elif path.endswith("impression"):
            payload = {"impression": content.get("impression", {"text": "", "updatedAt": ""})}
        else:
            items = content.get("inbox", [])
            payload = {"items": items, "unread": sum(not item.get("read", False) for item in items if isinstance(item, dict))}
        respond(handler, 200, payload)
        return True
    respond(handler, 404, {"error": "Not found"})
    return True


def handle_auth(handler, path):
    mode = path.removeprefix("/auth/")
    if mode == "account" and handler.command in ("GET", "HEAD"):
        row = current(handler)
        if not row:
            return respond(handler, 302, location="/auth/login")
        with connect() as db:
            link = db.execute("SELECT 1 FROM links WHERE account_id=? AND state='active'", (row["id"],)).fetchone()
        form = ""
        if cas_configured() and row["source"] == "local":
            action = "unlink" if link else "link"
            form = f'<form method="post" action="/auth/fastcas/{action}"><label>本地密码<input type="password" name="password" required></label><button>{"解绑" if link else "绑定"} FastCAS</button></form>'
        page = f'<html lang="zh-CN"><meta charset="utf-8"><title>FastNews 账号</title><h1>{html.escape(row["display_name"])}</h1><p>{html.escape(row["username"])}</p>{form}<form method="post" action="/auth/logout"><button>退出登录</button></form><a href="/">返回报告</a></html>'
        return respond(handler, 200, page, html_page=True)
    if mode == "logout" and handler.command == "POST":
        if not same_origin(handler):
            return respond(handler, 403, {"error": "Same-origin request required"})
        token = read_cookie(handler, COOKIE)
        db = connect()
        if db:
            with db:
                db.execute("DELETE FROM sessions WHERE token_hash=?", (digest(token),))
            db.close()
        return respond(handler, 303, location="/auth/login", set_cookie=cookie(COOKIE, "", 0))
    if mode not in ("login", "register", "recover"):
        return respond(handler, 404, {"error": "Not found"})
    if handler.command in ("GET", "HEAD"):
        reason = urllib.parse.parse_qs(urllib.parse.urlparse(handler.path).query).get("fastcas", [""])[0]
        message = {"needs_link": "此 FastCAS 身份尚未绑定本地账号", "disabled": "FastCAS 身份已停用"}.get(reason, "")
        return respond(handler, 200, auth_page(mode, message), html_page=True)
    if handler.command != "POST" or not same_origin(handler):
        return respond(handler, 403, {"error": "Same-origin request required"})
    try:
        value = body(handler)
        username = str(value.get("username", "")).strip().lower()
        password = str(value.get("password", ""))
        if not username or len(username) > 80 or len(password) < 10:
            raise ValueError("Invalid credentials")
        if mode == "register":
            invite = os.environ.get("FASTNEWS_INVITE_CODE", "")
            if not invite or not hmac.compare_digest(invite, str(value.get("invite", ""))):
                raise ValueError("Invalid invitation")
            recovery = secrets.token_urlsafe(24)
            with connect(True) as db:
                account_id = secrets.token_hex(16)
                db.execute("INSERT INTO accounts(id,username,display_name,password_hash,recovery_hash) VALUES(?,?,?,?,?)",
                           (account_id, username, str(value.get("display_name", "")).strip()[:80] or username,
                            password_hash(password), password_hash(recovery)))
                token = issue(db, account_id)
            if not handler.headers.get("Content-Type", "").startswith("application/json"):
                page = f'<html lang="zh-CN"><meta charset="utf-8"><h1>账号已创建</h1><p>请保管恢复码，之后不会再次显示。</p><code>{html.escape(recovery)}</code><p><a href="/">进入报告</a></p></html>'
                return respond(handler, 201, page, html_page=True, set_cookie=cookie(COOKIE, token))
            return respond(handler, 201, {"accountId": account_id, "recoveryCode": recovery}, set_cookie=cookie(COOKIE, token))
        db = connect()
        if not db:
            raise ValueError("Invalid credentials")
        with db:
            row = db.execute("SELECT * FROM accounts WHERE username=?", (username,)).fetchone()
            if not row:
                raise ValueError("Invalid credentials")
            if mode == "login":
                if not password_matches(password, row["password_hash"]):
                    raise ValueError("Invalid credentials")
            else:
                if not password_matches(str(value.get("recovery", "")), row["recovery_hash"]):
                    raise ValueError("Invalid recovery code")
                recovery = secrets.token_urlsafe(24)
                db.execute("UPDATE accounts SET password_hash=?, recovery_hash=? WHERE id=?",
                           (password_hash(password), password_hash(recovery), row["id"]))
                db.execute("DELETE FROM sessions WHERE account_id=?", (row["id"],))
            token = issue(db, row["id"])
        db.close()
        if mode == "recover":
            if handler.headers.get("Content-Type", "").startswith("application/json"):
                return respond(handler, 200, {"ok": True, "recoveryCode": recovery}, set_cookie=cookie(COOKIE, token))
            page = f'<html lang="zh-CN"><meta charset="utf-8"><h1>账号已恢复</h1><p>请保管新的恢复码。</p><code>{html.escape(recovery)}</code><p><a href="/">进入报告</a></p></html>'
            return respond(handler, 200, page, html_page=True, set_cookie=cookie(COOKIE, token))
        if handler.headers.get("Content-Type", "").startswith("application/json"):
            return respond(handler, 200, {"ok": True}, set_cookie=cookie(COOKIE, token))
        return respond(handler, 303, location="/", set_cookie=cookie(COOKIE, token))
    except (ValueError, sqlite3.IntegrityError, json.JSONDecodeError):
        return respond(handler, 400, {"error": "Authentication failed"})


def handle_cas(handler, parsed):
    path = parsed.path.removeprefix("/auth/fastcas/")
    if path == "available" and handler.command == "GET":
        respond(handler, 200, {"available": cas_configured()})
        return True
    local = current(handler)
    store = Transactions() if local else MemoryTransactions()
    cas = cas_client(store)
    if not cas:
        respond(handler, 404, {"error": "FastCAS unavailable"})
        return True
    try:
        if path == "login" and handler.command == "GET":
            binding = secrets.token_urlsafe(32)
            url = cas.begin_login(binding)
            respond(handler, 302, location=url, set_cookie=cookie(BINDING, binding, 600))
        elif path == "link" and handler.command == "POST":
            row = local or current(handler)
            if not row or row["source"] != "local" or not same_origin(handler):
                return respond(handler, 403, {"error": "Local account proof required"}) or True
            value = body(handler)
            if not password_matches(str(value.get("password", "")), row["password_hash"]):
                return respond(handler, 401, {"error": "Local account proof required"}) or True
            binding = secrets.token_urlsafe(32)
            url = cas.begin_link(binding, local_account_ref=row["id"], local_session_id=row["token_hash"])
            state = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["state"][0]
            with connect(True) as db:
                db.execute("INSERT INTO pending VALUES(?,?,?,?,?)", (state, row["id"], row["token_hash"], "link", time.time()+300))
            if handler.headers.get("Content-Type", "").startswith("application/json"):
                respond(handler, 200, {"url": url}, set_cookie=cookie(BINDING, binding, 600))
            else:
                respond(handler, 303, location=url, set_cookie=cookie(BINDING, binding, 600))
        elif path == "callback" and handler.command == "GET":
            binding = read_cookie(handler, BINDING)
            if not binding:
                raise ValueError("Browser binding expired")
            query = urllib.parse.parse_qs(parsed.query)
            state = query.get("state", [""])[0]
            pending = None
            if database_path().is_file():
                with connect() as db:
                    pending = db.execute("SELECT * FROM pending WHERE state=? AND expires>?", (state, time.time())).fetchone()
                    db.execute("DELETE FROM pending WHERE state=?", (state,))
            options = {}
            if pending and pending["purpose"] == "link":
                options = {"local_account_ref": pending["account_id"], "local_session_id": pending["session_hash"]}
            callback = os.environ["FASTNEWS_FASTCAS_REDIRECT_URI"].split("?", 1)[0] + "?" + parsed.query
            result = cas.finish_login(callback, binding, **options)
            identity = result["identity"]
            subject = identity["subject"]
            if not database_path().is_file() and result["transaction"]["purpose"] == "login":
                return respond(handler, 302, location="/auth/login?fastcas=needs_link") or True
            with connect(True) as db:
                disabled = db.execute("SELECT status FROM identity_status WHERE subject=?", (subject,)).fetchone()
                if disabled and disabled["status"] == "disabled":
                    return respond(handler, 302, location="/auth/login?fastcas=disabled") or True
                if result["transaction"]["purpose"] == "link":
                    if not pending:
                        raise ValueError("Link transaction missing")
                    prepared = cas.prepare_link(result)
                    db.execute("INSERT OR REPLACE INTO links VALUES(?,?,?,?,?)", (prepared["id"], pending["account_id"], subject, prepared["state"], prepared["version"]))
                    db.commit()
                    active = cas.activate_link(prepared["id"])
                    db.execute("INSERT OR REPLACE INTO links VALUES(?,?,?,?,?)", (active["id"], pending["account_id"], subject, active["state"], active["version"]))
                    return respond(handler, 302, location="/auth/account") or True
                if result["transaction"]["purpose"] != "login":
                    return respond(handler, 302, location="/auth/login?fastcas=needs_link") or True
                remote = cas.resolve_link(subject)
                local = db.execute("SELECT * FROM links WHERE subject=? AND state='active'", (subject,)).fetchone()
                if not local or remote.get("state") != "active" or remote.get("local_account_ref") != local["account_id"]:
                    return respond(handler, 302, location="/auth/login?fastcas=needs_link") or True
                token = issue(db, local["account_id"], "fastcas", subject, identity.get("sid") or "")
            respond(handler, 302, location="/", set_cookie=cookie(COOKIE, token))
        elif path == "status" and handler.command == "GET":
            row = current(handler)
            if not row:
                respond(handler, 401, {"error": "Login required"})
            else:
                with connect() as db:
                    link = db.execute("SELECT subject FROM links WHERE account_id=? AND state='active'", (row["id"],)).fetchone()
                respond(handler, 200, {"linked": bool(link), "subject": link["subject"] if link else ""})
        elif path == "unlink" and handler.command == "POST":
            row = current(handler)
            if not row or row["source"] != "local" or not same_origin(handler) or not password_matches(str(body(handler).get("password", "")), row["password_hash"]):
                respond(handler, 403, {"error": "Local account proof required"})
            else:
                with connect(True) as db:
                    link = db.execute("SELECT * FROM links WHERE account_id=? AND state='active'", (row["id"],)).fetchone()
                    if link:
                        cas.revoke_link(dict(link))
                        db.execute("UPDATE links SET state='revoked',version=? WHERE id=?", (link["version"]+1, link["id"]))
                        db.execute("DELETE FROM sessions WHERE subject=? AND source='fastcas'", (link["subject"],))
                if handler.headers.get("Content-Type", "").startswith("application/json"):
                    respond(handler, 200, {"linked": False})
                else:
                    respond(handler, 303, location="/auth/account")
        elif path == "events" and handler.command == "POST":
            raw = handler.rfile.read(min(int(handler.headers.get("Content-Length") or 0), 65536)).decode()
            def apply(event):
                with connect(True) as db:
                    if db.execute("SELECT 1 FROM replay WHERE id=?", (event["id"],)).fetchone():
                        return
                    db.execute("INSERT INTO replay VALUES(?,?)", (event["id"], time.time()+86400))
                    if event["type"] == "identity.status_changed":
                        old = db.execute("SELECT version FROM identity_status WHERE subject=?", (event["subject"],)).fetchone()
                        if not old or event["version"] > old["version"]:
                            db.execute("INSERT OR REPLACE INTO identity_status VALUES(?,?,?)", (event["subject"], event["status"], event["version"]))
                            if event["status"] == "disabled":
                                db.execute("DELETE FROM sessions WHERE source='fastcas' AND subject=?", (event["subject"],))
                    else:
                        link = event["link"]
                        old = db.execute("SELECT * FROM links WHERE id=?", (link["id"],)).fetchone()
                        if old and link["version"] >= old["version"] and old["subject"] == link["subject"]:
                            db.execute("UPDATE links SET state='revoked',version=? WHERE id=?", (link["version"], link["id"]))
                            db.execute("DELETE FROM sessions WHERE source='fastcas' AND subject=?", (link["subject"],))
            cas.handle_notification(raw, apply)
            respond(handler, 204)
        elif path == "backchannel-logout" and handler.command == "POST":
            raw = handler.rfile.read(min(int(handler.headers.get("Content-Length") or 0), 65536)).decode()
            token = urllib.parse.parse_qs(raw).get("logout_token", [""])[0]
            def replay(event_id, expires):
                with connect(True) as db:
                    if db.execute("SELECT 1 FROM replay WHERE id=?", (event_id,)).fetchone():
                        return False
                    db.execute("INSERT INTO replay VALUES(?,?)", (event_id, expires))
                return True
            event = cas.handle_logout(token, replay)
            with connect(True) as db:
                if event["sid"]:
                    db.execute("DELETE FROM sessions WHERE source='fastcas' AND subject=? AND sid=?", (event["subject"], event["sid"]))
                else:
                    db.execute("DELETE FROM sessions WHERE source='fastcas' AND subject=?", (event["subject"],))
            respond(handler, 204)
        else:
            respond(handler, 404, {"error": "Not found"})
    except Exception:
        respond(handler, 400, {"error": "FastCAS request failed"})
    finally:
        cas.close()
    return True
