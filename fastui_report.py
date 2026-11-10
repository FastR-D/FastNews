"""Publication styling is independent from application controls and color mode."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
START = '<!-- fastnews-publication:start -->'
END = '<!-- fastnews-publication:end -->'


def supply_archived_reports():
    """Keep archived body/layout, replace the former site-theme injection.

    The publication CSS is embedded so this change adds no external runtime
    dependency to downloaded archives. Existing FastRead links are preserved.
    """
    style = (ROOT / 'assets/report.css').read_text(encoding='utf-8')
    for directory in (Path('top-conf/data/report'), Path('secnews/data/report')):
        for path in sorted(directory.glob('*.html')):
            content = path.read_text(encoding='utf-8')
            if '</head>' not in content:
                continue
            content = re.sub(re.escape(START) + r'.*?' + re.escape(END) + r'\s*', '', content, flags=re.S)
            content = re.sub(r'<link\b[^>]*href="[^"]*(?:fastui/(?:tokens|controls)\.css|workbench\.css)"[^>]*>\s*', '', content)
            content = re.sub(r'<script\b[^>]*src="[^"]*fastui/color-mode\.js"[^>]*></script>\s*', '', content)
            # These inventoried archives have a plain <html lang=...> root.
            if not re.search(r'<html\b[^>]*class="[^"]*\bfastnews-report\b', content):
                content = re.sub(r'(<html\b[^>]*)(>)', r'\1 class="fastnews-report"\2', content, count=1)
            block = START + '\n<style>\n' + style + '\n</style>\n' + END + '\n'
            updated = content.replace('</head>', block + '</head>', 1)
            if updated != path.read_text(encoding='utf-8'):
                path.write_text(updated, encoding='utf-8')


def report_assets():
    # Report templates intentionally receive no foundation tokens or bootstrap:
    # print/PDF must not depend on JS or the reader's application preference.
    return {'report_css': (ROOT / 'assets/report.css').read_text(encoding='utf-8')}
