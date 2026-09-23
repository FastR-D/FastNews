"""Real provider contract, started by the FastCAS Go integration suite."""
import os
from pathlib import Path
import re
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer
from urllib.parse import urljoin, urlparse, parse_qs

import httpx
from fastnews_accounts import Accounts
from fastnews_cas import CASService
from serve import FastNewsHandler

issuer = os.environ['FASTCAS_CONTRACT_ISSUER']
origin = os.environ['FASTCAS_CONTRACT_NEWS_ORIGIN']
os.environ['FASTNEWS_COOKIE_SECURE'] = 'false'
os.environ['FASTNEWS_PUBLIC_ORIGIN'] = origin
os.environ['FASTNEWS_PUBLIC_PATH'] = ''
with tempfile.TemporaryDirectory() as root:
    server = ThreadingHTTPServer(('127.0.0.1',urlparse(origin).port),FastNewsHandler)
    accounts = server.accounts = Accounts(root)
    user = accounts.create('alice@example.test','original-local-password')
    env = {'FASTNEWS_FASTCAS_'+key:value for key,value in dict(ISSUER=issuer,CLIENT_ID='news',CLIENT_SECRET='integration-client-secret-32-characters-long',REDIRECT_URI=origin+'/api/auth/fastcas/callback',ALLOW_LOOPBACK_HTTP='true').items()}
    server.cas = CASService(accounts,env=env)
    thread = threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    try:
        with httpx.Client(base_url=origin,follow_redirects=False,headers={'Origin':origin}) as app, httpx.Client(follow_redirects=False) as browser:
            def complete(url):
                response = browser.get(url)
                assert response.status_code == 302
                login_url = urljoin(issuer,response.headers['location'])
                request_id = parse_qs(urlparse(login_url).query)['auth_request_id'][0]
                body = browser.get(login_url).text
                if 'name="password"' in body:
                    csrf = re.search(r'name="csrf" value="([^"]+)"',body)[1]
                    response = browser.post(issuer+'/login',data=dict(csrf=csrf,auth_request_id=request_id,email='alice@example.test',password='correct horse battery staple',action='login'),headers={'Origin':issuer})
                    assert response.status_code == 303
                    body = browser.get(urljoin(issuer,response.headers['location'])).text
                csrf = re.search(r'name="csrf" value="([^"]+)"',body)[1]
                response = browser.post(issuer+'/login',data=dict(csrf=csrf,auth_request_id=request_id,action='approve'),headers={'Origin':issuer})
                assert response.status_code == 303
                response = browser.get(urljoin(issuer,response.headers['location']))
                assert response.status_code == 302
                return response.headers['location']
            app.headers['X-CSRF-Token'] = app.get('/api/auth/session-init').json()['csrf']
            logged = app.post('/api/auth/login',json={'email':'alice@example.test','password':'original-local-password'})
            assert logged.status_code == 200
            app.headers['X-CSRF-Token'] = logged.json()['csrf']
            local = app.cookies['fastnews_session']
            assert app.put('/api/content/impression',json={'text':'Original notes'}).status_code == 200
            assert app.get(complete(app.get('/api/auth/fastcas/login').headers['location'])).headers['location'] == '/login?fastcas=failed'
            assert app.cookies['fastnews_session'] == local
            started = app.post('/api/auth/fastcas/link',json={'password':'original-local-password'})
            assert started.status_code == 200, started.text
            assert app.get(complete(started.json()['url'])).headers['location'] == '/login?fastcas=complete'
            assert app.cookies['fastnews_session'] == local
            assert app.get('/api/auth/fastcas/status').json()['link']['state'] == 'active'
            callback = complete(app.get('/api/auth/fastcas/login').headers['location'])
            assert app.get(callback).headers['location'] == '/login?fastcas=complete'
            cas = app.cookies['fastnews_session']
            me = app.get('/api/auth/me').json()
            assert me['user_id'] == user and me['source'] == 'fastcas'
            assert app.get('/api/content/impression').json()['impression']['text'] == 'Original notes'
            assert app.get(callback).headers['location'] == '/login?fastcas=failed'
            if signal := os.environ.get('FASTCAS_CONTRACT_STATUS_SIGNAL'):
                Path(signal).write_text('ready')
                deadline = time.monotonic()+8
                while time.monotonic()<deadline and accounts.session(cas):
                    time.sleep(.05)
                assert accounts.session(cas) is None and accounts.session(local)
                app.cookies.set('fastnews_session',local,domain='127.0.0.1',path='/')
                assert app.get('/api/content/impression').json()['impression']['text'] == 'Original notes'
                print('FastNews identity status contract passed: signed event revoked CAS session, local session preserved')
                raise SystemExit(0)
            csrf = browser.get(issuer+'/api/v1/me').json()['csrf']
            signed_out = browser.post(issuer+'/api/v1/me/logout-all',json={},headers={'Origin':issuer,'X-CSRF-Token':csrf})
            assert signed_out.status_code == 204, signed_out.text
            deadline = time.monotonic()+5
            while time.monotonic()<deadline and accounts.session(cas):
                time.sleep(.05)
            assert accounts.session(cas) is None and accounts.session(local)
            app.cookies.set('fastnews_session',local,domain='127.0.0.1',path='/')
            app.headers['X-CSRF-Token'] = logged.json()['csrf']
            assert app.post('/api/auth/fastcas/revoke',json={'password':'original-local-password'}).status_code == 200
            assert accounts.session(cas) is None and accounts.session(local)
            assert app.get('/api/auth/me').status_code == 200
            app.headers['X-CSRF-Token'] = app.get('/api/auth/session-init').json()['csrf']
            assert app.post('/api/auth/login',json={'email':'alice@example.test','password':'original-local-password'}).status_code == 200
            assert app.get('/api/content/impression').json()['impression']['text'] == 'Original notes'
        print('FastNews real-provider contract passed: no email merge, bind, same account/content, replay rejection, global logout delivery and local-session isolation')
    finally:
        server.shutdown();server.server_close();thread.join(timeout=5)
        if server.cas._sdk:
            server.cas._sdk.close()
