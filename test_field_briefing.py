from __future__ import annotations

import json
import tempfile
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import field_briefing


class FieldBriefingSearchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        conference = self.root / "top-conf" / "data" / "conferences"
        summary = self.root / "top-conf" / "data" / "summary"
        articles = self.root / "secnews" / "data" / "articles"
        conference.mkdir(parents=True)
        summary.mkdir(parents=True)
        articles.mkdir(parents=True)
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
                    "category": "ML/AI Security",
                    "paper": {
                        "_id": "p-sok",
                        "title": "SoK: Jailbreak Attacks and Defenses",
                        "link": "https://example.com/sok-jailbreak",
                        "author": "Carol",
                        "summary_zh": "系统整理大模型越狱攻防文献。",
                    },
                }, ensure_ascii=False),
            ]) + "\n",
            encoding="utf-8",
        )
        (articles / "2026-09-01.jsonl").write_text(
            json.dumps({
                "_id": "arxiv-tee",
                "title": "Attacking TEEs with Cache Side Channels",
                "link": "https://arxiv.org/abs/2601.00001",
                "author": "Bob",
                "source": "https://rss.arxiv.org/atom/cs.cr",
                "description": "Side-channel leakage from trusted execution environments.",
                "categories": ["cs.CR"],
            }, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        field_briefing.clear_corpus_cache()

    def tearDown(self):
        field_briefing.clear_corpus_cache()
        self.tmp.cleanup()

    def test_search_ranks_jailbreak_first(self):
        payload = field_briefing.search(self.root, "LLM jailbreak", source="top-conf", limit=5)
        self.assertGreaterEqual(payload["hit_count"], 1)
        self.assertEqual(payload["items"][0]["id"], "p-jailbreak")
        self.assertIn("ML/AI Security", payload["categories"])

    def test_coverage_note_uses_available_summaries(self):
        note = field_briefing.coverage_note({"arxiv_days": 90}, self.root)
        self.assertIn("NDSS 2026", note)
        self.assertNotIn("CCS 与更早顶会可能缺失", note)
        self.assertIn("近 90 天 arXiv", note)

    def test_format_year_span_compacts_ranges(self):
        self.assertEqual(field_briefing.format_year_span([2026]), "2026")
        self.assertEqual(field_briefing.format_year_span([2025, 2026]), "2025/2026")
        self.assertEqual(field_briefing.format_year_span([2023, 2024, 2025, 2026]), "2023–2026")
        self.assertEqual(field_briefing.format_year_span([2023, 2025, 2026]), "2023、2025/2026")

    def test_search_can_restrict_to_arxiv(self):
        payload = field_briefing.search(self.root, "TEE", source="arxiv", arxiv_days=0, limit=5)
        self.assertEqual([item["id"] for item in payload["items"]], ["arxiv-tee"])
        self.assertEqual(payload["items"][0]["source"], "arxiv")

    def test_is_survey_paper_detects_sok_and_skips_user_surveys(self):
        self.assertTrue(field_briefing.is_survey_paper({"title": "SoK: Jailbreak Attacks"}))
        self.assertTrue(field_briefing.is_survey_paper({"title": "A Survey of Prompt Injection"}))
        self.assertTrue(field_briefing.is_survey_paper({"title_zh": "大模型越狱综述"}))
        self.assertFalse(field_briefing.is_survey_paper({"title": "Telephone Survey of Security Users"}))
        self.assertFalse(field_briefing.is_survey_paper({"title": "TwinBreak: Jailbreak Attack and Defense"}))

    def test_search_surveys_ranks_jailbreak_sok_first(self):
        items = field_briefing.search_surveys(self.root, "LLM jailbreak", source="top-conf")
        self.assertGreaterEqual(len(items), 1)
        self.assertEqual(items[0]["id"], "p-sok")
        self.assertEqual(items[0]["link"], "https://example.com/sok-jailbreak")
        self.assertIn("SoK", items[0]["reason"])

    def test_run_field_briefing_filters_paper_ids(self):
        def fake_complete(_system, user_prompt):
            self.assertIn("TwinBreak", user_prompt)
            return json.dumps({
                "field_zh": "大模型越狱",
                "field_en": "LLM Jailbreak",
                "coverage": "thin",
                "scope": "近五年大模型越狱攻防。",
                "categories": [{
                    "name": "攻击方法",
                    "consensus": "主流认为越狱可通过精心构造提示绕过对齐，TwinBreak 等因果分析支持这一判断。",
                    "developments": "后续工作在黑盒提示与自适应攻击上分化，侧重点从单次绕过转向攻防对抗。",
                }],
                "gaps": "对自适应防御的评估仍不充分。",
                "surveys": [{"title": "Survey", "venue": "IEEE", "year": "2024", "link": "https://example.com/s", "reason": "survey"}],
                "papers": [{"id": "p-jailbreak", "reason": "direct overlap"}, {"id": "missing", "reason": "drop"}],
            })

        status, payload = field_briefing.run_field_briefing(
            {"query": "LLM jailbreak", "source": "top-conf"},
            self.root,
            fake_complete,
            has_api_key=True,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["source"], "llm")
        self.assertEqual(payload["briefing"]["field_zh"], "大模型越狱")
        self.assertEqual(payload["briefing"]["categories"][0]["name"], "攻击方法")
        self.assertIn("TwinBreak", payload["briefing"]["categories"][0]["consensus"])
        self.assertEqual(payload["briefing"]["gaps"], "对自适应防御的评估仍不充分。")
        self.assertEqual([item["id"] for item in payload["papers"] if item["id"] == "p-jailbreak"], ["p-jailbreak"])
        self.assertNotIn("missing", [item["id"] for item in payload["papers"]])
        self.assertEqual(payload["surveys"][0]["link"], "https://example.com/s")

    def test_run_field_briefing_backfills_surveys_when_llm_omits_them(self):
        def fake_complete(_system, user_prompt):
            self.assertIn("候选奠基/综述", user_prompt)
            self.assertIn("SoK: Jailbreak Attacks and Defenses", user_prompt)
            return json.dumps({
                "field_zh": "大模型越狱",
                "field_en": "LLM Jailbreak",
                "coverage": "thin",
                "scope": "近五年大模型越狱攻防。",
                "categories": [{
                    "name": "攻击方法",
                    "consensus": "主流认为越狱可通过精心构造提示绕过对齐。",
                    "developments": "后续工作在黑盒提示与自适应攻击上分化。",
                }],
                "gaps": "对自适应防御的评估仍不充分。",
                "surveys": [],
                "papers": [
                    {"id": "p-sok", "reason": "should drop"},
                    {"id": "p-jailbreak", "reason": "direct overlap"},
                ],
            })

        status, payload = field_briefing.run_field_briefing(
            {"query": "LLM jailbreak", "source": "top-conf"},
            self.root,
            fake_complete,
            has_api_key=True,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["source"], "llm")
        self.assertEqual(payload["surveys"][0]["id"], "p-sok")
        self.assertEqual(payload["surveys"][0]["link"], "https://example.com/sok-jailbreak")
        self.assertNotIn("p-sok", [item["id"] for item in payload["papers"]])
        self.assertEqual(payload["papers"][0]["id"], "p-jailbreak")

    def test_run_field_briefing_lexical_path_includes_surveys(self):
        def blocked_complete(*_args, **_kwargs):
            raise AssertionError("llm should not run")

        status, payload = field_briefing.run_field_briefing(
            {"query": "LLM jailbreak", "source": "top-conf"},
            self.root,
            blocked_complete,
            has_api_key=False,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["source"], "lexical")
        self.assertEqual(payload["surveys"][0]["id"], "p-sok")
        self.assertNotIn("p-sok", [item["id"] for item in payload["papers"]])
        self.assertGreaterEqual(len(payload["papers"]), 1)

    def test_parse_model_object_strips_think_tags(self):
        data = field_briefing.parse_model_object("<think>plan</think>{\"field_zh\":\"jailbreak\"}")
        self.assertEqual(data["field_zh"], "jailbreak")

    def test_invalid_llm_json_falls_back_and_logs(self):
        def fake_complete(_system, _user):
            return "{not json"

        buf = StringIO()
        with patch.object(field_briefing.sys, "stderr", buf):
            status, payload = field_briefing.run_field_briefing(
                {"query": "LLM jailbreak", "source": "top-conf"},
                self.root,
                fake_complete,
                has_api_key=True,
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["source"], "lexical")
        self.assertGreaterEqual(len(payload["papers"]), 1)
        self.assertEqual(payload["surveys"][0]["id"], "p-sok")
        logged = buf.getvalue()
        self.assertIn("field-briefing fallback", logged)
        self.assertIn("JSONDecodeError", logged)

    def test_run_field_briefing_uses_impression_as_query(self):
        captured = {}

        def fake_complete(_system, user_prompt):
            captured["user"] = user_prompt
            return json.dumps({
                "field_zh": "大模型越狱",
                "field_en": "LLM Jailbreak",
                "coverage": "thin",
                "scope": "近五年大模型越狱。",
                "categories": [{"name": "攻击方法", "consensus": "提示构造是主流越狱路径。", "developments": "因果分析与黑盒攻击侧重点不同。"}],
                "gaps": "自适应攻击评估不足。",
                "surveys": [],
                "papers": [{"id": "p-jailbreak", "reason": "matches impression"}],
            })

        status, payload = field_briefing.run_field_briefing(
            {"impression": "LLM jailbreak causal analysis\nTEE side channels", "source": "top-conf"},
            self.root,
            fake_complete,
            has_api_key=True,
        )
        self.assertEqual(status, 200)
        self.assertTrue(payload["query"].startswith("LLM jailbreak"))
        self.assertIn("研究者印象", captured["user"])
        self.assertIn("causal analysis", captured["user"])
        self.assertEqual(payload["papers"][0]["id"], "p-jailbreak")
        self.assertEqual(payload["surveys"][0]["id"], "p-sok")

    def test_parse_briefing_maps_legacy_subareas(self):
        parsed = field_briefing.parse_briefing(
            json.dumps({
                "field_zh": "越狱",
                "problem": "bypass",
                "subareas": [{"name": "attack", "summary": "jailbreak prompts"}],
                "open_problems": "adaptive attacks",
                "papers": [],
            }),
            "q",
            [],
        )
        self.assertEqual(parsed["briefing"]["scope"], "bypass")
        self.assertEqual(parsed["briefing"]["categories"][0]["name"], "attack")
        self.assertEqual(parsed["briefing"]["categories"][0]["consensus"], "jailbreak prompts")
        self.assertEqual(parsed["briefing"]["gaps"], "adaptive attacks")

    def test_system_prompt_asks_for_literature_review(self):
        self.assertIn("学术顾问", field_briefing.SYSTEM_PROMPT)
        self.assertIn("国内外研究现状", field_briefing.SYSTEM_PROMPT)
        self.assertIn("候选奠基/综述", field_briefing.SYSTEM_PROMPT)
        system, user = field_briefing.build_prompts(
            "TEE",
            [],
            surveys=[{
                "title": "SoK: TEE Attacks",
                "year": 2026,
                "venue": "IEEE S&P",
                "link": "https://example.com/sok-tee",
                "reason": "候选综述",
            }],
        )
        self.assertIn("近五年", user)
        self.assertIn("共识", user)
        self.assertIn("学者", user)
        self.assertIn("研究不足", user)
        self.assertIn("候选奠基/综述", user)
        self.assertIn("SoK: TEE Attacks", user)


if __name__ == "__main__":
    unittest.main()
