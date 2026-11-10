"""Real browser regression for saved-theme first paint and publication printing.

PYTHONPATH=. python tests/theme_print_browser.py <chromium> <output-directory>
Uses production HTML/templates/assets and FastNewsHandler; only the HTTP delivery
of the deferred application script is held. PDF checks run the real WeasyPrint.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer

from jinja2 import Template
from playwright.sync_api import sync_playwright

from fastnews_accounts import Accounts
from fastnews_cas import CASService
from fastui_report import report_assets
from serve import FastNewsHandler

ROOT = Path(__file__).resolve().parents[1]


def templates():
    assets = report_assets()
    return {
        'conference': Template((ROOT / 'top-conf/prompt/conf_report.html.j2').read_text(encoding='utf-8')).render(
            **assets, conference='UI publication fixture', year=2026, generated_date='fixture', total_papers=1,
            categorized_papers={'Security': [{'title': 'Publication fixture', 'author': 'Fixture Author',
                'link': 'https://example.test/paper', 'summary_zh': 'Readable publication body fixture.'}]}),
        'newspaper': Template((ROOT / 'secnews/prompt/newspaper.html.j2').read_text(encoding='utf-8')).render(
            **assets, report_title='UI publication fixture', date_range='2026', generated_at='fixture',
            sections={'arxiv_cs_cr': [{'title': 'Publication fixture', 'link': 'https://example.test/paper',
                'intro': 'Readable publication body fixture.'}], 'arxiv_cs_ai': [], 'bleepingcomputer': []}),
    }


def appearance(page):
    return page.evaluate('''() => {
      const body = getComputedStyle(document.body);
      const summary = document.querySelector('.paper-summary, .article-intro, .article-summary');
      const app = document.querySelector('.app-shell');
      return {theme: document.documentElement.dataset.fastuiTheme ?? null,
        dark: document.documentElement.classList.contains('dark'), background: body.backgroundColor,
        appVisible: app ? getComputedStyle(app).visibility === 'visible' : null,
        ready: document.documentElement.classList.contains('fastnews-ready'),
        text: body.color, summary: summary ? getComputedStyle(summary).color : null,
        summaryBackground: summary ? getComputedStyle(summary.closest('.surface, .paper, .article') || document.body).backgroundColor : null};
    }''')


def run(browser_path, output):
    output.mkdir(parents=True, exist_ok=True)
    results, failures = [], []

    def check(name, observed, condition):
        results.append({'name': name, 'observed': observed, 'passed': bool(condition)})
        if not condition:
            failures.append(name)

    with tempfile.TemporaryDirectory() as data:
        os.environ.update(FASTNEWS_ROOT=str(ROOT), FASTNEWS_PUBLIC_PATH='', FASTNEWS_REQUIRE_LOGIN='false',
                          FASTNEWS_COOKIE_SECURE='false')
        server = ThreadingHTTPServer(('127.0.0.1', 0), FastNewsHandler)
        server.accounts = Accounts(data)
        server.cas = CASService(server.accounts, env={})
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f'http://127.0.0.1:{server.server_port}'
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path=browser_path, headless=True)
                try:
                    for stored, legacy in [('dark', None), (None, 'dark'), ('light', 'dark'), ('system', 'dark')]:
                        context = browser.new_context(color_scheme='light')
                        context.add_init_script(f'''(() => {{
                          const stored={json.dumps(stored)}, legacy={json.dumps(legacy)};
                          if (stored !== null) localStorage.setItem('fastresearch-theme', stored);
                          if (legacy !== null) localStorage.setItem('fastnews.theme', legacy);
                        }})();''')
                        # Hold only delivery timing; continue the original HTTP request
                        # after observing parser-complete first paint.
                        page = context.new_page()
                        pending = []
                        page.route('**/assets/theme.js', lambda route: pending.append(route))
                        page.goto(origin + '/', wait_until='commit')
                        page.wait_for_function("document.readyState === 'interactive'")
                        page.wait_for_timeout(500)
                        before = appearance(page)
                        expected = 'dark' if stored == 'dark' or stored is None else 'light'
                        controller = page.evaluate_handle('window.fastNewsColorMode')
                        check(f'first-paint-{stored}-{legacy}', before,
                              before['theme'] == expected and before['dark'] == (expected == 'dark') and
                              before['ready'] and before['appVisible'] and
                              before['background'] == ('rgb(17, 24, 32)' if expected == 'dark' else 'rgb(247, 248, 250)'))
                        page.screenshot(path=str(output / f'first-paint-{stored}-{legacy}.png'))
                        for route in pending:
                            route.continue_()
                        page.wait_for_load_state('load')
                        check(f'one-controller-{stored}-{legacy}', {}, page.evaluate('(initial) => initial !== undefined && initial === window.fastNewsColorMode', controller))
                        page.locator('#themeToggle').click()
                        after = appearance(page)
                        check(f'theme-button-{stored}-{legacy}', after, after['theme'] != expected)
                        context.close()

                    rendered = templates()
                    archived = ['top-conf/data/report/CCS_2026_Report.html', 'secnews/data/report/2026.9.1-report.html']
                    baseline = subprocess.check_output(['git', 'show', 'HEAD:' + archived[0]], cwd=ROOT).decode('utf-8')
                    for scheme, saved in [('light', 'dark'), ('dark', 'light')]:
                        context = browser.new_context(color_scheme=scheme)
                        context.add_init_script(f"localStorage.setItem('fastresearch-theme', '{saved}')")
                        page = context.new_page()
                        for name in [*rendered, *archived, 'git-head-conference']:
                            if name in archived:
                                page.goto(origin + '/' + name, wait_until='load')
                            else:
                                page.goto(origin + '/', wait_until='load')
                                page.set_content(baseline if name == 'git-head-conference' else rendered[name], wait_until='load')
                            for medium in ['screen', 'print']:
                                page.emulate_media(media=medium)
                                observed = appearance(page)
                                if name == 'git-head-conference':
                                    results.append({'name': f'baseline-{scheme}-{medium}', 'observed': observed})
                                    continue
                                # A publication owns a light paper surface regardless of
                                # the site's stored preference and the OS color scheme.
                                check(f'{name}-{scheme}-{saved}-{medium}', observed,
                                      observed['background'] == 'rgb(255, 255, 255)' and
                                      observed['text'] in ['rgb(21, 28, 40)', 'rgb(15, 23, 42)'] and
                                      observed['summary'] in ['rgb(21, 28, 40)', 'rgb(15, 23, 42)'])
                                if medium == 'print':
                                    page.screenshot(path=str(output / f'{name.replace("/", "-")}-{scheme}-print.png'))
                            page.emulate_media(media='screen')
                        context.close()
                    # Every existing archive receives the publication boundary,
                    # including older report shapes with no modern summary class.
                    context = browser.new_context(color_scheme='dark')
                    page = context.new_page()
                    page.emulate_media(media='print')
                    for directory in ['top-conf/data/report', 'secnews/data/report']:
                        for path in sorted((ROOT / directory).glob('*.html')):
                            page.goto(origin + '/' + path.relative_to(ROOT).as_posix(), wait_until='load')
                            observed = appearance(page)
                            check('archive-print-' + path.name, observed,
                                  observed['background'] == 'rgb(255, 255, 255)' and observed['text'] == 'rgb(21, 28, 40)')
                    context.close()
                finally:
                    browser.close()

            # Render actual template output with JS disabled by WeasyPrint, then
            # inspect rendered PDF pixels and selectable text, not a print-CSS string.
            if sys.platform == 'win32' and not os.environ.get('FONTCONFIG_FILE'):
                from html import escape
                config = output / 'fonts.conf'
                config.write_text('<fontconfig><dir>' + escape((Path(os.environ['WINDIR']) / 'Fonts').as_posix()) +
                                  '</dir><cachedir>' + escape((output / 'font-cache').as_posix()) +
                                  '</cachedir></fontconfig>', encoding='utf-8')
                os.environ['FONTCONFIG_FILE'] = str(config)
            from weasyprint import HTML
            import pymupdf
            for name, html in templates().items():
                html_path, pdf_path = output / f'{name}.html', output / f'{name}.pdf'
                html_path.write_text(html, encoding='utf-8')
                HTML(string=html, base_url=ROOT.as_uri() + '/').write_pdf(pdf_path)
                with pymupdf.open(pdf_path) as document:
                    image = document[0].get_pixmap()
                    image.save(str(output / f'{name}-weasyprint.png'))
                    text = ''.join(page.get_text() for page in document)
                    pixels = image.samples
                    white = sum(pixels[index:index + 3] == b'\xff\xff\xff' for index in range(0, len(pixels), image.n)) / (image.width * image.height)
                    check(f'{name}-weasyprint-pdf', {'pages': len(document), 'hasText': 'Publication fixture' in text, 'whiteFraction': round(white, 4)},
                          len(document) > 0 and 'Publication fixture' in text and white > .8)
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=5)
    (output / 'results.json').write_text(json.dumps({'results': results, 'failures': failures}, indent=2), encoding='utf-8')
    print(json.dumps({'checks': len(results), 'failures': failures, 'output': str(output)}, indent=2))
    return bool(failures)


if __name__ == '__main__':
    raise SystemExit(run(sys.argv[1], Path(sys.argv[2])))
