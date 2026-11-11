"""Real browser -> generated account page -> HTTP -> CAS controls and SQLite.

The optional provider is a recording double at CASService's existing SDK seam.
This scenario checks local controls, not a live FastCAS/PostgreSQL deployment.
Run with PYTHONPATH=. and pass Chromium and a result JSON path.
"""
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer

from playwright.sync_api import expect, sync_playwright

from fastnews_accounts import Accounts
from fastnews_cas import CASService
from serve import FastNewsHandler

ROOT = Path(__file__).resolve().parents[1]


class Provider:
    def __init__(self):
        self.calls = []
        self.link = None

    def get_link(self, link_id):
        self.calls.append('get_link')
        assert link_id == self.link['id']
        return self.link.copy()

    def revoke_link(self, link):
        self.calls.append('revoke_link')
        self.link = {**link, 'state': 'revoked', 'version': link['version'] + 1}
        return self.link.copy()


def run(browser, login, link, enabled=True):
    with tempfile.TemporaryDirectory() as data:
        os.environ.update(FASTNEWS_ROOT=str(ROOT), FASTNEWS_PUBLIC_PATH='',
                          FASTNEWS_COOKIE_SECURE='false', FASTNEWS_REQUIRE_LOGIN='true')
        server = ThreadingHTTPServer(('127.0.0.1', 0), FastNewsHandler)
        origin = f'http://127.0.0.1:{server.server_port}'
        os.environ['FASTNEWS_PUBLIC_ORIGIN'] = origin
        accounts = server.accounts = Accounts(data)
        user = accounts.create('reader@example.test', 'browser-password')
        accounts.personal(user, 'impression', {'text': 'Preserved notes'})
        provider = Provider()
        values = dict(ISSUER='https://provider.example.test', CLIENT_ID='news',
                      CLIENT_SECRET='fixture-only', REDIRECT_URI=origin + '/api/auth/fastcas/callback',
                      LOGIN_ENABLED=str(login).lower(), LINK_ENABLED=str(link).lower())
        if not enabled:
            values = dict(ENABLED='false', ISSUER='https://provider.example.test')
        server.cas = CASService(accounts, sdk=provider,
            env={'FASTNEWS_FASTCAS_' + key: value for key, value in values.items()})
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        context = browser.new_context(color_scheme='light')
        context.add_init_script("localStorage.setItem('fastresearch-theme','dark')")
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            with page.expect_response('**/api/auth/fastcas/available'):
                page.goto(origin + '/login')
            expect(page.locator('html')).to_have_attribute('data-fastui-theme', 'dark')
            expect(page.locator('#cas-login')).to_be_visible() if enabled and login else expect(page.locator('#cas-login')).to_be_hidden()
            expect(page.locator('#form')).to_be_visible()
            if not enabled or not login:
                assert context.request.get(origin + '/api/auth/fastcas/login').status == (403 if enabled else 404)
            page.locator('#email').fill('reader@example.test')
            page.locator('#password').fill('browser-password')
            page.locator('#submit').click()
            page.wait_for_url(origin + '/')
            with page.expect_response('**/api/auth/fastcas/available'):
                page.goto(origin + '/login')
            expect(page.locator('#signed')).to_be_visible()
            expect(page.locator('#cas-login')).to_be_hidden()
            expect(page.locator('#cas-link')).to_be_visible() if enabled and link else expect(page.locator('#cas-link')).to_be_hidden()
            if enabled:
                csrf = context.request.get(origin + '/api/auth/me').json()['csrf']
                headers = {'Origin': origin, 'X-CSRF-Token': csrf}
                if not link:
                    assert context.request.post(origin + '/api/auth/fastcas/link',
                        data={'password': 'browser-password'}, headers=headers).status == 403
                for state in ['prepared', 'active']:
                    provider.link = dict(id='fixture-link', client_id='news', subject='fixture-subject',
                        local_account_ref=user, state=state, version=1 if state == 'prepared' else 2)
                    server.cas.store.save(provider.link)
                    with page.expect_response('**/api/auth/fastcas/status'):
                        page.reload()
                    expect(page.locator('#cas-link')).to_be_hidden()
                    expect(page.locator('#cas-revoke')).to_be_visible()
                    expect(page.locator('#cas-reconcile')).to_be_visible() if link and state == 'prepared' else expect(page.locator('#cas-reconcile')).to_be_hidden()
                    if not link and state == 'prepared':
                        assert context.request.post(origin + '/api/auth/fastcas/reconcile', data={}, headers=headers).status == 403
                page.locator('#cas-password').fill('browser-password')
                with page.expect_response('**/api/auth/fastcas/revoke') as revoked:
                    page.locator('#cas-revoke').click()
                assert revoked.value.status == 200
                expect(page.locator('#cas-revoke')).to_be_hidden()
                assert server.cas.store.current(user) is None
                assert provider.calls == (['get_link', 'get_link', 'revoke_link'] if not link else ['get_link', 'revoke_link'])
            else:
                expect(page.locator('#cas')).to_be_hidden()
                assert not provider.calls
            assert context.request.get(origin + '/api/auth/me').status == 200
            assert accounts.personal(user, 'impression')['text'] == 'Preserved notes'
            assert not errors, errors
            return dict(enabled=enabled, login=login, link=link, localLogin=True,
                        localContent='preserved', providerCalls=provider.calls, pageErrors=errors)
        finally:
            context.close()
            server.shutdown(); server.server_close(); thread.join(timeout=5)


if __name__ == '__main__':
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=sys.argv[1], headless=True)
        try:
            results = [run(browser, login, link) for login in [True, False] for link in [True, False]]
            results.append(run(browser, False, False, enabled=False))
            output = {'browser': browser.version, 'scenarios': results}
            Path(sys.argv[2]).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(output, ensure_ascii=False, indent=2))
        finally:
            browser.close()
