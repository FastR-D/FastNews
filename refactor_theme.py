"""
Refactors FastNews HTML pages:
1. Replaces green theme CSS variables with a blue theme
2. Removes the duplicate second CSS block (FastResearch Scientific Console Styling)
3. Adds a subtle blue grid texture to body
Updates assets/authors.css as well.
"""

import re
import os

HTML_FILES = [
    r"E:\project\FastRead\FastNews\index.html",
    r"E:\project\FastRead\FastNews\inbox\index.html",
    r"E:\project\FastRead\FastNews\top-conf\index.html",
    r"E:\project\FastRead\FastNews\secnews\index.html",
    r"E:\project\FastRead\FastNews\summary-brief\index.html",
    r"E:\project\FastRead\FastNews\field-briefing\index.html",
    r"E:\project\FastRead\FastNews\impression\index.html",
]

# --- Blue theme token replacements ---

OLD_ROOT = """\
  :root {
    --app-bg: #f0f5f2; --muted-bg: #eaf1ec; --surface: #ffffff; --soft: #f8faf8;
    --border: #d6e3db; --input-border: #cbd7d0; --primary: #155e45; --primary-deep: #104936;
    --primary-soft: #e8f3ed; --primary-border: #8fb9a0; --accent: #b45309; --accent-soft: #fffbeb;
    --accent-border: #fde68a; --accent-text: #92400e; --text: #172720; --muted: #567265;
    --subtle: #7f998d; --danger: #dc2626; --danger-soft: #fef2f2; --focus: rgba(21, 94, 69, 0.16);
  }"""

NEW_ROOT = """\
  :root {
    --app-bg: #f0f4ff; --muted-bg: #e8effe; --surface: #ffffff; --soft: #f5f7ff;
    --border: #d0d9f5; --input-border: #b8c6f0; --primary: #1d4ed8; --primary-deep: #1e40af;
    --primary-soft: #eff6ff; --primary-border: #93c5fd; --accent: #b45309; --accent-soft: #fffbeb;
    --accent-border: #fde68a; --accent-text: #92400e; --text: #0f172a; --muted: #475569;
    --subtle: #64748b; --danger: #dc2626; --danger-soft: #fef2f2; --focus: rgba(29, 78, 216, 0.16);
  }"""

OLD_DARK = """\
  html.dark {
    --app-bg: #151a19; --muted-bg: #18201d; --surface: #1b2220; --soft: #202925;
    --border: #2d3934; --input-border: #3c4b45; --primary: #2dd4bf; --primary-deep: #5eead4;
    --primary-soft: #042f2e; --primary-border: #315147; --accent: #fb923c; --accent-soft: #431407;
    --accent-border: #7c2d12; --accent-text: #fed7aa; --text: #f3f4f6; --muted: #a5b1ab;
    --subtle: #7f8c86; --danger: #f87171; --danger-soft: #431407; --focus: rgb(45 212 191 / .18);
  }"""

NEW_DARK = """\
  html.dark {
    --app-bg: #0f1623; --muted-bg: #131b2e; --surface: #1a2340; --soft: #1e2a48;
    --border: #2d3f6b; --input-border: #3d5080; --primary: #60a5fa; --primary-deep: #93c5fd;
    --primary-soft: rgba(59, 130, 246, 0.12); --primary-border: #1e40af; --accent: #fb923c; --accent-soft: #431407;
    --accent-border: #7c2d12; --accent-text: #fed7aa; --text: #f1f5f9; --muted: #94a3b8;
    --subtle: #64748b; --danger: #f87171; --danger-soft: #431407; --focus: rgba(96, 165, 250, 0.18);
  }"""

OLD_BODY = """\
  body {
    min-height: 100vh; margin: 0; background: var(--app-bg); color: var(--text);
    font: 14px/1.6 Inter, "Noto Sans SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }"""

NEW_BODY = """\
  body {
    min-height: 100vh; margin: 0; background: var(--app-bg); color: var(--text);
    font: 14px/1.6 Inter, "Noto Sans SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background-image: linear-gradient(to right, rgba(29, 78, 216, 0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(29, 78, 216, 0.03) 1px, transparent 1px);
    background-size: 32px 32px;
  }
  html.dark body {
    background-image: linear-gradient(to right, rgba(96, 165, 250, 0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(96, 165, 250, 0.05) 1px, transparent 1px);
  }"""

# --- Remove the duplicate second CSS block ---
# It starts with this comment and ends before </style>
SECOND_BLOCK_START = "  /* FastResearch Scientific Console Styling (统一浅绿科研质感) */"


def remove_second_css_block(content):
    idx = content.find(SECOND_BLOCK_START)
    if idx == -1:
        return content, False
    # Find the </style> after this point
    style_end = content.find("</style>", idx)
    if style_end == -1:
        return content, False
    # Remove from the start of the second block up to (but not including) </style>
    content = content[:idx] + content[style_end:]
    return content, True


def process_html(path):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    original = content
    changes = []

    if OLD_ROOT in content:
        content = content.replace(OLD_ROOT, NEW_ROOT, 1)
        changes.append(":root colors → blue")

    if OLD_DARK in content:
        content = content.replace(OLD_DARK, NEW_DARK, 1)
        changes.append("html.dark colors → blue")

    if OLD_BODY in content:
        content = content.replace(OLD_BODY, NEW_BODY, 1)
        changes.append("body + grid texture")

    content, removed = remove_second_css_block(content)
    if removed:
        changes.append("removed duplicate CSS block")

    if content != original:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"  ✓ {os.path.relpath(path)} — {', '.join(changes)}")
    else:
        print(f"  - {os.path.relpath(path)} — no changes needed")


# --- Update authors.css ---

AUTHORS_CSS = r"E:\project\FastRead\FastNews\assets\authors.css"

OLD_AUTHORS_VARS = """:root { --author-panel: #f8fcfb; --author-muted: #5c7779; --author-line: #b8cfcc; --author-chip: rgba(8,127,120,.08); --author-error: #b42318; }
html.dark { --author-panel: #12261d; --author-muted: #89a1a3; --author-line: #2d4b50; --author-chip: rgba(101,234,217,.08); --author-error: #ff8686; }"""

NEW_AUTHORS_VARS = """:root { --author-panel: #f5f7ff; --author-muted: #475569; --author-line: #b8c6f0; --author-chip: rgba(29,78,216,.08); --author-error: #b42318; }
html.dark { --author-panel: #1a2340; --author-muted: #94a3b8; --author-line: #2d3f6b; --author-chip: rgba(96,165,250,.10); --author-error: #ff8686; }"""


def process_authors_css():
    with open(AUTHORS_CSS, "r", encoding="utf-8") as f:
        content = f.read()

    if OLD_AUTHORS_VARS in content:
        content = content.replace(OLD_AUTHORS_VARS, NEW_AUTHORS_VARS, 1)
        with open(AUTHORS_CSS, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"  ✓ assets/authors.css — variables → blue")
    else:
        print(f"  - assets/authors.css — no changes needed")


if __name__ == "__main__":
    print("Processing HTML files...")
    for path in HTML_FILES:
        if os.path.exists(path):
            process_html(path)
        else:
            print(f"  ! MISSING: {path}")

    print("\nProcessing authors.css...")
    process_authors_css()

    print("\nDone.")
