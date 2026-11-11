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

    def test_removed_legacy_auth_does_not_create_database(self):
        # Independent accounts now use /api/auth/*, with Origin and CSRF checks.
        # The retired /auth/* endpoints must not recreate the legacy database.
        for path in ("/auth/login", "/auth/register"):
            status, _, _ = self.request(path, "POST", {"username": "a", "password": "wrong-password"})
            self.assertEqual(status, 405)
        self.assertFalse((self.root / "accounts.sqlite").exists())
        self.assertEqual(self.request("/")[0], 200)


if __name__ == "__main__":
    unittest.main()
