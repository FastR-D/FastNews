from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import paper_metrics


class PaperMetricsTests(unittest.TestCase):
    def test_normalize_title_strips_paper_number_and_case(self):
        self.assertEqual(
            paper_metrics.normalize_title("WESEE: Web Secret Exposure"),
            paper_metrics.normalize_title("WeSee: Web Secret Exposure"),
        )
        self.assertEqual(
            paper_metrics.normalize_title(
                "Cross-silo Federated Learning with Record-level Personalized Differential Privacy (Paper 1093)"
            ),
            paper_metrics.normalize_title(
                "Cross-silo Federated Learning with Record-level Personalized Differential Privacy"
            ),
        )
        self.assertEqual(paper_metrics.normalize_title("J\u00e4ger: Call Traceback"), "jager call traceback")

    def test_canonical_award_keeps_distinguished_and_best_paper(self):
        self.assertEqual(
            paper_metrics.canonical_award("Distinguished Paper Award Winner"),
            "Distinguished Paper",
        )
        self.assertEqual(paper_metrics.canonical_award("Best Paper Award"), "Distinguished Paper")
        self.assertEqual(
            paper_metrics.detect_award_text("USENIX Security Distinguished Paper Award Winner"),
            "Distinguished Paper",
        )

    def test_canonical_award_excludes_artifact_poster_and_test_of_time(self):
        self.assertEqual(paper_metrics.canonical_award("Distinguished Artifact Award"), "")
        self.assertEqual(paper_metrics.canonical_award("Best Poster Award"), "")
        self.assertEqual(paper_metrics.canonical_award("Test of Time Award"), "")
        self.assertEqual(paper_metrics.canonical_award("Honorable Mention"), "")
        self.assertEqual(paper_metrics.canonical_award("Top Reviewers"), "")
        self.assertEqual(paper_metrics.canonical_award("AI-Selected Best Poster"), "")

    def test_parse_cited_by_accepts_zero_and_rejects_noise(self):
        self.assertEqual(paper_metrics.parse_cited_by(0), 0)
        self.assertEqual(paper_metrics.parse_cited_by("128"), 128)
        self.assertEqual(paper_metrics.parse_cited_by("1,024"), 1024)
        self.assertIsNone(paper_metrics.parse_cited_by(None))
        self.assertIsNone(paper_metrics.parse_cited_by(True))
        self.assertIsNone(paper_metrics.parse_cited_by(-3))

    def test_load_award_index_uses_given_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            awards = root / "top-conf" / "data" / "awards.json"
            awards.parent.mkdir(parents=True)
            awards.write_text(
                json.dumps({
                    "papers": [
                        {
                            "conference": "ieee-sp",
                            "year": 2025,
                            "title": "DataSentinel: A Game-Theoretic Multi-Round Approach",
                            "award": "Distinguished Paper Award",
                        },
                        {
                            "conference": "ccs",
                            "year": 2024,
                            "title": "Some Artifact Paper",
                            "award": "Distinguished Artifact Award",
                        },
                    ]
                }),
                encoding="utf-8",
            )
            index = paper_metrics.load_award_index(root)
            key = paper_metrics.award_index_key(
                "IEEE-SP",
                "2025",
                "DataSentinel: A Game-Theoretic Multi-Round Approach",
            )
            self.assertEqual(index[key], "Distinguished Paper")
            self.assertEqual(len(index), 1)

    def test_public_metrics_omits_missing_fields(self):
        metrics = paper_metrics.public_metrics({"title": "Plain Paper"}, {})
        self.assertEqual(metrics, {})

    def test_public_metrics_keeps_zero_citations_and_overlay_award(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            awards_path = root / "top-conf" / "data" / "awards.json"
            awards_path.parent.mkdir(parents=True)
            awards_path.write_text(
                json.dumps({
                    "papers": [{
                        "conference": "ndss",
                        "year": 2025,
                        "title": "Blindfold: Keeping Private Keys in PKI and FIDO",
                        "award": "Distinguished Paper",
                    }]
                }),
                encoding="utf-8",
            )
            awards = paper_metrics.load_award_index(root)
            metrics = paper_metrics.public_metrics(
                {"cited_by": 0, "title": "Blindfold: Keeping Private Keys in PKI and FIDO"},
                awards,
                conference="ndss",
                year=2025,
            )
            self.assertEqual(metrics["award"], "Distinguished Paper")
            self.assertEqual(metrics["cited_by"], 0)


if __name__ == "__main__":
    unittest.main()
