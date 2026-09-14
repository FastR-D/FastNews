#!/usr/bin/env python3
"""Serve FastNews on loopback and require a FastResearch SSO session."""

from __future__ import annotations

import json
import re
import mimetypes
import os
import sys
import posixpath
import time
import urllib.error
import urllib.parse
import urllib.request
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

AUDIENCE = "fast-news"
COOKIE_NAME = os.environ.get("FASTRESEARCH_COOKIE_NAME", "fr_session")
ALLOWED_SUFFIXES = {
    ".css",
    ".gif",
    ".htm",
    ".html",
    ".ico",
    ".jpeg",
    ".jpg",
    ".js",
    ".json",
    ".jsonl",
    ".map",
    ".pdf",
    ".png",
    ".svg",
    ".txt",
    ".webp",
    ".woff",
    ".woff2",
}
HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}
_VALID_CACHE: dict[str, float] = {}
_CACHE_TTL = 30.0



def redact_request_line(message: str) -> str:
    return re.sub(r'([?&]sso=)[^&\s"]+', r"\1redacted", message, flags=re.I)


class AuthError(Exception):
    def __init__(self, status: int, payload: dict | None = None):
        super().__init__(status)
        self.status = status
        self.payload = payload or {}


def public_root() -> Path:
    return Path(os.environ.get("FASTNEWS_ROOT", Path(__file__).resolve().parent)).resolve()


def research_api_url() -> str:
    return os.environ.get("FASTRESEARCH_API_URL", "http://127.0.0.1:8787").strip().rstrip("/")


def panel_url() -> str:
    return os.environ.get("FASTRESEARCH_PANEL_URL", "http://127.0.0.1:5173").strip().rstrip("/") or "http://127.0.0.1:5173"


def listen_host() -> str:
    return os.environ.get("FASTNEWS_HOST", "127.0.0.1").strip() or "127.0.0.1"


def listen_port() -> int:
    return int(os.environ.get("FASTNEWS_PORT", "4173"))


def json_request(method: str, url: str, payload: dict | None = None, token: str = "", timeout: float = 5):
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["Cookie"] = f"{COOKIE_NAME}={urllib.parse.quote(token, safe='')}"
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8") or "{}"
            return json.loads(raw), response.status
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace") or "{}"
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = {}
        raise AuthError(exc.code, body) from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise AuthError(503, {"error": "无法连接 FastResearch"}) from exc


def consume_ticket(ticket: str) -> dict:
    ticket = (ticket or "").strip()
    if not ticket or len(ticket) > 256:
        raise AuthError(401, {"error": "登录票据无效或已过期"})
    payload, _status = json_request(
        "POST",
        f"{research_api_url()}/api/sso/consume",
        {"ticket": ticket, "audience": AUDIENCE},
    )
    session = str(payload.get("session") or "").strip()
    key_id = str(payload.get("keyId") or "").strip()
    if not session or not key_id:
        raise AuthError(401, {"error": "登录票据无效或已过期"})
    return payload


def session_valid(token: str) -> bool:
    token = (token or "").strip()
    if not token:
        return False
    now = time.monotonic()
    cached = _VALID_CACHE.get(token)
    if cached and cached > now:
        return True
    try:
        payload, _status = json_request("GET", f"{research_api_url()}/api/content/me", token=token)
    except AuthError:
        _VALID_CACHE.pop(token, None)
        return False
    if not str(payload.get("keyId") or "").strip():
        _VALID_CACHE.pop(token, None)
        return False
    _VALID_CACHE[token] = now + _CACHE_TTL
    return True


def clear_session_cache(token: str = "") -> None:
    if token:
        _VALID_CACHE.pop(token, None)
    else:
        _VALID_CACHE.clear()


def cookie_token(header: str) -> str:
    jar = cookies.SimpleCookie()
    try:
        jar.load(header or "")
    except cookies.CookieError:
        return ""
    morsel = jar.get(COOKIE_NAME)
    return (morsel.value or "").strip() if morsel else ""


