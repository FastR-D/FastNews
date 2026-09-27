from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import generate_homepage


class CollectReportsTests(unittest.TestCase):
    def test_pairs_pdf_and_sorts_conference_reports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            conf = root / "conf"
            conf.mkdir()
            (conf / "CCS_2024_Report.html").write_text("<html>ccs24</html>", encoding="utf-8")
            (conf / "USENIX_2026_Report.html").write_text("<html>usenix26</html>", encoding="utf-8")
            (conf / "USENIX_2026_Report.pdf").write_bytes(b"%PDF-1.4")
            (conf / "IEEE-SP_2026_Report.html").write_text("<html>sp26</html>", encoding="utf-8")
            reports = generate_homepage.collect_reports(
                "Top Conference",
                relative_to=root,
                dirs=((str(conf), "Top Conference"),),
            )
            self.assertEqual(
                [item["title"] for item in reports],
                ["USENIX Security 2026", "IEEE S&P 2026", "ACM CCS 2024"],
            )
            usenix = reports[0]
            self.assertEqual(usenix["download_name"], "USENIX_2026_Report.html")
            self.assertTrue(usenix["pdf_path"].endswith("USENIX_2026_Report.pdf"))
            self.assertEqual(usenix["pdf_download_name"], "USENIX_2026_Report.pdf")
            self.assertEqual(reports[1]["pdf_path"], "")
            self.assertEqual(generate_homepage.report_title(conf / "NDSS_2025_Report.html"), "NDSS 2025")

    def test_collect_conference_papers_overlays_metrics(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            conference = root / "top-conf" / "data" / "conferences"
            summary = root / "top-conf" / "data" / "summary"
            conference.mkdir(parents=True)
            summary.mkdir(parents=True)
            (conference / "ndss_2026.jsonl").write_text(
                json.dumps({
                    "_id": "p-jailbreak",
                    "title": "TwinBreak: Jailbreak Attack and Defense",
                    "link": "https://example.com/jailbreak",
                    "author": "Alice",
                    "description": "A causal analysis of LLM jailbreak prompts.",
                    "cited_by": 12,
                }, ensure_ascii=False) + "\n"
                + json.dumps({
                    "_id": "p-plain",
                    "title": "Plain Paper",
                    "link": "https://example.com/plain",
                    "author": "Bob",
                    "description": "No metrics.",
                }, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            (summary / "ndss_2026_summary.jsonl").write_text(
                json.dumps({
                    "category": "ML/AI Security",
                    "paper": {
                        "_id": "p-jailbreak",
                        "title": "TwinBreak: Jailbreak Attack and Defense",
                        "link": "https://example.com/jailbreak",
                        "author": "Alice",
                        "summary_zh": "summary",
                    },
                }, ensure_ascii=False) + "\n"
                + json.dumps({
                    "category": "Web Security",
                    "paper": {
                        "_id": "p-plain",
                        "title": "Plain Paper",
                        "link": "https://example.com/plain",
                        "author": "Bob",
                        "summary_zh": "plain",
                    },
                }, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            (root / "top-conf" / "data" / "awards.json").write_text(
                json.dumps({
                    "papers": [{
                        "conference": "ndss",
                        "year": 2026,
                        "title": "TwinBreak: Jailbreak Attack and Defense",
                        "award": "Distinguished Paper",
                    }]
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            papers = {item["id"]: item for item in generate_homepage.collect_conference_papers(root=root)}
            self.assertEqual(papers["p-jailbreak"]["award"], "Distinguished Paper")
            self.assertEqual(papers["p-jailbreak"]["cited_by"], 12)
            self.assertNotIn("award", papers["p-plain"])
            self.assertNotIn("cited_by", papers["p-plain"])



if __name__ == "__main__":
    unittest.main()
