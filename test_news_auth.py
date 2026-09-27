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


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def http_error_302(self, req, fp, code, msg, headers):
        raise urllib.error.HTTPError(req.full_url, code, msg, headers, fp)
    http_error_303 = http_error_302


class NewsAuthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[2])
        self.root = Path(self.temp.name)
        (self.root / "index.html").write_text("<html>offline report</html>", encoding="utf-8")
        self.old = {key: os.environ.get(key) for key in ("FASTNEWS_ACCOUNT_DB", "FASTNEWS_INVITE_CODE", "FASTNEWS_ROOT", "FASTRESEARCH_API_URL", "FASTNEWS_FASTCAS_ISSUER")}
        os.environ["FASTNEWS_ACCOUNT_DB"] = str(self.root / "accounts.sqlite")
        os.environ["FASTNEWS_INVITE_CODE"] = "test-invite"
        os.environ["FASTNEWS_ROOT"] = str(self.root)
        os.environ["FASTRESEARCH_API_URL"] = "http://127.0.0.1:1"
        os.environ["FASTNEWS_FASTCAS_ISSUER"] = ""
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), serve.FastNewsHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        for key, value in self.old.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.temp.cleanup()

    def request(self, path, method="GET", value=None, cookie=""):
        headers = {"Origin": self.base, "Content-Type": "application/json"}
        if cookie:
            headers["Cookie"] = cookie
        raw = json.dumps(value).encode() if value is not None else None
        req = urllib.request.Request(self.base + path, data=raw, method=method, headers=headers)
        try:
            with urllib.request.build_opener(NoRedirect).open(req, timeout=5) as response:
                return response.status, dict(response.headers), response.read()
        except urllib.error.HTTPError as exc:
            return exc.code, dict(exc.headers), exc.read()

    def test_offline_local_account_and_no_database_on_failed_login(self):
        database = self.root / "accounts.sqlite"
        status, _, _ = self.request("/auth/login", "POST", {"username": "a", "password": "wrong-password"})
        self.assertEqual(status, 400)
        self.assertFalse(database.exists())
        status, headers, data = self.request("/auth/register", "POST", {"invite": "test-invite", "username": "Alice", "display_name": "同名", "password": "strong-password-1"})
        self.assertEqual(status, 201)
        self.assertTrue(database.exists())
        self.assertTrue(json.loads(data)["recoveryCode"])
        cookie = headers["Set-Cookie"].split(";", 1)[0]
        self.assertTrue(cookie.startswith("fastnews_session="))
        self.assertEqual(self.request("/", cookie=cookie)[0], 200)
        self.assertEqual(self.request("/api/content/me", cookie=cookie)[0], 200)
        status, _, data = self.request("/api/content/authors", "PUT", {"authors": [{"name": "Alice"}], "customTags": ["AI"]}, cookie)
        self.assertEqual(status, 200)
        self.assertEqual(len(json.loads(data)["authors"]), 1)
        self.assertEqual(self.request("/api/content/authors", cookie=cookie)[0], 200)
        self.assertEqual(self.request("/auth/fastcas/available")[0], 200)
        self.assertEqual(self.request("/api/me/research")[0], 401)


if __name__ == "__main__":
    unittest.main()