def session_cookie(token: str, expires_at=None) -> str:
    max_age = 8 * 3600
    if expires_at:
        try:
            max_age = max(0, int((float(expires_at) - time.time() * 1000) / 1000))
        except (TypeError, ValueError):
            max_age = 8 * 3600
    parts = [
        f"{COOKIE_NAME}={urllib.parse.quote(token, safe='')}",
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        f"Max-Age={max_age}",
    ]
    return "; ".join(parts)


def resolve_public_file(url_path: str) -> Path | None:
    rel = posixpath.normpath("/" + (url_path or "/")).lstrip("/")
    if rel in {"", "."}:
        rel = "index.html"
    if rel.startswith(".") or "/." in f"/{rel}":
        return None
    root = public_root()
    candidate = (root / rel).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    if candidate.is_dir():
        candidate = (candidate / "index.html").resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            return None
    if not candidate.is_file():
        return None
    if candidate.suffix.lower() not in ALLOWED_SUFFIXES:
        return None
    return candidate


class FastNewsHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), redact_request_line(format % args)))

    def do_GET(self):
        self._dispatch()

    def do_HEAD(self):
        self._dispatch()

    def do_POST(self):
        self._dispatch()

    def do_PUT(self):
        self._dispatch()

    def do_DELETE(self):
        self._dispatch()

    def do_OPTIONS(self):
        self._dispatch()

    def _dispatch(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._proxy(parsed)
            return
        if self.command not in {"GET", "HEAD"}:
            self.send_error(405, "Method Not Allowed")
            return
        ticket = urllib.parse.parse_qs(parsed.query).get("sso", [""])[0].strip()
        if ticket:
            self._consume(ticket, parsed.path or "/")
            return
        token = cookie_token(self.headers.get("Cookie", ""))
        if not token or not session_valid(token):
            self._bounce()
            return
        self._file(parsed.path or "/")

    def _bounce(self):
        self._redirect(panel_url())

    def _consume(self, ticket: str, path: str):
        try:
            payload = consume_ticket(ticket)
        except AuthError:
            self._bounce()
            return
        location = path or "/"
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Set-Cookie", session_cookie(str(payload["session"]), payload.get("expiresAt")))
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _redirect(self, location: str, status: int = 302):
        self.send_response(status)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _file(self, url_path: str):
        target = resolve_public_file(url_path)
        if target is None:
            self.send_error(404, "Not Found")
            return
        data = target.read_bytes()
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "same-origin")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _proxy(self, parsed):
        target = f"{research_api_url()}{parsed.path}"
        if parsed.query:
            target = f"{target}?{parsed.query}"
        headers = {}
        for key in ("Authorization", "Content-Type", "Accept", "Cookie"):
            value = self.headers.get(key)
            if value:
                headers[key] = value
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length > 0 else None
        request = urllib.request.Request(target, data=body, method=self.command, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                payload = response.read()
                self._write_upstream(response.status, response.headers, payload)
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            self._write_upstream(exc.code, exc.headers, payload)
        except (urllib.error.URLError, TimeoutError):
            data = json.dumps({"error": "无法连接 FastResearch"}).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)

    def _write_upstream(self, status, headers, payload: bytes):
        self.send_response(status)
        for key, value in headers.items():
            if key.lower() in HOP_BY_HOP or key.lower().startswith("access-control-"):
                continue
            if key.lower() in {"content-type", "cache-control", "set-cookie"}:
                self.send_header(key, value)
        if "cache-control" not in {key.lower() for key in headers.keys()}:
            self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload or b"")))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload or b"")


def main():
    server = ThreadingHTTPServer((listen_host(), listen_port()), FastNewsHandler)
    print(f"FastNews http://{listen_host()}:{listen_port()}  (enter via FastResearch {panel_url()})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
