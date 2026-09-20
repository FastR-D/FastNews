#!/usr/bin/env python3
"""Serve FastNews on loopback and require a FastResearch SSO session."""

from __future__ import annotations

import json
import re
import mimetypes
import os
import sys
import posixpath
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(dotenv_path=None, *_args, **_kwargs):
        path = Path(dotenv_path) if dotenv_path else Path(".env")
        try:
            raw_text = Path(path).read_text(encoding="utf-8")
        except OSError:
            return False
        for raw in raw_text.splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("'").strip('"')
            if key and key not in os.environ:
                os.environ[key] = value
        return True


import field_briefing
import inbox_push
import summary_brief

load_dotenv(Path(__file__).resolve().parent / ".env")

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
_INBOX_LOCKS: dict[str, threading.Lock] = {}
_INBOX_LOCKS_GUARD = threading.Lock()
RELATED_WORK_PATH = "/api/related-work"
FIELD_BRIEFING_PATH = "/api/field-briefing"
SUMMARY_BRIEF_PATH = "/api/summary-brief"
INBOX_PATH = "/api/content/inbox"
FASTREAD_PATH = "/api/fastread"
FASTREAD_REDIRECT_MAX = 7000
DEFAULT_FASTREAD_URL = "http://127.0.0.1:3015"
LLM_TIMEOUT = 60
FIELD_BRIEFING_TIMEOUT = 90
FIELD_BRIEFING_MAX_TOKENS = 10000
DEFAULT_RELATED_REASON = "与当前研究方向重叠，适合作为 related work。"


def redact_request_line(message: str) -> str:
    return re.sub(r'([?&]sso=)[^&\s"]+', r"\1redacted", message, flags=re.I)


class AuthError(Exception):
    def __init__(self, status: int, payload: dict | None = None):
        super().__init__(status)
        self.status = status
        self.payload = payload or {}


class RelatedWorkError(Exception):
    def __init__(self, status: int, payload: dict | None = None):
        super().__init__(status)
        self.status = status
        self.payload = payload or {}


def clip(value, max_len: int) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()[:max_len]


def public_http_url(value, max_len: int = 2048) -> str:
    raw = clip(value, max_len)
    if not raw:
        return ""
    try:
        parsed = urllib.parse.urlparse(raw)
    except ValueError:
        return ""
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        return ""
    return raw


def fastread_url() -> str:
    raw = (os.environ.get("FASTREAD_URL") or DEFAULT_FASTREAD_URL).strip().rstrip("/")
    try:
        parsed = urllib.parse.urlparse(raw)
    except ValueError:
        return DEFAULT_FASTREAD_URL
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or parsed.username
        or parsed.password
    ):
        return DEFAULT_FASTREAD_URL
    return f"{parsed.scheme}://{parsed.netloc}"


def build_fastread_handoff(body: dict) -> tuple[int, dict]:
    if not isinstance(body, dict):
        body = {}
    title = clip(body.get("title"), 300)
    if not title:
        return 400, {"error": "title required"}
    authors = clip(body.get("authors") or body.get("author"), 400)
    abstract = clip(body.get("abstract") or body.get("summary"), 800)
    url = public_http_url(body.get("url") or body.get("link") or "")
    venue = clip(
        body.get("venue") or body.get("conference_label") or body.get("conference"),
        80,
    )
    year = clip(body.get("year"), 8)
    paper_id = clip(body.get("id") or body.get("paperId"), 180)
    paper = {"title": title, "source": "fastnews"}
    if authors:
        paper["authors"] = authors
    if abstract:
        paper["abstract"] = abstract
    if url:
        paper["url"] = url
    if venue:
        paper["venue"] = venue
    if year:
        paper["year"] = year
    if paper_id:
        paper["id"] = paper_id

    def redirect_for(payload: dict) -> str:
        encoded = urllib.parse.quote(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            safe="",
        )
        return f"{fastread_url()}/#fastnews={encoded}"

    redirect = redirect_for(paper)
    if len(redirect) > FASTREAD_REDIRECT_MAX and paper.get("abstract"):
        paper["abstract"] = clip(paper["abstract"], 240)
        redirect = redirect_for(paper)
    if len(redirect) > FASTREAD_REDIRECT_MAX:
        paper.pop("abstract", None)
        redirect = redirect_for(paper)
    return 200, {"ok": True, "redirect": redirect, "paper": paper}


