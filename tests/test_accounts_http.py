import threading
from http.server import ThreadingHTTPServer

import httpx
import inbox_push

from fastnews_accounts import Accounts
from fastnews_cas import CASService
from serve import FastNewsHandler, redact_request_line


def test_access_log_redacts_login_secrets():
    message = '"GET /api/auth/fastcas/callback?code=secret-code&state=secret-state&sso=secret-ticket&view=account HTTP/1.1" 302 -'
    assert redact_request_line(message) == '"GET /api/auth/fastcas/callback?code=redacted&state=redacted&sso=redacted&view=account HTTP/1.1" 302 -'
    assert 'secret-token' not in redact_request_line('GET /?ACCESS_TOKEN=secret-token HTTP/1.1')


def test_real_handler_local_login_csrf_and_logout(tmp_path, monkeypatch):
    monkeypatch.setenv('FASTNEWS_COOKIE_SECURE','false')
    monkeypatch.setenv('FASTNEWS_ROOT',str(tmp_path))
    (tmp_path/'index.html').write_text('<html><head></head><body>Public report</body></html>')
    server = ThreadingHTTPServer(('127.0.0.1',0),FastNewsHandler)
    server.accounts = Accounts(tmp_path)
    server.cas = CASService(server.accounts,env={})
    user = server.accounts.create('reader@example.com','original-password')
    thread = threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    try:
        with httpx.Client(base_url=f'http://127.0.0.1:{server.server_port}') as client:
            assert client.get('/api/auth/fastcas/available').json() == {'enabled':False}
            assert client.get('/api/auth/fastcas/login').status_code == 404
            assert client.get('/login').status_code == 200
            assert '__FASTNEWS_BASE__' not in client.get('/login').text
            assert client.get('/').status_code == 200
            monkeypatch.setenv('FASTNEWS_REQUIRE_LOGIN','true')
            assert client.get('/').headers['location'].endswith('/login')
            payload = {'email':'reader@example.com','password':'original-password'}
            assert client.post('/api/auth/login',json=payload).status_code == 403
            client.headers['X-CSRF-Token'] = client.get('/api/auth/session-init').json()['csrf']
            assert client.post('/api/auth/login',json=payload,headers={'Origin':'https://attacker.example'}).status_code == 403
            response = client.post('/api/auth/login',json=payload)
            assert response.status_code == 200
            assert client.get('/').status_code == 200
            assert 'fastnews_session' in client.cookies and 'fr_session' not in client.cookies
            assert client.get('/api/auth/me').json()['user_id'] == user
            assert client.get('/api/content/authors').json() == {'authors':[], 'customTags':[]}
            assert client.get('/api/content/me').json()['userId'] == user
            assert client.post('/api/auth/logout',json={}).status_code == 403
            client.headers['X-CSRF-Token'] = response.json()['csrf']
            assert client.put('/api/content/authors',json={'authors':[{'name':'Author'}],'customTags':['security']}).status_code == 200
            assert client.get('/api/content/authors').json()['authors'] == [{'name':'Author'}]
            assert client.put('/api/content/impression',json={'text':'Original interests'}).status_code == 200
            assert client.get('/api/content/me').json()['impression']['text'] == 'Original interests'
            assert client.put('/api/content/inbox',json={'items':[{'id':'forged'}]}).status_code == 400
            assert client.get('/api/content/inbox').json()['items'] == []
            calls = []
            def generate(accounts, user_id, items):
                calls.append((user_id,items))
                assert accounts.personal(user_id,'impression')['text'] == 'Original interests'
                return {'id':'daily-local','date':inbox_push.shanghai_today(),'kind':'daily-paper','read':False}, True
            server.daily_inbox_generator = generate
            daily = client.get('/api/content/inbox')
            assert daily.status_code == 200
            assert daily.json()['generatedToday'] is True
            assert daily.json()['items'][0]['id'] == 'daily-local'
            assert client.get('/api/content/inbox').json()['generatedToday'] is False
            assert len(calls) == 1
            assert client.put('/api/content/inbox',json={'readIds':['daily-local']}).status_code == 200
            assert client.get('/api/content/inbox').json()['unread'] == 0
            assert client.post('/api/auth/logout',json={}).status_code == 200
            assert client.get('/api/auth/me').status_code == 401
    finally:
        server.shutdown();server.server_close();thread.join(timeout=5)


def test_enabled_cas_http_origin_csrf_and_local_proof(tmp_path, monkeypatch):
    monkeypatch.setenv('FASTNEWS_COOKIE_SECURE','false')
    server = ThreadingHTTPServer(('127.0.0.1',0),FastNewsHandler)
    origin = f'http://127.0.0.1:{server.server_port}'
    accounts = server.accounts = Accounts(tmp_path)
    accounts.create('reader@example.com','original-password')
    raw,csrf = accounts.login('reader@example.com','original-password','peer')
    class Provider:
        calls = 0
        def begin_link(self,binding,**proof):
            self.calls += 1
            assert len(binding)>=32 and proof['local_account_ref']
            assert proof['local_session_id']==accounts.session(raw)['hash']
            return 'https://cas.example/authorize'
    provider = Provider()
    env = {'FASTNEWS_FASTCAS_'+key:value for key,value in dict(ISSUER='https://cas.example',CLIENT_ID='news',CLIENT_SECRET='secret',REDIRECT_URI=origin+'/api/auth/fastcas/callback').items()}
    server.cas = CASService(accounts,provider,env)
    thread = threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    try:
        with httpx.Client(base_url=origin) as client:
            client.cookies.set('fastnews_session',raw)
            assert client.get('/api/auth/fastcas/available').json()['enabled']
            assert client.get('/api/auth/fastcas/status').json()['link'] is None
            assert client.post('/api/auth/fastcas/link',json={'password':'original-password'}).status_code==403
            client.headers['Origin']=origin
            assert client.post('/api/auth/fastcas/link',json={'password':'original-password'}).status_code==403
            client.headers['X-CSRF-Token']=csrf
            assert client.post('/api/auth/fastcas/link',json={'password':'wrong'}).status_code==403
            response=client.post('/api/auth/fastcas/link',json={'password':'original-password'})
            assert response.status_code==200
            assert response.json()['url']=='https://cas.example/authorize'
            assert client.cookies.get('fastnews_cas_binding')
            assert provider.calls==1
            assert accounts.session(raw)['source']=='local'
            assert client.post('/api/auth/fastcas/events',json={}).status_code==415
    finally:
        server.shutdown();server.server_close();thread.join(timeout=5)
