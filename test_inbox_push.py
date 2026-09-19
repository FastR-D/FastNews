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
                        "summary_zh": "从因果视角分析大模型越狱提示。",
                    },
                }, ensure_ascii=False),
                json.dumps({
                    "category": "Hardware Security",
                    "paper": {
                        "_id": "p-cache",
                        "title": "Cache Side Channel Attacks",
                        "link": "https://example.com/cache",
                        "author": "Bob",
                        "summary_zh": "针对 TEE 的缓存侧信道。",
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
            [{"tags": ["侧信道"]}],
            ["fuzzing"],
        )
        self.assertIn("LLM jailbreak", query)

    def test_query_falls_back_to_author_tags(self):
        query = inbox_push.query_from_profile("", [{"tags": ["侧信道", "TEE"]}], ["fuzzing"])
        self.assertIn("侧信道", query)
        self.assertIn("TEE", query)
        self.assertIn("fuzzing", query)

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

    def test_llm_can_pick_candidate(self):
        def fake_complete(_system, user_prompt):
            self.assertIn("TwinBreak", user_prompt)
            self.assertIn("研究者印象", user_prompt)
            return json.dumps({
                "id": "p-jailbreak",
                "title_zh": "越狱攻防",
                "summary": "分析越狱提示。",
                "reason": "与印象中的越狱方向重合。",
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
        self.assertEqual(item["title_zh"], "越狱攻防")
        self.assertIn("越狱", item["reason"])


if __name__ == "__main__":
    unittest.main()
