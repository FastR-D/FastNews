from __future__ import annotations

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


if __name__ == "__main__":
    unittest.main()
