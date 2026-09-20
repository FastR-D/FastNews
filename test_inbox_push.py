from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import field_briefing
import inbox_push


SHANGHAI = timezone(timedelta(hours=8))


class InboxPushTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
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
                    "_id": "p-cache",
                    "title": "Cache Side Channel Attacks",
                    "link": "https://example.com/cache",
                    "author": "Bob (Stanford University, USA), Carol Zhang (MIT)",
                    "description": "Microarchitectural cache attacks against TEEs.",
                }, ensure_ascii=False),
                json.dumps({
                    "_id": "p-tee",
                    "title": "TEE Isolation Revisited",
                    "link": "https://example.com/tee",
                    "author": "Alina Oprea (Northeastern University), Qi Li (Tsinghua University)",
                    "description": "A study of isolation bugs in trusted execution environments.",
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
                        "summary_zh": "\u4ece\u56e0\u679c\u89c6\u89d2\u5206\u6790\u5927\u6a21\u578b\u8d8a\u72f1\u63d0\u793a\u3002",
                    },
                }, ensure_ascii=False),
                json.dumps({
                    "category": "Hardware Security",
                    "paper": {
                        "_id": "p-cache",
                        "title": "Cache Side Channel Attacks",
                        "link": "https://example.com/cache",
                        "author": "Bob (Stanford University, USA), Carol Zhang (MIT)",
                        "summary_zh": "\u9488\u5bf9 TEE \u7684\u7f13\u5b58\u4fa7\u4fe1\u9053\u3002",
                    },
                }, ensure_ascii=False),
                json.dumps({
                    "category": "Hardware Security",
                    "paper": {
                        "_id": "p-tee",
                        "title": "TEE Isolation Revisited",
                        "link": "https://example.com/tee",
                        "author": "Alina Oprea (Northeastern University), Qi Li (Tsinghua University)",
                        "summary_zh": "\u5206\u6790\u53ef\u4fe1\u6267\u884c\u73af\u5883\u7684\u9694\u79bb\u7f3a\u9677\u3002",
                    },
                }, ensure_ascii=False),
            ]) + "\n",
            encoding="utf-8",
        )
        field_briefing.clear_corpus_cache()
        self.now = datetime(2026, 9, 18, 10, 0, tzinfo=SHANGHAI)

    def tearDown(self):
        field_briefing.clear_corpus_cache()
        self.tmp.cleanup()

    def test_query_prefers_impression(self):
        query = inbox_push.query_from_profile(
            "LLM jailbreak\nTEE",
            [{"tags": ["\u4fa7\u4fe1\u9053"]}],
            ["fuzzing"],
        )
        self.assertIn("LLM jailbreak", query)

    def test_query_falls_back_to_author_tags(self):
        query = inbox_push.query_from_profile("", [{"tags": ["\u4fa7\u4fe1\u9053", "TEE"]}], ["fuzzing"])
        self.assertIn("\u4fa7\u4fe1\u9053", query)
        self.assertIn("TEE", query)
        self.assertIn("fuzzing", query)

    def test_parse_authors_strips_affiliations(self):
        names = inbox_push.parse_paper_authors(
            "Omar Abusabha (Sungkyunkwan University, South Korea), Jiyong Uhm (SKKU)"
        )
        self.assertEqual(names, ["Omar Abusabha", "Jiyong Uhm"])

    def test_names_match_full_and_initial(self):
        self.assertTrue(inbox_push.names_match("Alina Oprea", "Alina Oprea"))
        self.assertTrue(inbox_push.names_match("A. Oprea", "Alina Oprea"))
        self.assertTrue(inbox_push.names_match("Qi Li", "Qi Li"))
        self.assertFalse(inbox_push.names_match("Li", "Qi Li"))
        self.assertFalse(inbox_push.names_match("Qi Li", "Xiaoguo Li"))
        self.assertTrue(inbox_push.names_match("\u5f20\u4e09", "\u5f20\u4e09"))
        self.assertFalse(inbox_push.names_match("\u5f20", "\u5f20\u4e09"))

    def test_existing_today_item_is_reused(self):
        today = inbox_push.shanghai_today(self.now)
        existing = {"date": today, "kind": "daily-paper", "paperId": "p-jailbreak", "id": "x"}
        item, created = inbox_push.generate_daily_item(
            self.root,
            "LLM jailbreak",
            inbox=[existing],
            now=self.now,
        )
        self.assertFalse(created)
        self.assertEqual(item["id"], "x")

    def test_skips_already_pushed_paper(self):
        yesterday = (self.now.date() - timedelta(days=1)).isoformat()
        inbox = [{
            "id": "old",
            "date": yesterday,
            "kind": "daily-paper",
            "paperId": "p-jailbreak",
            "url": "https://example.com/jailbreak",
        }]
        item, created = inbox_push.generate_daily_item(
            self.root,
            "LLM jailbreak",
            inbox=inbox,
            now=self.now,
        )
        self.assertTrue(created)
        self.assertEqual(item["paperId"], "p-cache")
        self.assertEqual(item["date"], "2026-09-18")
        self.assertFalse(item["read"])

    def test_prefers_followed_author_over_impression(self):
        item, created = inbox_push.generate_daily_item(
            self.root,
            "LLM jailbreak",
            authors=[{"name": "Bob", "tags": ["TEE"]}],
            now=self.now,
        )
        self.assertTrue(created)
        self.assertEqual(item["paperId"], "p-cache")
        self.assertEqual(item["followedAuthor"], "Bob")
        self.assertIn("Bob", item["reason"])

    def test_matches_followed_author_with_affiliation(self):
        item, created = inbox_push.generate_daily_item(
            self.root,
            "LLM jailbreak",
            authors=[{"name": "Alina Oprea"}],
            now=self.now,
        )
        self.assertTrue(created)
        self.assertEqual(item["paperId"], "p-tee")
        self.assertEqual(item["followedAuthor"], "Alina Oprea")

    def test_falls_back_when_followed_author_has_no_paper(self):
        item, created = inbox_push.generate_daily_item(
            self.root,
            "LLM jailbreak",
            authors=[{"name": "Nobody", "tags": ["TEE"]}],
            now=self.now,
        )
        self.assertTrue(created)
        self.assertEqual(item["paperId"], "p-jailbreak")
        self.assertNotIn("followedAuthor", item)

    def test_skips_already_pushed_followed_author_paper(self):
        yesterday = (self.now.date() - timedelta(days=1)).isoformat()
        inbox = [{
            "id": "old",
            "date": yesterday,
            "kind": "daily-paper",
            "paperId": "p-cache",
            "url": "https://example.com/cache",
        }]
        item, created = inbox_push.generate_daily_item(
            self.root,
            "LLM jailbreak",
            authors=[{"name": "Bob"}],
            inbox=inbox,
            now=self.now,
        )
        self.assertTrue(created)
        self.assertEqual(item["paperId"], "p-jailbreak")

    def test_llm_can_pick_candidate(self):
        def fake_complete(_system, user_prompt):
            self.assertIn("TwinBreak", user_prompt)
            self.assertIn("\u7814\u7a76\u8005\u5370\u8c61", user_prompt)
            return json.dumps({
                "id": "p-jailbreak",
                "title_zh": "\u8d8a\u72f1\u653b\u9632",
                "summary": "\u5206\u6790\u8d8a\u72f1\u63d0\u793a\u3002",
                "reason": "\u4e0e\u5370\u8c61\u4e2d\u7684\u8d8a\u72f1\u65b9\u5411\u91cd\u5408\u3002",
            })

        item, created = inbox_push.generate_daily_item(
            self.root,
            "LLM jailbreak",
            complete=fake_complete,
            has_api_key=True,
            now=self.now,
        )
        self.assertTrue(created)
        self.assertEqual(item["paperId"], "p-jailbreak")
        self.assertEqual(item["title_zh"], "\u8d8a\u72f1\u653b\u9632")
        self.assertIn("\u8d8a\u72f1", item["reason"])

    def test_llm_prompt_prefers_followed_authors(self):
        seen = {}

        def fake_complete(system_prompt, user_prompt):
            seen["system"] = system_prompt
            seen["user"] = user_prompt
            return json.dumps({
                "id": "p-cache",
                "title_zh": "\u7f13\u5b58\u4fa7\u4fe1\u9053",
                "summary": "\u9488\u5bf9 TEE \u7684\u7f13\u5b58\u653b\u51fb\u3002",
                "reason": "\u5173\u6ce8\u4f5c\u8005 Bob \u7684\u4fa7\u4fe1\u9053\u5de5\u4f5c\u3002",
            })

        item, created = inbox_push.generate_daily_item(
            self.root,
            "LLM jailbreak",
            authors=[{"name": "Bob"}],
            complete=fake_complete,
            has_api_key=True,
            now=self.now,
        )
        self.assertTrue(created)
        self.assertEqual(item["paperId"], "p-cache")
        self.assertIn("followed researcher", seen["system"])
        self.assertIn("Bob", seen["user"])
        self.assertIn("\u5173\u6ce8\u4f5c\u8005", seen["user"])
        self.assertNotIn("TwinBreak", seen["user"])


if __name__ == "__main__":
    unittest.main()
