import threading
from http.server import ThreadingHTTPServer

import httpx
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
