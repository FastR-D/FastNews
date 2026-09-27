from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "top-conf"))

import fetch_awards  # noqa: E402


SP_HTML = """
<html><body>
<h2>Distinguished Paper Awards</h2>
<p><b>COBBL: Combining Covert Channels</b><br>Alice, Bob</p>
<p><b>Transport Layer Obscurity</b></p>
<h2>Best Poster Award</h2>
<p><b>A Poster About Measuring Fuzzers</b></p>
<h2>Test of Time Award</h2>
<p><b>An Old Influential Security Paper Title</b></p>
</body></html>
"""

CCS_HTML = """
<html><body>
<h2>Distinguished Paper Awards</h2>
<ul>
  <li>Alert Alchemy: Tales of Security Alerts
      <em>Authors</em>: Alice</li>
  <li>Cross-silo Federated Learning with Record-level Personalized Differential Privacy (Paper 1093)
      <em>Authors</em>: Bob</li>
</ul>
<h2>Distinguished Artifact Awards</h2>
<ul>
  <li>Helium: Scalable MPC among Lightweight Participants</li>
</ul>
<h2>CCS 2024 Top Reviewers</h2>
<ul>
  <li>Some Reviewer Name</li>
</ul>
</body></html>
"""


class FetchAwardsParseTests(unittest.TestCase):
    def test_parse_sp_heading_and_bold_titles(self):
        papers = fetch_awards.parse_award_html(SP_HTML, "ieee-sp", 2025)
        titles = [item["title"] for item in papers]
        self.assertTrue(any("COBBL" in title for title in titles))
        self.assertTrue(any("Transport Layer Obscurity" in title for title in titles))
        blob = " ".join(titles).lower()
        self.assertNotIn("poster", blob)
        self.assertNotIn("old influential", blob)

    def test_best_title_match_prefers_colon_prefix_over_substring(self):
        titles = [
            "Rethinking Trust in Forge-Based Git Security",
            "ReThink: Reveal the Threat of Electromagnetic Interference on Power Inverters",
            "Provably Unlearnable Data Examples",
        ]
        self.assertTrue(fetch_awards.best_title_match("ReThink", titles).startswith("ReThink:"))
        self.assertTrue(
            fetch_awards.best_title_match(
                "Rethinking Trust in Forge-Based Git Security",
                titles,
            ).startswith("Rethinking Trust")
        )

    def test_parse_ccs_skips_artifact_and_reviewers(self):
        papers = fetch_awards.parse_award_html(CCS_HTML, "ccs", 2024)
        titles = [item["title"] for item in papers]
        self.assertTrue(any("Alert Alchemy" in title for title in titles))
        self.assertTrue(any("Cross-silo Federated Learning" in title for title in titles))
        self.assertFalse(any("Paper 1093" in title for title in titles))
        self.assertFalse(any("Helium" in title for title in titles))
        self.assertFalse(any("Reviewer" in title for title in titles))


if __name__ == "__main__":
    unittest.main()
