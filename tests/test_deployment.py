import threading
from http.server import ThreadingHTTPServer

import httpx
import pytest
from fastnews_accounts import Accounts
from serve import FastNewsHandler, resolve_public_file


def test_release_assets_and_persistent_reports_are_separate(tmp_path, monkeypatch):
    data = tmp_path / 'data'; code = tmp_path / 'release'
    (data / 'assets').mkdir(parents=True); (code / 'assets').mkdir(parents=True)
    (data / 'assets/site.js').write_text('old code')
    (code / 'assets/site.js').write_text('new code')
    (data / 'report.html').write_text('live generated report')
    (code / 'private.py').write_text('private source')
    monkeypatch.setenv('FASTNEWS_ROOT', str(data))
    monkeypatch.setenv('FASTNEWS_CODE_ROOT', str(code))
    assert resolve_public_file('/assets/site.js') == code / 'assets/site.js'
    assert resolve_public_file('/report.html') == data / 'report.html'
    assert resolve_public_file('/private.py') is None
    assert resolve_public_file('/.env') is None


def test_readiness_reads_persistent_accounts(tmp_path):
    server = ThreadingHTTPServer(('127.0.0.1', 0), FastNewsHandler)
    server.accounts = Accounts(tmp_path)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        with httpx.Client(base_url=f'http://127.0.0.1:{server.server_port}', trust_env=False) as client:
            assert client.get('/api/health').json() == {'ok': True}
            response = client.head('/api/health')
            assert response.status_code == 200 and response.content == b''
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=5)


def test_directory_release_pages_and_live_report_dependencies_over_http(tmp_path, monkeypatch):
    data = tmp_path / 'live'
    code = tmp_path / 'release'
    fixtures = {
        data: {
            'index.html': 'old home',
            'top-conf/index.html': 'old section',
            'assets/site.js': 'old script',
            'top-conf/data/report/current.html': '<a href="../papers.json">live report</a>',
            'top-conf/data/papers.json': '["live papers"]',
            'top-conf/data/report/index.html': 'live report directory',
            'report.html': 'live generated report',
        },
        code: {
            'index.html': 'release home',
            'top-conf/index.html': 'release section',
            'code-only/index.html': 'release only section',
            'assets/site.js': 'release script',
            'top-conf/data/report/current.html': 'stale packaged report',
            'top-conf/data/papers.json': '["stale papers"]',
            'top-conf/data/report/index.html': 'stale report directory',
            'private.py': 'private source',
        },
    }
    for root, files in fixtures.items():
        for relative, content in files.items():
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding='utf-8')
    monkeypatch.setenv('FASTNEWS_ROOT', str(data))
    monkeypatch.setenv('FASTNEWS_CODE_ROOT', str(code))
    monkeypatch.setenv('FASTNEWS_REQUIRE_LOGIN', 'false')
    server = ThreadingHTTPServer(('127.0.0.1', 0), FastNewsHandler)
    server.accounts = Accounts(tmp_path / 'accounts')
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with httpx.Client(base_url=f'http://127.0.0.1:{server.server_port}', trust_env=False) as client:
            for directory, marker in (('/', 'release home'), ('/top-conf/', 'release section'), ('/code-only/', 'release only section'), ('/top-conf/data/report/', 'live report directory')):
                response = client.get(directory)
                explicit = client.get(directory + 'index.html')
                assert response.status_code == explicit.status_code == 200
                assert marker in response.text
                assert response.content == explicit.content
                assert client.get(directory.rstrip('/') or '/').content == response.content
                head = client.head(directory)
                assert head.status_code == 200 and head.content == b''
                assert int(head.headers['content-length']) == len(response.content)
            report = client.get('/top-conf/data/report/current.html')
            assert report.status_code == 200 and 'live report' in report.text
            assert client.get(httpx.URL('/top-conf/data/report/current.html').join('../papers.json')).json() == ['live papers']
            assert 'live generated report' in client.get('/report.html').text
            assert client.get('/assets/site.js').text == 'release script'
            for path in ('/.env', '/private.py', '/top-conf/.hidden.html', '/missing/', '/assets/%5c..%5cprivate.py'):
                assert client.get(path).status_code == 404
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=5)


def test_public_http_rejects_symlink_escape_from_both_roots(tmp_path, monkeypatch):
    data = tmp_path / 'live'
    code = tmp_path / 'release'
    outside = tmp_path / 'outside'
    outside.mkdir()
    (outside / 'index.html').write_text('outside directory')
    (outside / 'leak.html').write_text('outside file')
    for root in (data, code):
        root.mkdir()
        try:
            (root / 'escape').symlink_to(outside, target_is_directory=True)
            (root / 'leak.html').symlink_to(outside / 'leak.html')
        except OSError as error:
            pytest.skip(f'symlink creation unavailable: {error}')
    monkeypatch.setenv('FASTNEWS_ROOT', str(data))
    monkeypatch.setenv('FASTNEWS_CODE_ROOT', str(code))
    monkeypatch.setenv('FASTNEWS_REQUIRE_LOGIN', 'false')
    server = ThreadingHTTPServer(('127.0.0.1', 0), FastNewsHandler)
    server.accounts = Accounts(tmp_path / 'accounts')
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with httpx.Client(base_url=f'http://127.0.0.1:{server.server_port}', trust_env=False) as client:
            for path in ('/escape/', '/escape/index.html', '/leak.html'):
                assert client.get(path).status_code == 404
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=5)
