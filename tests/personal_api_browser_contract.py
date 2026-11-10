"""Real browser -> prefix-stripping proxy -> FastNewsHandler -> SQLite.

Run with PYTHONPATH=. and an installed Playwright; pass Chromium and output JSON paths.
No DOM, fetch, account, or content handler doubles are used in this scenario.
"""
import http.client
import json
import os
import re
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from fastnews_accounts import Accounts
from fastnews_cas import CASService
from inbox_push import shanghai_today
from serve import FastNewsHandler


def run(browser, prefix, private):
    with tempfile.TemporaryDirectory() as temp:
        os.environ.update(FASTNEWS_ROOT=str(Path(__file__).resolve().parents[1]),
                          FASTNEWS_COOKIE_SECURE='false', FASTNEWS_PUBLIC_PATH=prefix,
                          FASTNEWS_REQUIRE_LOGIN=str(private).lower())
        backend = ThreadingHTTPServer(('127.0.0.1', 0), FastNewsHandler)
        accounts = backend.accounts = Accounts(temp)
        backend.cas = CASService(accounts, env={})
        user = accounts.create('reader@example.test', 'browser-password')
        accounts.personal(user, 'authors', {'authors': [{'id': 'a', 'name': 'Fixture Author',
            'homepage': 'https://example.test', 'tags': ['security']}], 'customTags': ['security']})
        accounts.personal(user, 'impression', {'text': 'Initial interests'})
        accounts.personal(user, 'inbox', [{'id': 'today', 'date': shanghai_today(),
            'kind': 'daily-paper', 'title': 'Fixture paper', 'read': False}])
        requests = []

        class Proxy(BaseHTTPRequestHandler):
            def forward(self):
                requests.append((self.command, self.path))
                if not self.path.startswith(prefix + '/'):
                    self.send_error(404)
                    return
                connection = http.client.HTTPConnection('127.0.0.1', backend.server_port, timeout=10)
                try:
                    body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                    headers = {key: value for key, value in self.headers.items()
                               if key.lower() not in {'connection', 'accept-encoding'}}
                    connection.request(self.command, self.path[len(prefix):], body, headers)
                    response = connection.getresponse()
                    data = response.read()
                    self.send_response(response.status)
                    for key, value in response.getheaders():
                        if key.lower() not in {'connection', 'transfer-encoding'}:
                            self.send_header(key, value)
                    self.end_headers()
                    self.wfile.write(data)
                finally:
                    connection.close()
            do_GET = do_POST = do_PUT = forward

        proxy = ThreadingHTTPServer(('127.0.0.1', 0), Proxy)
        origin = f'http://127.0.0.1:{proxy.server_port}'
        os.environ['FASTNEWS_PUBLIC_ORIGIN'] = origin
        threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in [backend, proxy]]
        for thread in threads:
            thread.start()
        context = browser.new_context()
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            # Exercise the public/private document policy before real local login.
            page.goto(origin + prefix + '/')
            if private:
                page.wait_for_url(origin + prefix + '/login')
            else:
                expect(page.locator('html')).to_have_class(re.compile('fastnews-ready'))
            init = context.request.get(origin + prefix + '/api/auth/session-init').json()
            response = context.request.post(origin + prefix + '/api/auth/login',
                data={'email': 'reader@example.test', 'password': 'browser-password'},
                headers={'X-CSRF-Token': init['csrf'], 'Origin': origin})
            assert response.status == 200
            page.goto(origin + prefix + '/index.html#authors')
            expect(page.locator('[data-delete-id="a"]')).to_be_visible()
            page.locator('#openImpression').click()
            expect(page.locator('#impressionText')).to_have_value('Initial interests')
            page.locator('#impressionText').fill('Browser saved interests')
            with page.expect_response(lambda r: r.request.method == 'PUT' and r.url.endswith('/api/content/impression')) as saved:
                page.locator('#impressionSubmit').click()
            assert saved.value.status == 200
            page.reload()
            expect(page.locator('#impressionText')).to_have_value('Browser saved interests')
            with page.expect_response(lambda r: r.request.method == 'PUT' and r.url.endswith('/api/content/authors')) as saved:
                page.locator('[data-delete-id="a"]').click()
            assert saved.value.status == 200
            page.reload()
            expect(page.locator('#authorList')).to_contain_text('还没有添加关注作者')
            page.goto(origin + prefix + '/inbox/index.html')
            expect(page.locator('#inboxStatUnread')).to_have_text('0')
            page.wait_for_load_state('networkidle')
            page.reload()
            expect(page.locator('#inboxStatUnread')).to_have_text('0')
            page.wait_for_load_state('networkidle')
            assert accounts.personal(user, 'impression')['text'] == 'Browser saved interests'
            assert accounts.personal(user, 'authors') == {'authors': [], 'customTags': ['security']}
            assert accounts.personal(user, 'inbox')[0]['read'] is True
            assert context.request.put(origin + prefix + '/api/content/impression', data={'text': 'forged'}).status == 403
            context.clear_cookies()
            context.add_cookies([{'name': 'fastnews_session', 'value': 'invalid', 'url': origin}])
            assert context.request.get(origin + prefix + '/api/content/me').status == 401
            api_requests = [(method, path) for method, path in requests if '/api/content/' in path]
            assert api_requests and all(path.startswith(prefix + '/api/content/') for _, path in api_requests)
            assert not errors, errors
            return {'prefix': prefix or '/', 'private': private, 'impression': 'persisted',
                    'authors': 'deleted and persisted', 'inboxUnread': 0, 'pageErrors': errors,
                    'requests': sorted(set(api_requests))}
        finally:
            context.close()
            for server, thread in zip([backend, proxy], threads):
                server.shutdown(); server.server_close(); thread.join(timeout=5)


if __name__ == '__main__':
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=sys.argv[1], headless=True)
        try:
            results = []
            for prefix in ['', '/news', '/lab/news']:
                for private in [False, True]:
                    result = run(browser, prefix, private)
                    results.append(result)
                    print(json.dumps(result, ensure_ascii=False))
            Path(sys.argv[2]).write_text(json.dumps({'browser': browser.version, 'scenarios': results},
                ensure_ascii=False, sort_keys=True, indent=2), encoding='utf-8')
        finally:
            browser.close()
