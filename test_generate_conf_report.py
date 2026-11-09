from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urljoin


ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "generate_conf_report", ROOT / "top-conf" / "generate_conf_report.py"
)
report_generator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(report_generator)


class NavigationParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_navigation = False
        self.links = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "nav" and attributes.get("aria-label") == "报告导航":
            self.in_navigation = True
        if tag == "a" and self.in_navigation:
            self.links.append({"href": attributes.get("href"), "text": ""})

    def handle_data(self, data):
        if self.in_navigation and self.links:
            self.links[-1]["text"] += data

    def handle_endtag(self, tag):
        if tag == "nav":
            self.in_navigation = False


class ConferenceReportNavigationTests(unittest.TestCase):
    def setUp(self):
        with tempfile.TemporaryDirectory() as temporary:
            with contextlib.chdir(temporary):
                source = Path("top-conf/data/conferences")
                summary = Path("top-conf/data/summary")
                source.mkdir(parents=True)
                summary.mkdir(parents=True)
                paper = {
                    "_id": "sample-paper",
                    "title": "Sample Paper",
                    "link": "https://example.invalid/paper",
                    "author": "Example Author",
                    "summary_zh": "测试摘要",
                }
                (source / "usenix_2026.jsonl").write_text(json.dumps(paper) + "\n", encoding="utf-8")
                (summary / "usenix_2026_summary.jsonl").write_text(
                    json.dumps({"category": "Systems", "paper": paper}) + "\n", encoding="utf-8"
                )
                with patch.object(report_generator, "refresh_homepage"), contextlib.redirect_stdout(io.StringIO()):
                    report_generator.render_conf_report("usenix", 2026)
                self.html = Path("top-conf/data/report/USENIX_2026_Report.html").read_text(encoding="utf-8")
        parser = NavigationParser()
        parser.feed(self.html)
        self.links = parser.links

    def test_generated_report_has_return_link(self):
        self.assertEqual(len(self.links), 1)
        self.assertEqual(self.links[0]["text"].strip(), "返回顶会列表")
        self.assertEqual(self.links[0]["href"], "../../index.html")
        self.assertIn('data-fastread', self.html)
        self.assertIn('href="#cat-1"', self.html)

    def test_return_link_preserves_deployment_prefix(self):
        self.assertEqual(len(self.links), 1)
        for base in ("https://example.invalid/", "https://example.invalid/news/", "https://example.invalid/tools/news/"):
            with self.subTest(base=base):
                report = base + "top-conf/data/report/USENIX_2026_Report.html?view=full#cat-1"
                self.assertEqual(urljoin(report, self.links[0]["href"]), base + "top-conf/index.html")

    def test_return_link_supports_local_site_directory(self):
        self.assertEqual(len(self.links), 1)
        report = "file:///tmp/FastNews/top-conf/data/report/USENIX_2026_Report.html"
        self.assertEqual(urljoin(report, self.links[0]["href"]), "file:///tmp/FastNews/top-conf/index.html")


if __name__ == "__main__":
    unittest.main()
