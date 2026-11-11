"""Generate local runtime assets from the pinned, digest-verified public package.

Run before generating/deploying the site. --artifact accepts the identical release
tarball for offline builds; it never changes the version or digest commitment.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import tarfile
from urllib.request import urlopen

VERSION = "0.1.2"
SHA256 = "c3dabbad16980242f66db07619b161889d0ee2492daaa4aaddee1583bc7bcd0b"
URL = "https://registry.npmjs.org/@fastrd/ui-foundation/-/ui-foundation-0.1.2.tgz"
ROOT = Path(__file__).resolve().parents[1]


def supply(artifact=None):
    payload = Path(artifact).read_bytes() if artifact else urlopen(URL, timeout=60).read()
    if hashlib.sha256(payload).hexdigest() != SHA256:
        raise ValueError("FastUI foundation SHA-256 mismatch")
    destination = ROOT / "assets" / "fastui"
    destination.mkdir(parents=True, exist_ok=True)
    files = {}
    assets = {}
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        for name in ("tokens.css", "controls.css", "index.js", "color-mode.js"):
            member = archive.getmember(f"package/dist/{name}")
            if not member.isfile():
                raise ValueError(f"Not a regular package asset: {name}")
            content = archive.extractfile(member).read()
            assets[name] = content.decode("utf-8")
            (destination / name).write_bytes(content)
            files[name] = hashlib.sha256(content).hexdigest()
        for name in ("LICENSE", "NOTICE.md"):
            (destination / name).write_bytes(archive.extractfile(f"package/{name}").read())
    # The fixed artifact's ESM export list is removed only at build time. The
    # implementation bytes stay package-owned; the host adapter creates ONE
    # controller, shared by parser-blocking startup and the deferred controls.
    export_list = "export {\n  initColorMode,\n  syncDialog\n};\n"
    if not assets["index.js"].endswith(export_list):
        raise ValueError("Unexpected pinned foundation ESM export list")
    adapter_bytes = (ROOT / "scripts/theme-init.js").read_bytes()
    adapter = adapter_bytes.decode("utf-8").replace("\r\n", "\n")
    bootstrap = "// Generated from @fastrd/ui-foundation " + VERSION + "; do not edit.\n(() => {\n"
    bootstrap += assets["index.js"][:-len(export_list)] + "\n" + adapter + "\n})();\n"
    (destination / "theme-init.js").write_bytes(bootstrap.encode("utf-8"))
    (destination / "provenance.json").write_text(json.dumps({
        "package": "@fastrd/ui-foundation", "version": VERSION,
        "url": URL, "sha256": SHA256, "files": files,
        "generated_by": "python scripts/supply_fastui.py",
        "generated": {"theme-init.js": {
            "sha256": hashlib.sha256(bootstrap.encode()).hexdigest(),
            "foundation_source": "index.js", "adapter": "scripts/theme-init.js",
            "adapter_sha256": hashlib.sha256(adapter_bytes).hexdigest(),
        }},
    }, indent=2) + "\n", encoding="utf-8")
    # Private sites protect /assets too: login must be self-contained before auth.
    account = (ROOT / "prompt/account.html").read_text(encoding="utf-8")
    account = account.replace("__FASTUI_CSS__", assets["tokens.css"] + "\n" + assets["controls.css"])
    account = account.replace("__FASTUI_BOOTSTRAP__", bootstrap)
    (ROOT / "assets/account.html").write_text(account, encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact")
    supply(parser.parse_args().artifact)
