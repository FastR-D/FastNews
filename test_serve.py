from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import serve


class DummyHeaders(dict):
    def items(self):
        return list(super().items())

    def keys(self):
        return list(super().keys())


class DummyResponse:
    def __init__(self, status=200, payload=None, headers=None):
        self.status = status
        self._payload = json.dumps(payload or {}).encode("utf-8")
        self.headers = DummyHeaders(headers or {"Content-Type": "application/json"})

    def read(self):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FastNewsServeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "index.html").write_text("<html><body>secret-report</body></html>", encoding="utf-8")
        (self.root / "hidden.py").write_text("print('nope')\n", encoding="utf-8")
        os.environ["FASTNEWS_ROOT"] = str(self.root)
        os.environ["FASTRESEARCH_API_URL"] = "http://research.test"
        os.environ["FASTRESEARCH_PANEL_URL"] = "http://127.0.0.1:5173"
        serve.clear_session_cache()
        self.consume = {}
        self.me = {}
        self.proxied = []

        def fake_json(method, url, payload=None, token="", timeout=5):
            if url.endswith("/api/sso/consume"):
                ticket = (payload or {}).get("ticket")
                identity = self.consume.get(ticket)
                if not identity:
                    raise serve.AuthError(401, {"error": "登录票据无效或已过期"})
                return identity, 200
            if url.endswith("/api/content/me"):
                identity = self.me.get(token)
                if not identity:
                    raise serve.AuthError(401, {"error": "成员登录已失效"})
                return identity, 200
            raise serve.AuthError(404, {"error": "接口不存在"})

        def fake_urlopen(request, timeout=10):
            self.proxied.append({
                "url": request.full_url,
                "method": request.get_method(),
                "headers": dict(request.header_items()),
            })
            if request.full_url.endswith("/api/content/me"):
                cookie = dict(request.header_items()).get("Cookie") or dict(request.header_items()).get("cookie")
                if cookie and "good-session" in cookie:
                    return DummyResponse(200, {"keyId": "aabbcc", "person": "张三"})
                err = urllib.error.HTTPError(request.full_url, 401, "unauthorized", DummyHeaders({"Content-Type": "application/json"}), None)
                err._payload = json.dumps({"error": "成员登录已失效"}).encode("utf-8")
                err.read = lambda: json.dumps({"error": "成员登录已失效"}).encode("utf-8")
                raise err
            return DummyResponse(200, {"ok": True})

        self._json = serve.json_request
        self._urlopen = serve.urllib.request.urlopen
        serve.json_request = fake_json
        serve.urllib.request.urlopen = fake_urlopen
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), serve.FastNewsHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        serve.json_request = self._json
        serve.urllib.request.urlopen = self._urlopen
        self.tmp.cleanup()

    def request(self, path, headers=None, method="GET"):
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def http_error_302(self, req, fp, code, msg, headers):
                raise urllib.error.HTTPError(req.full_url, code, msg, headers, fp)
            http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302

        opener = urllib.request.build_opener(NoRedirect)
        req = urllib.request.Request(self.base + path, method=method, headers=headers or {})
        try:
            with opener.open(req, timeout=5) as response:
                return response.status, dict(response.headers), response.read()
        except urllib.error.HTTPError as exc:
            body = exc.read()
            return exc.code, dict(exc.headers), body

    def test_anonymous_document_redirects_to_panel(self):
        status, headers, _body = self.request("/")
        self.assertEqual(status, 302)
        self.assertEqual(headers.get("Location"), "http://127.0.0.1:5173")
        self.assertNotIn(b"secret-report", _body)

    def test_sso_ticket_sets_cookie_and_redirects_home(self):
        self.consume["ticket-1"] = {
            "session": "good-session",
            "keyId": "aabbcc",
            "person": "张三",
            "expiresAt": 9_999_999_999_000,
        }
        status, headers, _body = self.request("/?sso=ticket-1")
        self.assertEqual(status, 302)
        self.assertEqual(headers.get("Location"), "/")
        self.assertIn("fr_session=", headers.get("Set-Cookie", ""))
        self.assertIn("HttpOnly", headers.get("Set-Cookie", ""))
        self.assertIn("good-session", headers.get("Set-Cookie", ""))

    def test_invalid_ticket_redirects_to_panel(self):
        status, headers, _body = self.request("/?sso=expired")
        self.assertEqual(status, 302)
        self.assertEqual(headers.get("Location"), "http://127.0.0.1:5173")
        self.assertNotIn("Set-Cookie", headers)

    def test_valid_cookie_serves_index(self):
        self.me["good-session"] = {"keyId": "aabbcc", "person": "张三"}
        status, _headers, body = self.request("/", headers={"Cookie": "fr_session=good-session"})
        self.assertEqual(status, 200)
        self.assertIn(b"secret-report", body)

    def test_invalid_cookie_redirects_to_panel(self):
        status, headers, body = self.request("/", headers={"Cookie": "fr_session=bad"})
        self.assertEqual(status, 302)
        self.assertEqual(headers.get("Location"), "http://127.0.0.1:5173")
        self.assertNotIn(b"secret-report", body)

    def test_health_api_is_not_redirected(self):
        status, _headers, body = self.request("/api/content/me", headers={"Cookie": "fr_session=good-session"})
        self.assertEqual(status, 200)
        self.assertIn(b"aabbcc", body)
        self.assertTrue(self.proxied)

    def test_python_files_are_not_served(self):
        self.me["good-session"] = {"keyId": "aabbcc", "person": "张三"}
        status, _headers, _body = self.request("/hidden.py", headers={"Cookie": "fr_session=good-session"})
        self.assertEqual(status, 404)

    def test_path_traversal_is_rejected(self):
        self.me["good-session"] = {"keyId": "aabbcc", "person": "张三"}
        status, _headers, _body = self.request("/../hidden.py", headers={"Cookie": "fr_session=good-session"})
        self.assertIn(status, {400, 404})



    def test_access_log_redacts_sso_ticket(self):
        self.assertEqual(
            serve.redact_request_line('"GET /?sso=ticket-1 HTTP/1.1" 302 -'),
            '"GET /?sso=redacted HTTP/1.1" 302 -',
        )
        self.assertEqual(
            serve.redact_request_line('"GET /secnews/?sso=abc&x=1 HTTP/1.1" 302 -'),
            '"GET /secnews/?sso=redacted&x=1 HTTP/1.1" 302 -',
        )
        self.assertNotIn("ticket-1", serve.redact_request_line('"GET /?sso=ticket-1 HTTP/1.1" 302 -'))


if __name__ == "__main__":
    unittest.main()