def openai_api_key() -> str:
    return os.environ.get("OPENAI_API_KEY", "").strip()


def openai_base_url() -> str:
    base = (os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1").strip().rstrip("/")
    return base or "https://api.openai.com/v1"


def llm_model() -> str:
    return (os.environ.get("LLM_MODEL") or "gemini-3-flash-preview").strip() or "gemini-3-flash-preview"


def parse_model_json(text: str):
    raw = str(text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I)
        raw = re.sub(r"\s*```$", "", raw)
    start = raw.find("[")
    end = raw.rfind("]")
    if start >= 0 and end > start:
        raw = raw[start:end + 1]
    data = json.loads(raw)
    if not isinstance(data, list):
        raise ValueError("model output is not an array")
    return data


def normalize_items(items, allowed_ids: set[str]) -> list[dict]:
    out: list[dict] = []
    used: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id") or "")
        if not item_id or item_id not in allowed_ids or item_id in used:
            continue
        used.add(item_id)
        try:
            score = float(item.get("score"))
        except (TypeError, ValueError):
            score = 0.5
        if score != score or score in (float("inf"), float("-inf")):
            score = 0.5
        score = max(0.0, min(1.0, score))
        reason = clip(item.get("reason"), 180) or DEFAULT_RELATED_REASON
        out.append({"id": item_id, "score": score, "reason": reason})
        if len(out) >= 12:
            break
    return out


def complete_related_work(system_prompt: str, user_prompt: str) -> str:
    api_key = openai_api_key()
    if not api_key:
        raise RelatedWorkError(503, {"error": "OPENAI_API_KEY is not configured"})
    payload = {
        "model": llm_model(),
        "temperature": 0.2,
        "max_tokens": 2500,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    request = urllib.request.Request(
        f"{openai_base_url()}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=LLM_TIMEOUT) as response:
            raw = response.read().decode("utf-8") or "{}"
            data = json.loads(raw)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        sys.stderr.write("related-work upstream %s %s\n" % (exc.code, detail.replace("\n", " ")))
        raise RelatedWorkError(502, {"error": "upstream llm error"}) from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        sys.stderr.write("related-work llm error: %s: %s\n" % (type(exc).__name__, exc))
        raise RelatedWorkError(502, {"error": "related-work failed"}) from exc
    try:
        message = ((data.get("choices") or [{}])[0].get("message") or {})
        content = str(message.get("content") or "").strip()
        if not content:
            content = str(message.get("reasoning_content") or "").strip()
        return content
    except (AttributeError, IndexError, TypeError):
        return ""


def is_deepseek_endpoint() -> bool:
    return "deepseek" in f"{openai_base_url()} {llm_model()}".lower()


def field_briefing_request_payload(system_prompt: str, user_prompt: str) -> dict:
    payload = {
        "model": llm_model(),
        "temperature": 0.3,
        "max_tokens": FIELD_BRIEFING_MAX_TOKENS,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    if is_deepseek_endpoint():
        payload["thinking"] = {"type": "disabled"}
        payload["reasoning_effort"] = "none"
        payload["response_format"] = {"type": "json_object"}
    return payload


def _message_text(message) -> str:
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or ""))
        content = "".join(parts)
    text = str(content or "").strip()
    if not text:
        text = str(message.get("reasoning_content") or "").strip()
    return text


def complete_field_briefing(system_prompt: str, user_prompt: str) -> str:
    api_key = openai_api_key()
    if not api_key:
        raise RelatedWorkError(503, {"error": "OPENAI_API_KEY is not configured"})
    payload = field_briefing_request_payload(system_prompt, user_prompt)

    def call(body: dict) -> dict:
        request = urllib.request.Request(
            f"{openai_base_url()}/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(request, timeout=FIELD_BRIEFING_TIMEOUT) as response:
            raw = response.read().decode("utf-8") or "{}"
            return json.loads(raw)

    try:
        try:
            data = call(payload)
        except urllib.error.HTTPError as exc:
            if exc.code in (400, 422) and "response_format" in payload:
                detail = exc.read().decode("utf-8", "replace")[:300]
                sys.stderr.write(
                    "field-briefing retry without response_format %s %s\n"
                    % (exc.code, detail.replace("\n", " "))
                )
                retry_payload = dict(payload)
                retry_payload.pop("response_format", None)
                data = call(retry_payload)
            else:
                raise
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        sys.stderr.write("field-briefing upstream %s %s\n" % (exc.code, detail.replace("\n", " ")))
        raise RelatedWorkError(502, {"error": "upstream llm error"}) from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        sys.stderr.write("field-briefing llm error: %s: %s\n" % (type(exc).__name__, exc))
        raise RelatedWorkError(502, {"error": "field-briefing failed"}) from exc
    try:
        choice = (data.get("choices") or [{}])[0] if isinstance(data, dict) else {}
        if not isinstance(choice, dict):
            choice = {}
        message = choice.get("message") or {}
        finish = str(choice.get("finish_reason") or "")
        content = _message_text(message)
    except (AttributeError, IndexError, TypeError):
        message = {}
        finish = ""
        content = ""
    if not content or finish == "length":
        keys = ",".join(sorted(str(key) for key in message.keys())) if isinstance(message, dict) else ""
        sys.stderr.write(
            "field-briefing content keys=%s finish=%s len=%s\n"
            % (keys, finish, len(content or ""))
        )
    return content


def inbox_lock_for(token: str) -> threading.Lock:
    key = token or ""
    with _INBOX_LOCKS_GUARD:
        lock = _INBOX_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _INBOX_LOCKS[key] = lock
        return lock


def bearer_or_cookie(headers) -> str:
    auth = headers.get("Authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return cookie_token(headers.get("Cookie", ""))


def rank_related_work(body: dict) -> tuple[int, dict]:
    if not openai_api_key():
        return 503, {"error": "OPENAI_API_KEY is not configured"}
    impression = clip((body or {}).get("impression"), 4000)
    topic = clip((body or {}).get("topic"), 120)
    keywords = clip((body or {}).get("keywords"), 200)
    incoming = (body or {}).get("candidates")
    incoming = incoming if isinstance(incoming, list) else []
    if not topic and not keywords:
        if impression:
            topic = clip(impression, 120)
        else:
            return 400, {"error": "topic or keywords required"}

    candidates = []
    allowed_ids: set[str] = set()
    for item in incoming:
        if not isinstance(item, dict):
            continue
        item_id = clip(item.get("id"), 180)
        title = clip(item.get("title"), 300)
        if not item_id or not title or item_id in allowed_ids:
            continue
        allowed_ids.add(item_id)
        candidates.append({
            "id": item_id,
            "title": title,
            "category": clip(item.get("category"), 80),
            "conference": clip(item.get("conference"), 80),
            "year": clip(item.get("year"), 8),
            "summary": clip(item.get("summary"), 240),
        })
        if len(candidates) >= 40:
            break
    if not candidates:
        return 400, {"error": "candidates required"}

    listed = "\n".join(
        "\n".join([
            f"{index + 1}. id={paper['id']}",
            f"   title={paper['title']}",
            f"   year={paper['year']} conference={paper['conference']} category={paper['category']}",
            f"   summary={paper['summary']}",
        ])
        for index, paper in enumerate(candidates)
    )
    system_prompt = "\n".join([
        "You are a security-research librarian helping find related work.",
        "Select the most relevant papers for the user's research direction and keywords.",
        "Return ONLY a JSON array, no markdown.",
        'Each item: {"id":"<candidate id>","score":0.0-1.0,"reason":"<one Chinese sentence explaining why this paper is related work>"}',
        "Rules:",
        "- Use only provided candidate ids",
        "- Sort by score descending",
        "- Return 6 to 12 items if possible, fewer if matches are weak",
        "- Reasons must be specific (method, threat model, artifact, or problem overlap), not generic",
    ])
    user_prompt = "\n".join([
        f"研究方向: {topic or '(none)'}",
        f"关键词: {keywords or '(none)'}",
        f"研究者印象: {clip(impression, 800) or '(none)'}",
        "",
        "候选论文:",
        listed,
    ])
    try:
        content = complete_related_work(system_prompt, user_prompt)
        items = normalize_items(parse_model_json(content), allowed_ids)
    except RelatedWorkError as exc:
        return exc.status, exc.payload
    except Exception:
        return 502, {"error": "related-work failed"}
    if not items:
        return 502, {"error": "empty ranking"}
    return 200, {"items": items, "source": "llm"}


def rank_field_briefing(body: dict) -> tuple[int, dict]:
    return field_briefing.run_field_briefing(
        body,
        public_root(),
        complete_field_briefing,
        has_api_key=bool(openai_api_key()),
    )


def complete_summary_brief(system_prompt: str, user_prompt: str) -> str:
    return complete_field_briefing(system_prompt, user_prompt)


def rank_summary_brief(body: dict) -> tuple[int, dict]:
    return summary_brief.run_summary_brief(
        body,
        public_root(),
        complete_summary_brief,
        has_api_key=bool(openai_api_key()),
    )


def public_root() -> Path:
    return Path(os.environ.get("FASTNEWS_ROOT", Path(__file__).resolve().parent)).resolve()


def research_api_url() -> str:
    return os.environ.get("FASTRESEARCH_API_URL", "http://127.0.0.1:8787").strip().rstrip("/")


def panel_url() -> str:
    return os.environ.get("FASTRESEARCH_PANEL_URL", "http://127.0.0.1:5173").strip().rstrip("/") or "http://127.0.0.1:5173"



def public_path() -> str:
    raw = os.environ.get("FASTNEWS_PUBLIC_PATH", "").strip()
    if not raw or raw == "/":
        return ""
    if not raw.startswith("/"):
        raw = "/" + raw
    return raw.rstrip("/")


def public_location(path: str) -> str:
    prefix = public_path()
    location = path or "/"
    if not prefix:
        return location
    if location == "/":
        return prefix + "/"
    if location == prefix or location.startswith(prefix + "/"):
        return location
    if location.startswith("/"):
        return prefix + location
    return prefix + "/" + location


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
        if parsed.path == RELATED_WORK_PATH:
            self._related_work()
            return
        if parsed.path == FIELD_BRIEFING_PATH:
            self._field_briefing()
            return
        if parsed.path == SUMMARY_BRIEF_PATH:
            self._summary_brief()
            return
        if parsed.path == INBOX_PATH:
            self._inbox()
            return
        if parsed.path == FASTREAD_PATH:
            self._fastread()
            return
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
        self._file(parsed.path or "/", parsed.query)

    def _bounce(self):
        self._redirect(panel_url())

    def _consume(self, ticket: str, path: str):
        try:
            payload = consume_ticket(ticket)
        except AuthError:
            self._bounce()
            return
        location = public_location(path or "/")
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

    def _file(self, url_path: str, query: str = ""):
        target = resolve_public_file(url_path)
        if target is None:
            self.send_error(404, "Not Found")
            return
        data = target.read_bytes()
        if target.suffix.lower() in {".html", ".htm"}:
            inject = f"<script>window.FASTNEWS_PANEL_URL={json.dumps(panel_url())};</script>".encode("utf-8")
            lowered = data.lower()
            idx = lowered.find(b"<head>")
            if idx >= 0:
                insert_at = idx + len(b"<head>")
                data = data[:insert_at] + inject + data[insert_at:]
            else:
                data = inject + data
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        params = urllib.parse.parse_qs(query, keep_blank_values=True)
        as_download = (params.get("download") or [""])[0].strip().lower() in {"1", "true", "yes"}
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "same-origin")
        if as_download:
            filename = target.name.replace("\\", "").replace('"', "")
            encoded = urllib.parse.quote(filename)
            self.send_header(
                "Content-Disposition",
                f'attachment; filename="{filename}"; filename*=UTF-8\'\'{encoded}',
            )
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _write_json(self, status: int, payload: dict | None):
        data = b"" if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if payload is not None:
            self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD" and data:
            self.wfile.write(data)

    def _fastread(self):
        if self.command == "OPTIONS":
            self._write_json(204, None)
            return
        if self.command != "POST":
            self._write_json(405, {"error": "Method not allowed"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            body = {}
        if not isinstance(body, dict):
            body = {}
        status, payload = build_fastread_handoff(body)
        self._write_json(status, payload)

    def _related_work(self):
        if self.command == "OPTIONS":
            self._write_json(204, None)
            return
        if self.command != "POST":
            self._write_json(405, {"error": "Method not allowed"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            body = {}
        if not isinstance(body, dict):
            body = {}
        status, payload = rank_related_work(body)
        self._write_json(status, payload)

    def _ensure_today_inbox(self, token: str, payload: dict) -> dict:
        items = payload.get("items") if isinstance(payload, dict) else []
        items = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
        generated = False
        if inbox_push.find_today_item(items):
            unread = sum(1 for item in items if not item.get("read"))
            return {"items": items, "unread": unread, "generatedToday": False}
        impression_text = ""
        authors = []
        custom_tags = []
        try:
            impression_payload, _status = json_request(
                "GET",
                f"{research_api_url()}/api/content/impression",
                token=token,
            )
            impression = impression_payload.get("impression") if isinstance(impression_payload, dict) else {}
            if isinstance(impression, dict):
                impression_text = str(impression.get("text") or "")
        except AuthError:
            pass
        try:
            authors_payload, _status = json_request(
                "GET",
                f"{research_api_url()}/api/content/authors",
                token=token,
            )
            if isinstance(authors_payload, dict):
                authors = authors_payload.get("authors") or []
                custom_tags = authors_payload.get("customTags") or []
        except AuthError:
            pass
        item, created = inbox_push.generate_daily_item(
            public_root(),
            impression_text,
            authors,
            custom_tags,
            items,
            complete_field_briefing,
            has_api_key=bool(openai_api_key()),
        )
        if created and item:
            items = [item, *items][:180]
            try:
                saved, _status = json_request(
                    "PUT",
                    f"{research_api_url()}/api/content/inbox",
                    {"items": items},
                    token=token,
                    timeout=10,
                )
                if isinstance(saved, dict) and isinstance(saved.get("items"), list):
                    items = [entry for entry in saved["items"] if isinstance(entry, dict)]
                generated = True
            except AuthError:
                generated = True
        unread = sum(1 for entry in items if not entry.get("read"))
        return {"items": items, "unread": unread, "generatedToday": generated}

    def _inbox(self):
        if self.command == "OPTIONS":
            self._write_json(204, None)
            return
        if self.command not in {"GET", "PUT", "HEAD"}:
            self._write_json(405, {"error": "Method not allowed"})
            return
        if self.command != "GET":
            self._proxy(urllib.parse.urlparse(self.path))
            return
        token = bearer_or_cookie(self.headers)
        if not token:
            self._write_json(401, {"error": "成员登录已失效"})
            return
        with inbox_lock_for(token):
            try:
                payload, _status = json_request(
                    "GET",
                    f"{research_api_url()}/api/content/inbox",
                    token=token,
                    timeout=10,
                )
            except AuthError as exc:
                self._write_json(exc.status, exc.payload)
                return
            if not isinstance(payload, dict):
                payload = {"items": []}
            result = self._ensure_today_inbox(token, payload)
        self._write_json(200, result)

    def _summary_brief(self):
        if self.command == "OPTIONS":
            self._write_json(204, None)
            return
        if self.command != "POST":
            self._write_json(405, {"error": "Method not allowed"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            body = {}
        if not isinstance(body, dict):
            body = {}
        status, payload = rank_summary_brief(body)
        self._write_json(status, payload)

    def _field_briefing(self):
        if self.command == "OPTIONS":
            self._write_json(204, None)
            return
        if self.command != "POST":
            self._write_json(405, {"error": "Method not allowed"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            body = {}
        if not isinstance(body, dict):
            body = {}
        status, payload = rank_field_briefing(body)
        self._write_json(status, payload)

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
