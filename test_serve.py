from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import field_briefing
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
        self.inbox_items = []
        self.saved_inbox = None
        self.impression = {"text": "", "updatedAt": ""}
        self.authors_payload = {"authors": [], "customTags": []}

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
            if url.endswith("/api/content/inbox"):
                if token and token not in self.me:
                    raise serve.AuthError(401, {"error": "成员登录已失效"})
                if method == "PUT":
                    self.saved_inbox = payload
                    items = (payload or {}).get("items") or []
                    unread = sum(1 for item in items if isinstance(item, dict) and not item.get("read"))
                    return {"items": items, "unread": unread}, 200
                return {"items": list(self.inbox_items), "unread": sum(1 for item in self.inbox_items if not item.get("read"))}, 200
            if url.endswith("/api/content/impression"):
                if token and token not in self.me:
                    raise serve.AuthError(401, {"error": "成员登录已失效"})
                return {"impression": dict(self.impression)}, 200
            if url.endswith("/api/content/authors"):
                if token and token not in self.me:
                    raise serve.AuthError(401, {"error": "成员登录已失效"})
                return dict(self.authors_payload), 200
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
        self._env = {key: os.environ.get(key) for key in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "LLM_MODEL", "FASTREAD_URL")}
        os.environ["OPENAI_API_KEY"] = "test-key"
        os.environ["OPENAI_BASE_URL"] = "https://llm.test/v1"
        os.environ["FASTREAD_URL"] = "http://127.0.0.1:3015"
        os.environ["LLM_MODEL"] = "test-model"
        self._complete = serve.complete_related_work
        self._field_complete = serve.complete_field_briefing
        self._summary_complete = serve.complete_summary_brief

        def blocked_llm(*_args, **_kwargs):
            raise AssertionError("related-work LLM should be mocked")

        def blocked_field_llm(*_args, **_kwargs):
            raise AssertionError("field-briefing LLM should be mocked")

        def blocked_summary_llm(*_args, **_kwargs):
            raise AssertionError("summary-brief LLM should be mocked")

        serve.complete_related_work = blocked_llm
        serve.complete_field_briefing = blocked_field_llm
        serve.complete_summary_brief = blocked_summary_llm
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), serve.FastNewsHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        serve.json_request = self._json
        serve.urllib.request.urlopen = self._urlopen
        serve.complete_related_work = self._complete
        serve.complete_field_briefing = self._field_complete
        serve.complete_summary_brief = self._summary_complete
        for key, value in self._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    def request(self, path, headers=None, method="GET", data=None):
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def http_error_302(self, req, fp, code, msg, headers):
                raise urllib.error.HTTPError(req.full_url, code, msg, headers, fp)
            http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302

        opener = urllib.request.build_opener(NoRedirect)
        body = None
        hdrs = dict(headers or {})
        if data is not None:
            body = json.dumps(data).encode("utf-8")
            hdrs.setdefault("Content-Type", "application/json")
        req = urllib.request.Request(self.base + path, data=body, method=method, headers=hdrs)
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

    def test_download_query_sets_content_disposition(self):
        self.me["good-session"] = {"keyId": "aabbcc", "person": "张三"}
        (self.root / "CCS_2023_Report.html").write_text("<html>ccs</html>", encoding="utf-8")
        status, headers, body = self.request(
            "/CCS_2023_Report.html?download=1",
            headers={"Cookie": "fr_session=good-session"},
        )
        self.assertEqual(status, 200)
        disposition = headers.get("Content-Disposition", "")
        self.assertIn("attachment", disposition)
        self.assertIn("CCS_2023_Report.html", disposition)
        self.assertIn(b"<html>ccs</html>", body)

    def test_html_without_download_query_is_inline(self):
        self.me["good-session"] = {"keyId": "aabbcc", "person": "张三"}
        status, headers, body = self.request("/", headers={"Cookie": "fr_session=good-session"})
        self.assertEqual(status, 200)
        self.assertNotIn("attachment", headers.get("Content-Disposition", ""))
        self.assertIn(b"secret-report", body)

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


    def related_payload(self, **overrides):
        payload = {
            "topic": "ML security",
            "keywords": "jailbreak",
            "candidates": [
                {"id": "p1", "title": "Jailbreak Defense", "year": "2026", "conference": "NDSS", "category": "ML", "summary": "Detect jailbreaks."},
                {"id": "p2", "title": "Side Channel", "year": "2025", "conference": "S&P", "category": "Hardware", "summary": "Cache attacks."},
            ],
        }
        payload.update(overrides)
        return payload

    def test_fastread_options_ok(self):
        status, headers, body = self.request("/api/fastread", method="OPTIONS")
        self.assertEqual(status, 204)
        self.assertEqual(headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS")
        self.assertFalse(body)
        self.assertFalse(self.proxied)

    def test_fastread_get_is_not_proxied(self):
        status, _headers, body = self.request("/api/fastread")
        self.assertEqual(status, 405)
        self.assertIn(b"Method not allowed", body)
        self.assertFalse(self.proxied)

    def test_fastread_requires_title(self):
        status, _headers, body = self.request("/api/fastread", method="POST", data={"abstract": "\u6458\u8981"})
        self.assertEqual(status, 400)
        self.assertIn(b"title required", body)
        self.assertFalse(self.proxied)

    def test_fastread_builds_redirect(self):
        status, _headers, body = self.request("/api/fastread", method="POST", data={
            "title": "TwinBreak",
            "author": "Ada Lovelace",
            "summary": "\u4e2d\u6587\u6458\u8981\u7528\u4e8e\u9605\u8bfb\u3002",
            "link": "https://doi.org/10.1145/example",
            "venue": "ACM CCS",
            "year": 2024,
            "id": "p-twinbreak",
        })
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["paper"]["title"], "TwinBreak")
        self.assertEqual(payload["paper"]["authors"], "Ada Lovelace")
        self.assertEqual(payload["paper"]["abstract"], "\u4e2d\u6587\u6458\u8981\u7528\u4e8e\u9605\u8bfb\u3002")
        self.assertEqual(payload["paper"]["url"], "https://doi.org/10.1145/example")
        self.assertTrue(payload["redirect"].startswith("http://127.0.0.1:3015/#fastnews="))
        encoded = payload["redirect"].split("#fastnews=", 1)[1]
        handed = json.loads(urllib.parse.unquote(encoded))
        self.assertEqual(handed["title"], "TwinBreak")
        self.assertEqual(handed["authors"], "Ada Lovelace")
        self.assertFalse(self.proxied)

    def test_fastread_rejects_credentialed_url(self):
        status, _headers, body = self.request("/api/fastread", method="POST", data={
            "title": "TwinBreak",
            "url": "https://user:pass@example.com/paper.pdf",
        })
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertNotIn("url", payload["paper"])
        self.assertFalse(self.proxied)

    def test_fastread_clips_long_abstract(self):
        status, payload = serve.build_fastread_handoff({
            "title": "TwinBreak",
            "abstract": "\u6458\u8981" * 4000,
        })
        self.assertEqual(status, 200)
        self.assertLessEqual(len(payload["redirect"]), serve.FASTREAD_REDIRECT_MAX)
        self.assertLessEqual(len(payload["paper"].get("abstract", "")), 240)

    def test_fastread_rejects_unsafe_base_url(self):
        os.environ["FASTREAD_URL"] = "javascript:alert(1)"
        status, payload = serve.build_fastread_handoff({"title": "TwinBreak"})
        self.assertEqual(status, 200)
        self.assertTrue(payload["redirect"].startswith("http://127.0.0.1:3015/#fastnews="))

    def test_related_work_options_ok(self):
        status, headers, body = self.request("/api/related-work", method="OPTIONS")
        self.assertEqual(status, 204)
        self.assertEqual(headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS")
        self.assertFalse(body)
        self.assertFalse(self.proxied)

    def test_related_work_get_is_not_proxied(self):
        status, _headers, body = self.request("/api/related-work")
        self.assertEqual(status, 405)
        self.assertIn(b"Method not allowed", body)
        self.assertFalse(self.proxied)

    def test_related_work_requires_topic_or_keywords(self):
        status, _headers, body = self.request("/api/related-work", method="POST", data=self.related_payload(topic="", keywords=""))
        self.assertEqual(status, 400)
        self.assertIn(b"topic or keywords required", body)
        self.assertFalse(self.proxied)

    def test_related_work_accepts_impression_without_topic(self):
        def fake_llm(_system, user_prompt):
            self.assertIn("jailbreak defense", user_prompt)
            self.assertIn("研究者印象", user_prompt)
            return json.dumps([
                {"id": "p1", "score": 0.9, "reason": "匹配研究印象。"},
            ])

        serve.complete_related_work = fake_llm
        status, _headers, body = self.request(
            "/api/related-work",
            method="POST",
            data=self.related_payload(topic="", keywords="", impression="jailbreak defense"),
        )
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertEqual([item["id"] for item in payload["items"]], ["p1"])
        self.assertFalse(self.proxied)

    def test_related_work_requires_candidates(self):
        status, _headers, body = self.request("/api/related-work", method="POST", data={"topic": "privacy", "candidates": []})
        self.assertEqual(status, 400)
        self.assertIn(b"candidates required", body)

    def test_related_work_requires_api_key(self):
        os.environ.pop("OPENAI_API_KEY", None)
        status, _headers, body = self.request("/api/related-work", method="POST", data=self.related_payload())
        self.assertEqual(status, 503)
        self.assertIn(b"OPENAI_API_KEY is not configured", body)

    def test_related_work_ranks_with_local_llm(self):
        def fake_llm(system_prompt, user_prompt):
            self.assertIn("Jailbreak Defense", user_prompt)
            return json.dumps([
                {"id": "p1", "score": 0.91, "reason": "同为越狱防御。"},
                {"id": "unknown", "score": 0.8, "reason": "应被过滤"},
                {"id": "p2", "score": 0.2, "reason": "相关度较低。"},
            ])

        serve.complete_related_work = fake_llm
        status, _headers, body = self.request("/api/related-work", method="POST", data=self.related_payload())
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertEqual(payload["source"], "llm")
        self.assertEqual([item["id"] for item in payload["items"]], ["p1", "p2"])
        self.assertEqual(payload["items"][0]["reason"], "同为越狱防御。")
        self.assertFalse(self.proxied)

    def test_related_work_empty_ranking_is_502(self):
        serve.complete_related_work = lambda *_args, **_kwargs: json.dumps([{"id": "missing", "score": 1, "reason": "x"}])
        status, _headers, body = self.request("/api/related-work", method="POST", data=self.related_payload())
        self.assertEqual(status, 502)
        self.assertIn(b"empty ranking", body)

    def test_related_work_llm_error_is_502(self):
        def boom(*_args, **_kwargs):
            raise serve.RelatedWorkError(502, {"error": "related-work failed"})

        serve.complete_related_work = boom
        status, _headers, body = self.request("/api/related-work", method="POST", data=self.related_payload())
        self.assertEqual(status, 502)
        self.assertIn(b"related-work failed", body)
        self.assertFalse(self.proxied)

    def seed_field_corpus(self):
        conference = self.root / "top-conf" / "data" / "conferences"
        summary = self.root / "top-conf" / "data" / "summary"
        conference.mkdir(parents=True)
        summary.mkdir(parents=True)
        (conference / "ndss_2026.jsonl").write_text(
            "\n".join([
                json.dumps({
                    "_id": "p-jailbreak",
                    "title": "TwinBreak: Jailbreak Attack and Defense",
                    "link": "https://example.com/jailbreak",
                    "author": "Alice",
                    "description": "A causal analysis of LLM jailbreak prompts.",
                }, ensure_ascii=False),
                json.dumps({
                    "_id": "p-sok",
                    "title": "SoK: Jailbreak Attacks and Defenses",
                    "link": "https://example.com/sok-jailbreak",
                    "author": "Carol",
                    "description": "A systematization of knowledge on LLM jailbreaks.",
                }, ensure_ascii=False),
                json.dumps({
                    "_id": "p-cache",
                    "title": "Cache Side Channel Attacks",
                    "link": "https://example.com/cache",
                    "author": "Bob",
                    "description": "Microarchitectural cache attacks against TEEs.",
                }, ensure_ascii=False),
            ]) + "\n",
            encoding="utf-8",
        )
        (summary / "ndss_2026_summary.jsonl").write_text(
            "\n".join([
                json.dumps({
                    "category": "ML/AI Security",
                    "paper": {
                        "_id": "p-jailbreak",
                        "title": "TwinBreak: Jailbreak Attack and Defense",
                        "link": "https://example.com/jailbreak",
                        "author": "Alice",
                        "summary_zh": "从因果视角分析大模型越狱提示，并用于攻击增强与防御。",
                    },
                }, ensure_ascii=False),
                json.dumps({
                    "category": "ML/AI Security",
                    "paper": {
                        "_id": "p-sok",
                        "title": "SoK: Jailbreak Attacks and Defenses",
                        "link": "https://example.com/sok-jailbreak",
                        "author": "Carol",
                        "summary_zh": "系统整理大模型越狱攻防文献。",
                    },
                }, ensure_ascii=False),
                json.dumps({
                    "category": "Hardware Security",
                    "paper": {
                        "_id": "p-cache",
                        "title": "Cache Side Channel Attacks",
                        "link": "https://example.com/cache",
                        "author": "Bob",
                        "summary_zh": "针对 TEE 的缓存侧信道攻击。",
                    },
                }, ensure_ascii=False),
            ]) + "\n",
            encoding="utf-8",
        )
        field_briefing.clear_corpus_cache()

    def test_field_briefing_options_ok(self):
        status, headers, body = self.request("/api/field-briefing", method="OPTIONS")
        self.assertEqual(status, 204)
        self.assertEqual(headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS")
        self.assertFalse(body)
        self.assertFalse(self.proxied)

    def test_field_briefing_get_is_not_proxied(self):
        status, _headers, body = self.request("/api/field-briefing")
        self.assertEqual(status, 405)
        self.assertIn(b"Method not allowed", body)
        self.assertFalse(self.proxied)

    def test_field_briefing_requires_query(self):
        status, _headers, body = self.request("/api/field-briefing", method="POST", data={})
        self.assertEqual(status, 400)
        self.assertIn(b"query required", body)
        self.assertFalse(self.proxied)

    def test_field_briefing_without_api_key_is_lexical(self):
        self.seed_field_corpus()
        os.environ.pop("OPENAI_API_KEY", None)
        status, _headers, body = self.request("/api/field-briefing", method="POST", data={"query": "LLM jailbreak"})
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertEqual(payload["source"], "lexical")
        self.assertIsNone(payload["briefing"])
        self.assertGreaterEqual(len(payload["papers"]), 1)
        self.assertEqual(payload["papers"][0]["id"], "p-jailbreak")
        self.assertEqual(payload["surveys"][0]["id"], "p-sok")
        self.assertNotIn("p-sok", [item["id"] for item in payload["papers"]])
        self.assertFalse(self.proxied)

    def test_field_briefing_ranks_with_local_llm(self):
        self.seed_field_corpus()

        def fake_llm(system_prompt, user_prompt):
            self.assertIn("TwinBreak", user_prompt)
            return json.dumps({
                "field_zh": "大模型越狱",
                "field_en": "LLM Jailbreak",
                "coverage": "本地命中以近年顶会为主。",
                "problem": "绕过大模型安全对齐。",
                "threat_model": "黑盒提示攻击者。",
                "methods": "模板攻击、因果分析和防御。",
                "subareas": [{"name": "越狱攻击", "summary": "构造提示绕过对齐。"}],
                "evaluation": "攻击成功率与防御效果。",
                "open_problems": "自适应越狱仍难防。",
                "surveys": [{
                    "title": "Jailbreak Survey",
                    "venue": "IEEE",
                    "year": "2024",
                    "link": "https://example.com/survey",
                    "reason": "该方向综述。",
                }],
                "papers": [
                    {"id": "p-jailbreak", "reason": "直接研究越狱攻防。"},
                    {"id": "unknown", "reason": "应被过滤"},
                ],
            }, ensure_ascii=False)

        serve.complete_field_briefing = fake_llm
        status, _headers, body = self.request("/api/field-briefing", method="POST", data={"q": "LLM jailbreak"})
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertEqual(payload["source"], "llm")
        self.assertEqual(payload["briefing"]["field_zh"], "大模型越狱")
        self.assertEqual([item["id"] for item in payload["papers"] if item["id"] == "p-jailbreak"], ["p-jailbreak"])
        self.assertNotIn("unknown", [item["id"] for item in payload["papers"]])
        self.assertEqual(payload["papers"][0]["reason"], "直接研究越狱攻防。")
        self.assertEqual(payload["surveys"][0]["link"], "https://example.com/survey")
        self.assertFalse(self.proxied)

    def test_field_briefing_llm_error_falls_back(self):
        self.seed_field_corpus()

        def boom(*_args, **_kwargs):
            raise RuntimeError("field-briefing failed")

        serve.complete_field_briefing = boom
        status, _headers, body = self.request("/api/field-briefing", method="POST", data={"topic": "LLM jailbreak"})
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertEqual(payload["source"], "lexical")
        self.assertGreaterEqual(len(payload["papers"]), 1)
        self.assertFalse(self.proxied)


    def test_summary_brief_options_ok(self):
        status, headers, body = self.request("/api/summary-brief", method="OPTIONS")
        self.assertEqual(status, 204)
        self.assertEqual(headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS")
        self.assertFalse(body)
        self.assertFalse(self.proxied)

    def test_summary_brief_get_is_not_proxied(self):
        status, _headers, body = self.request("/api/summary-brief")
        self.assertEqual(status, 405)
        self.assertIn(b"Method not allowed", body)
        self.assertFalse(self.proxied)

    def test_summary_brief_empty_query_is_landscape(self):
        self.seed_field_corpus()
        os.environ.pop("OPENAI_API_KEY", None)
        status, _headers, body = self.request("/api/summary-brief", method="POST", data={})
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertEqual(payload["mode"], "landscape")
        self.assertEqual(payload["query"], "\u56db\u5927\u9876\u4f1a\u5168\u666f")
        self.assertEqual(payload["source"], "lexical")
        self.assertIsNotNone(payload["brief"])
        self.assertGreaterEqual(payload["stats"]["sample_size"], 1)
        self.assertFalse(self.proxied)

    def test_summary_brief_ranks_with_local_llm(self):
        self.seed_field_corpus()

        def fake_llm(system_prompt, user_prompt):
            self.assertIn("\u5b9e\u8bc1\u7b80\u62a5", system_prompt)
            self.assertIn("TwinBreak", user_prompt)
            return json.dumps({
                "title": "\u8d8a\u72f1\u6837\u672c\u96c6\u4e2d\u5728\u673a\u5668\u5b66\u4e60\u5b89\u5168",
                "hook": "\u7ed3\u6784\u5148\u4e8e\u70ed\u70b9",
                "lead": "\u672c\u671f\u7b80\u62a5\u6838\u5bf9\u6837\u672c\u7ed3\u6784\u3002",
                "findings": [
                    {"title": "ML \u5360\u6bd4\u6700\u9ad8", "body": "\u6837\u672c\u91cc ML/AI Security \u6709 2 \u7bc7\u3002"},
                    {"title": "\u5e74\u4efd\u96c6\u4e2d", "body": "2026 \u5e74\u6709 3 \u7bc7\u3002"},
                    {"title": "NDSS \u6700\u591a", "body": "NDSS \u8d21\u732e 3 \u7bc7\u3002"},
                ],
                "method": "\u4ec5\u4f7f\u7528\u672c\u5730\u9876\u4f1a\u4e2d\u6587\u6458\u8981\u3002",
                "questions": [{"qid": "Q1", "question": "\u7c7b\u522b\u662f\u5426\u5747\u8861\uff1f", "answer": "\u4e0d\u5747\u8861\u3002"}],
                "highlights": [
                    {"id": "p-jailbreak", "blurb": "\u76f4\u63a5\u7814\u7a76\u8d8a\u72f1\u653b\u9632\u3002"},
                    {"id": "unknown", "blurb": "\u5e94\u88ab\u8fc7\u6ee4"},
                ],
                "limitations": "\u8bed\u6599\u4e0d\u662f\u8fd1\u4e94\u5e74\u5168\u96c6\u3002",
                "discussion": [
                    {"title": "\u8bfb\u5206\u5e03", "body": "\u4e0d\u8981\u53ea\u8bfb\u5355\u7bc7\u70ed\u70b9\u3002"},
                    {"title": "\u65f6\u95f4\u4ecd\u662f\u66f4\u597d\u7684\u88c1\u5224", "body": "\u9ad8\u9891\u7c7b\u522b\u4e0d\u7b49\u4e8e\u957f\u671f\u4ef7\u503c\u3002"},
                ],
            }, ensure_ascii=False)

        serve.complete_summary_brief = fake_llm
        status, _headers, body = self.request("/api/summary-brief", method="POST", data={"q": "LLM jailbreak"})
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertEqual(payload["source"], "llm")
        self.assertEqual(payload["brief"]["title"], "\u8d8a\u72f1\u6837\u672c\u96c6\u4e2d\u5728\u673a\u5668\u5b66\u4e60\u5b89\u5168")
        ids = [item["id"] for item in payload["papers"]]
        self.assertIn("p-jailbreak", ids)
        self.assertNotIn("unknown", ids)
        self.assertEqual(payload["papers"][0]["reason"], "\u76f4\u63a5\u7814\u7a76\u8d8a\u72f1\u653b\u9632\u3002")
        self.assertFalse(self.proxied)

    def test_summary_brief_llm_error_falls_back(self):
        self.seed_field_corpus()

        def boom(*_args, **_kwargs):
            raise RuntimeError("summary-brief failed")

        serve.complete_summary_brief = boom
        status, _headers, body = self.request("/api/summary-brief", method="POST", data={"topic": "LLM jailbreak"})
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertEqual(payload["source"], "lexical")
        self.assertIsNotNone(payload["brief"])
        self.assertGreaterEqual(len(payload["papers"]), 1)
        self.assertFalse(self.proxied)

    def test_inbox_requires_session(self):
        status, _headers, body = self.request("/api/content/inbox")
        self.assertEqual(status, 401)
        self.assertIn("成员登录已失效".encode("utf-8"), body)
        self.assertFalse(self.proxied)

    def test_inbox_returns_existing_today_item(self):
        self.me["good-session"] = {"keyId": "aabbcc", "person": "张三"}
        today = serve.inbox_push.shanghai_today()
        existing = {
            "id": f"daily-{today}-p-jailbreak",
            "date": today,
            "kind": "daily-paper",
            "paperId": "p-jailbreak",
            "title": "TwinBreak",
            "read": False,
        }
        self.inbox_items = [existing]
        status, _headers, body = self.request("/api/content/inbox", headers={"Cookie": "fr_session=good-session"})
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertEqual(payload["generatedToday"], False)
        self.assertEqual(payload["items"][0]["id"], existing["id"])
        self.assertIsNone(self.saved_inbox)
        self.assertFalse(self.proxied)

    def test_inbox_prefers_followed_author_paper(self):
        self.me["good-session"] = {"keyId": "aabbcc", "person": "Zhang"}
        self.impression = {"text": "LLM jailbreak", "updatedAt": "2026-09-18T00:00:00Z"}
        self.authors_payload = {"authors": [{"name": "Bob", "tags": ["TEE"]}], "customTags": []}
        self.seed_field_corpus()
        status, _headers, body = self.request("/api/content/inbox", headers={"Cookie": "fr_session=good-session"})
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertTrue(payload["generatedToday"])
        self.assertEqual(payload["items"][0]["paperId"], "p-cache")
        self.assertEqual(payload["items"][0]["followedAuthor"], "Bob")
        self.assertIsNotNone(self.saved_inbox)
        self.assertEqual(self.saved_inbox["items"][0]["paperId"], "p-cache")
        self.assertFalse(self.proxied)

    def test_inbox_generates_daily_paper_from_impression(self):
        self.me["good-session"] = {"keyId": "aabbcc", "person": "张三"}
        self.impression = {"text": "LLM jailbreak", "updatedAt": "2026-09-18T00:00:00Z"}
        self.seed_field_corpus()
        status, _headers, body = self.request("/api/content/inbox", headers={"Cookie": "fr_session=good-session"})
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertTrue(payload["generatedToday"])
        self.assertEqual(payload["items"][0]["kind"], "daily-paper")
        self.assertEqual(payload["items"][0]["paperId"], "p-jailbreak")
        self.assertIsNotNone(self.saved_inbox)
        self.assertEqual(self.saved_inbox["items"][0]["paperId"], "p-jailbreak")
        self.assertFalse(self.proxied)




class FieldBriefingLlmPayloadTests(unittest.TestCase):
    def setUp(self):
        self._env = {key: os.environ.get(key) for key in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "LLM_MODEL")}
        self._urlopen = serve.urllib.request.urlopen
        os.environ["OPENAI_API_KEY"] = "test-key"
        os.environ["LLM_MODEL"] = "deepseek-v4-flash"

    def tearDown(self):
        serve.urllib.request.urlopen = self._urlopen
        for key, value in self._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_deepseek_payload_disables_thinking(self):
        os.environ["OPENAI_BASE_URL"] = "https://api.deepseek.com"
        payload = serve.field_briefing_request_payload("sys", "user")
        self.assertEqual(payload["max_tokens"], 10000)
        self.assertEqual(payload["thinking"], {"type": "disabled"})
        self.assertEqual(payload["reasoning_effort"], "none")
        self.assertEqual(payload["response_format"], {"type": "json_object"})
        self.assertEqual(payload["messages"][0]["content"], "sys")

    def test_openai_payload_omits_deepseek_fields(self):
        os.environ["OPENAI_BASE_URL"] = "https://api.openai.com/v1"
        os.environ["LLM_MODEL"] = "gpt-4.1-mini"
        payload = serve.field_briefing_request_payload("sys", "user")
        self.assertEqual(payload["max_tokens"], 10000)
        self.assertNotIn("thinking", payload)
        self.assertNotIn("reasoning_effort", payload)
        self.assertNotIn("response_format", payload)

    def test_complete_field_briefing_uses_reasoning_content(self):
        os.environ["OPENAI_BASE_URL"] = "https://api.deepseek.com"
        captured = {}

        def fake_urlopen(request, timeout=0):
            captured["timeout"] = timeout
            captured["body"] = json.loads(request.data.decode("utf-8"))
            return DummyResponse(200, {
                "choices": [{
                    "finish_reason": "stop",
                    "message": {"content": "", "reasoning_content": "{\"ok\": true}"},
                }]
            })

        serve.urllib.request.urlopen = fake_urlopen
        content = serve.complete_field_briefing("sys", "user")
        self.assertEqual(content, "{\"ok\": true}")
        self.assertEqual(captured["timeout"], 90)
        self.assertEqual(captured["body"]["thinking"], {"type": "disabled"})
        self.assertEqual(captured["body"]["max_tokens"], 10000)

if __name__ == "__main__":
    unittest.main()
