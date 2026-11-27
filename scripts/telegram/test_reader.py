from datetime import datetime, timezone
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from reader import message_row, save_snapshot, sources


class ReaderTest(unittest.TestCase):
    def test_allowlist_rejects_paths_urls_and_unknown_fields(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / "sources.json"
            for value in [
                [{"id": "../escape", "peer": "channel"}],
                [{"id": "valid", "peer": "https://t.me/channel"}],
                [{"id": "valid", "peer": "channel", "enable": True}],
                [{"id": "valid", "peer": "channel", "enabled": "false"}],
            ]:
                path.write_text(json.dumps(value))
                with self.assertRaises(ValueError):
                    sources(path)
            path.write_text('[{"id":"valid","peer":"channel","enabled":false}]')
            self.assertEqual(sources(path), [])

    def test_provenance_private_snapshot_and_no_fake_bot_link(self):
        source = {"id": "sample", "peer": "channel"}
        message = SimpleNamespace(id=17, raw_text="summary", date=datetime.now(timezone.utc),
                                  edit_date=None, entities=[SimpleNamespace(url="https://example.org/original")])
        row = message_row(source, message, True)
        self.assertEqual(row["link"], "https://t.me/channel/17")
        self.assertFalse(row["ai_processing"])
        self.assertIsNone(message_row(source, message, False)["link"])
        with TemporaryDirectory() as folder:
            path = Path(folder) / "sample.json"
            save_snapshot(path, [row], True)
            self.assertTrue(json.loads(path.read_text())["truncated"])
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            save_snapshot(path, [], False)
            self.assertEqual(json.loads(path.read_text())["messages"], [])


if __name__ == "__main__":
    unittest.main()
