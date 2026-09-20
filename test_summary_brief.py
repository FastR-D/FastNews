from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import field_briefing
import summary_brief


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


class SummaryBriefTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        conference = self.root / "top-conf" / "data" / "conferences"
        summary = self.root / "top-conf" / "data" / "summary"
        articles = self.root / "secnews" / "data" / "articles"
        conference.mkdir(parents=True)
        summary.mkdir(parents=True)
        articles.mkdir(parents=True)
        write_jsonl(conference / "ndss_2026.jsonl", [
            {"_id": "p-jailbreak", "title": "TwinBreak: Jailbreak Attack and Defense", "link": "https://example.com/jailbreak", "author": "Alice", "description": "A causal analysis of LLM jailbreak prompts."},
            {"_id": "p-sok", "title": "SoK: Jailbreak Attacks and Defenses", "link": "https://example.com/sok-jailbreak", "author": "Carol", "description": "A systematization of knowledge on LLM jailbreaks."},
            {"_id": "p-cache", "title": "Cache Side Channel Attacks", "link": "https://example.com/cache", "author": "Bob", "description": "Microarchitectural cache attacks against TEEs."},
        ])
        write_jsonl(summary / "ndss_2026_summary.jsonl", [
            {"category": "ML/AI Security", "paper": {"_id": "p-jailbreak", "title": "TwinBreak: Jailbreak Attack and Defense", "link": "https://example.com/jailbreak", "author": "Alice", "summary_zh": "\u4ece\u56e0\u679c\u89c6\u89d2\u5206\u6790\u5927\u6a21\u578b\u8d8a\u72f1\u63d0\u793a\u3002"}},
            {"category": "ML/AI Security", "paper": {"_id": "p-sok", "title": "SoK: Jailbreak Attacks and Defenses", "link": "https://example.com/sok-jailbreak", "author": "Carol", "summary_zh": "\u7cfb\u7edf\u6574\u7406\u5927\u6a21\u578b\u8d8a\u72f1\u653b\u9632\u6587\u732e\u3002"}},
            {"category": "Hardware Security", "paper": {"_id": "p-cache", "title": "Cache Side Channel Attacks", "link": "https://example.com/cache", "author": "Bob", "summary_zh": "\u9488\u5bf9 TEE \u7684\u7f13\u5b58\u4fa7\u4fe1\u9053\u653b\u51fb\u3002"}},
        ])
        write_jsonl(conference / "ccs_2025.jsonl", [
            {"_id": "p-xss", "title": "Browser XSS Isolation", "link": "https://example.com/xss", "author": "Dee", "description": "XSS defenses in modern browsers."},
        ])
        write_jsonl(summary / "ccs_2025_summary.jsonl", [
            {"category": "Web Security", "paper": {"_id": "p-xss", "title": "Browser XSS Isolation", "link": "https://example.com/xss", "author": "Dee", "summary_zh": "\u73b0\u4ee3\u6d4f\u89c8\u5668\u4e2d\u7684 XSS \u9694\u79bb\u3002"}},
        ])
        write_jsonl(conference / "usenix_2024.jsonl", [
            {"_id": "p-dp", "title": "Practical Differential Privacy", "link": "https://example.com/dp", "author": "Eve", "description": "Deploying differential privacy."},
        ])
        write_jsonl(summary / "usenix_2024_summary.jsonl", [
            {"category": "Privacy & Anonymity", "paper": {"_id": "p-dp", "title": "Practical Differential Privacy", "link": "https://example.com/dp", "author": "Eve", "summary_zh": "\u5dee\u5206\u9690\u79c1\u7684\u5de5\u7a0b\u5b9e\u8df5\u3002"}},
        ])
        write_jsonl(articles / (date.today().isoformat() + ".jsonl"), [
            {"_id": "arxiv-tee", "title": "Attacking TEEs with Cache Side Channels", "link": "https://arxiv.org/abs/2601.00001", "author": "Bob", "source": "https://rss.arxiv.org/atom/cs.cr", "description": "Side-channel leakage from trusted execution environments.", "categories": ["cs.CR"]},
        ])
        field_briefing.clear_corpus_cache()

    def tearDown(self):
        field_briefing.clear_corpus_cache()
        self.tmp.cleanup()


    def test_compute_stats_counts_and_percentages(self):
        items = [
            {"venue": "NDSS", "category": "ML/AI Security", "source": "top-conf", "year": 2026},
            {"venue": "NDSS", "category": "Hardware Security", "source": "top-conf", "year": 2026},
            {"venue": "IEEE S&P", "category": "ML/AI Security", "source": "top-conf", "year": 2025},
            {"venue": "arXiv cs.CR", "category": "cs.CR", "source": "arxiv", "year": 2026},
        ]
        stats = summary_brief.compute_stats(items)
        self.assertEqual(stats["sample_size"], 4)
        self.assertEqual(stats["year_span"], "2025/2026")
        by_conf = {row["label"]: row for row in stats["by_conference"]}
        self.assertEqual(by_conf["NDSS"]["count"], 2)
        self.assertEqual(by_conf["NDSS"]["pct"], 50.0)
        self.assertEqual(by_conf["NDSS"]["years"]["2026"], 2)
        self.assertEqual(by_conf["IEEE S&P"]["count"], 1)
        self.assertEqual(by_conf["IEEE S&P"]["pct"], 25.0)
        cats = {row["label"]: row for row in stats["by_category"]}
        self.assertEqual(cats["ML/AI Security"]["count"], 2)
        self.assertEqual(cats["ML/AI Security"]["pct"], 50.0)
        years = {row["label"]: row for row in stats["by_year"]}
        self.assertEqual(years["2026"]["count"], 3)
        self.assertEqual(years["2026"]["pct"], 75.0)
        sources = {row["label"]: row for row in stats["by_source"]}
        self.assertEqual(sources["top-conf"]["count"], 3)
        self.assertEqual(sources["arxiv"]["count"], 1)

    def test_is_landscape_query(self):
        self.assertTrue(summary_brief.is_landscape_query(""))
        self.assertTrue(summary_brief.is_landscape_query("\u56db\u5927\u9876\u4f1a\u5168\u666f"))
        self.assertTrue(summary_brief.is_landscape_query("landscape"))
        self.assertTrue(summary_brief.is_landscape_query("overview"))
        self.assertFalse(summary_brief.is_landscape_query("LLM jailbreak"))
        self.assertFalse(summary_brief.is_landscape_query("\u4fa7\u4fe1\u9053"))

    def test_landscape_uses_full_top_conf_and_excludes_arxiv_when_source_all(self):
        status, payload = summary_brief.run_summary_brief(
            {"query": "", "source": "all"},
            self.root,
            complete=lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("no llm")),
            has_api_key=False,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["mode"], "landscape")
        self.assertEqual(payload["query"], "\u56db\u5927\u9876\u4f1a\u5168\u666f")
        self.assertEqual(payload["stats"]["sample_size"], 5)
        ids = {paper["id"] for paper in payload["papers"]}
        self.assertIn("p-jailbreak", ids)
        self.assertIn("p-xss", ids)
        self.assertIn("p-dp", ids)
        self.assertNotIn("arxiv-tee", ids)
        self.assertNotIn("arxiv", {row["label"] for row in payload["stats"]["by_source"]})
        self.assertIsNotNone(payload["brief"])
        self.assertEqual(payload["source"], "lexical")

    def test_topic_mode_ranks_query_and_can_include_arxiv(self):
        status, payload = summary_brief.run_summary_brief(
            {"query": "LLM jailbreak", "source": "top-conf"},
            self.root,
            complete=lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("no llm")),
            has_api_key=False,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["mode"], "topic")
        self.assertEqual(payload["papers"][0]["id"], "p-jailbreak")
        self.assertIsNotNone(payload["brief"])

        status, payload = summary_brief.run_summary_brief(
            {"query": "TEE", "source": "all"},
            self.root,
            complete=lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("no llm")),
            has_api_key=False,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["mode"], "topic")
        ids = [paper["id"] for paper in payload["papers"]]
        self.assertIn("arxiv-tee", ids)
        self.assertIn("p-cache", ids)

    def test_pick_evidence_round_robins_categories_in_landscape(self):
        items = [
            {"id": "ml-1", "category": "ML/AI Security", "year": 2026, "title": "B"},
            {"id": "ml-2", "category": "ML/AI Security", "year": 2025, "title": "A"},
            {"id": "web-1", "category": "Web Security", "year": 2026, "title": "W"},
            {"id": "hw-1", "category": "Hardware Security", "year": 2026, "title": "H1"},
            {"id": "hw-2", "category": "Hardware Security", "year": 2024, "title": "H2"},
            {"id": "priv-1", "category": "Privacy & Anonymity", "year": 2025, "title": "P"},
        ]
        picked = summary_brief.pick_evidence(items, "landscape")
        self.assertEqual(
            [paper["id"] for paper in picked],
            ["web-1", "hw-1", "priv-1", "ml-1", "hw-2", "ml-2"],
        )
        self.assertEqual(
            [paper["id"] for paper in summary_brief.pick_evidence(items, "topic")],
            [item["id"] for item in items[: summary_brief.EVIDENCE_LIMIT]],
        )

    def test_llm_highlights_filter_unknown_ids(self):
        def fake_complete(_system, user_prompt):
            self.assertIn("TwinBreak", user_prompt)
            return json.dumps({
                "kicker": "FastNews \xb7 \u9876\u4f1a\u5b9e\u8bc1\u7b80\u62a5",
                "title": "\u8d8a\u72f1\u6837\u672c\u96c6\u4e2d\u5728\u673a\u5668\u5b66\u4e60\u5b89\u5168",
                "hook": "\u7ed3\u6784\u5148\u4e8e\u70ed\u70b9",
                "subtitle": "NDSS 2026",
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

        status, payload = summary_brief.run_summary_brief(
            {"query": "LLM jailbreak", "source": "top-conf"},
            self.root,
            fake_complete,
            has_api_key=True,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["source"], "llm")
        self.assertEqual(payload["brief"]["title"], "\u8d8a\u72f1\u6837\u672c\u96c6\u4e2d\u5728\u673a\u5668\u5b66\u4e60\u5b89\u5168")
        ids = [paper["id"] for paper in payload["papers"]]
        self.assertIn("p-jailbreak", ids)
        self.assertNotIn("unknown", ids)
        self.assertEqual(payload["papers"][0]["reason"], "\u76f4\u63a5\u7814\u7a76\u8d8a\u72f1\u653b\u9632\u3002")

    def test_invalid_llm_json_falls_back_with_brief(self):
        buf = StringIO()
        with patch.object(field_briefing.sys, "stderr", buf):
            status, payload = summary_brief.run_summary_brief(
                {"query": "LLM jailbreak", "source": "top-conf"},
                self.root,
                lambda _system, _user: "{not json",
                has_api_key=True,
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["source"], "lexical")
        self.assertIsNotNone(payload["brief"])
        self.assertTrue(payload["brief"]["title"])
        self.assertGreaterEqual(len(payload["brief"]["findings"]), 1)
        self.assertGreaterEqual(len(payload["papers"]), 1)
        self.assertIn("summary-brief fallback", buf.getvalue())

    def test_run_summary_brief_uses_impression_as_query(self):
        captured = {}

        def fake_complete(_system, user_prompt):
            captured["user"] = user_prompt
            return json.dumps({
                "title": "\u5370\u8c61\u9a71\u52a8\u7684\u8d8a\u72f1\u7b80\u62a5",
                "hook": "\u6570\u5b57\u5148\u4e8e\u5370\u8c61",
                "lead": "\u7ed3\u5408\u7814\u7a76\u8005\u5370\u8c61\u6838\u5bf9\u6837\u672c\u3002",
                "findings": [{"title": "\u547d\u4e2d\u8d8a\u72f1", "body": "\u6837\u672c\u547d\u4e2d TwinBreak\u3002"}],
                "method": "\u7ed3\u5408\u5370\u8c61\u68c0\u7d22\u3002",
                "questions": [{"qid": "Q1", "question": "\u662f\u5426\u547d\u4e2d\uff1f", "answer": "\u547d\u4e2d p-jailbreak\u3002"}],
                "highlights": [{"id": "p-jailbreak", "blurb": "\u4e0e\u5370\u8c61\u91cd\u5408\u3002"}],
                "limitations": "\u5370\u8c61\u4e0d\u80fd\u66ff\u4ee3\u7edf\u8ba1\u3002",
                "discussion": [{"title": "\u5bf9\u7167\u5370\u8c61", "body": "\u7528\u8868\u683c\u6838\u5bf9\u4e3b\u89c2\u5370\u8c61\u3002"}],
            }, ensure_ascii=False)

        status, payload = summary_brief.run_summary_brief(
            {"impression": "LLM jailbreak causal analysis\nTEE side channels", "source": "top-conf"},
            self.root,
            fake_complete,
            has_api_key=True,
        )
        self.assertEqual(status, 200)
        self.assertTrue(payload["query"].startswith("LLM jailbreak"))
        self.assertEqual(payload["mode"], "topic")
        self.assertIn("\u7814\u7a76\u8005\u5370\u8c61", captured["user"])
        self.assertIn("causal analysis", captured["user"])
        self.assertEqual(payload["papers"][0]["id"], "p-jailbreak")

    def test_system_prompt_asks_for_empirical_brief(self):
        self.assertIn("\u5b9e\u8bc1\u7b80\u62a5", summary_brief.SYSTEM_PROMPT)
        self.assertIn("STATS", summary_brief.SYSTEM_PROMPT)
        system, user = summary_brief.build_prompts(
            "\u56db\u5927\u9876\u4f1a\u5168\u666f",
            {"sample_size": 5, "by_category": []},
            [],
            "",
            "coverage",
            "landscape",
        )
        self.assertIn("\u5b9e\u8bc1\u7b80\u62a5", system)
        self.assertIn("STATS", user)
        self.assertIn("\u56db\u5927\u9876\u4f1a\u5168\u666f", user)

    def test_empty_corpus_returns_null_brief(self):
        empty = tempfile.TemporaryDirectory()
        try:
            root = Path(empty.name)
            status, payload = summary_brief.run_summary_brief(
                {"query": "\u56db\u5927\u9876\u4f1a\u5168\u666f"},
                root,
                lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("no llm")),
                has_api_key=True,
            )
            self.assertEqual(status, 200)
            self.assertIsNone(payload["brief"])
            self.assertEqual(payload["papers"], [])
            self.assertEqual(payload["stats"]["sample_size"], 0)
        finally:
            empty.cleanup()


if __name__ == "__main__":
    unittest.main()
