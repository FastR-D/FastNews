"""Three-process FastCAS → FastNews → FastResearch delegated-content contract."""
import base64
import os
import re
import secrets
import subprocess
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse

import httpx

from fastnews_accounts import Accounts
from fastnews_cas import CASService
from serve import FastNewsHandler


issuer = os.environ['FASTCAS_CONTRACT_ISSUER']
news_origin = os.environ['FASTCAS_CONTRACT_NEWS_ORIGIN']
research_origin = os.environ['FASTCAS_CONTRACT_RESEARCH_ORIGIN']
root = Path(__file__).resolve().parents[2]
os.environ.update(FASTNEWS_COOKIE_SECURE='false',FASTNEWS_PUBLIC_ORIGIN=news_origin,
                  FASTNEWS_PUBLIC_PATH='',FASTRESEARCH_API_URL=research_origin)


with tempfile.TemporaryDirectory() as temporary:
    research_dir = Path(temporary)/'research'
    research_dir.mkdir()
    research_env = {**os.environ,'PORT':str(urlparse(research_origin).port),'HOST':'127.0.0.1',
        'FASTRESEARCH_DATA_DIR':str(research_dir),'FASTRESEARCH_ACCOUNT_DATABASE':str(research_dir/'accounts.sqlite'),
        'ADMIN_USERNAME':'test-admin','ADMIN_PASSWORD':'test-admin-password',
        'FASTRESEARCH_FASTCAS_ISSUER':issuer,'FASTRESEARCH_FASTCAS_CLIENT_ID':'research',
        'FASTRESEARCH_FASTCAS_CLIENT_SECRET':'integration-client-secret-32-characters-long',
        'FASTRESEARCH_FASTCAS_REDIRECT_URI':research_origin+'/api/auth/fastcas/callback',
        'FASTRESEARCH_FASTCAS_ALLOW_LOOPBACK_HTTP':'true'}
    research_process = subprocess.Popen(['node',str(root/'FastResearch/server/index.mjs')],cwd=research_dir,
        env=research_env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    try:
        deadline = time.monotonic()+10
        with httpx.Client(base_url=research_origin,follow_redirects=False) as health:
            while time.monotonic()<deadline:
                if research_process.poll() is not None:
                    raise AssertionError('Research exited: '+research_process.stdout.read())
                try:
                    if health.get('/api/health').status_code == 200:
                        break
                except httpx.RequestError:
                    pass
                time.sleep(.05)
            else:
                raise AssertionError('Research did not start')
        news_server = ThreadingHTTPServer(('127.0.0.1',urlparse(news_origin).port),FastNewsHandler)
        accounts = news_server.accounts = Accounts(Path(temporary)/'news')
        news_user = accounts.create('alice@example.test','original-local-password')
        key = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('=')
        news_env = {'FASTNEWS_FASTCAS_'+name:value for name,value in dict(ISSUER=issuer,CLIENT_ID='news',
            CLIENT_SECRET='integration-client-secret-32-characters-long',
            REDIRECT_URI=news_origin+'/api/auth/fastcas/callback',ALLOW_LOOPBACK_HTTP='true',
            RESEARCH_CONNECT='true',VAULT_KEY=key).items()}
        news_server.cas = CASService(accounts,env=news_env)
        news_thread = threading.Thread(target=news_server.serve_forever,daemon=True)
        news_thread.start()
        try:
            with httpx.Client(base_url=research_origin,follow_redirects=False,headers={'Origin':research_origin}) as research, \
                 httpx.Client(base_url=news_origin,follow_redirects=False,headers={'Origin':news_origin}) as news, \
                 httpx.Client(follow_redirects=False) as browser:
                def complete(url):
                    response = browser.get(url)
                    assert response.status_code == 302, response.text
                    login_url = urljoin(issuer,response.headers['location'])
                    request_id = parse_qs(urlparse(login_url).query)['auth_request_id'][0]
                    page = browser.get(login_url).text
                    if 'name="password"' in page:
                        csrf = re.search(r'name="csrf" value="([^"]+)"',page)[1]
                        response = browser.post(issuer+'/login',data=dict(csrf=csrf,auth_request_id=request_id,
                            email='alice@example.test',password='correct horse battery staple',action='login'),headers={'Origin':issuer})
                        assert response.status_code == 303, response.text
                        page = browser.get(urljoin(issuer,response.headers['location'])).text
                    csrf = re.search(r'name="csrf" value="([^"]+)"',page)[1]
                    response = browser.post(issuer+'/login',data=dict(csrf=csrf,auth_request_id=request_id,action='approve'),headers={'Origin':issuer})
                    assert response.status_code == 303, response.text
                    response = browser.get(urljoin(issuer,response.headers['location']))
                    assert response.status_code == 302, response.text
                    return response.headers['location']

                admin = research.post('/api/admin/login',json={'username':'test-admin','password':'test-admin-password'}).json()['session']
                made = research.post('/api/admin/keys',json={'person':'Alice'},headers={'Authorization':'Bearer '+admin})
                assert made.status_code == 201, made.text
                research_key = made.json()['key']
                opened = research.post('/api/content/unlock',json={'key':research_key})
                assert opened.status_code == 200, opened.text
                local_research = opened.json()['session']
                assert research.put('/api/content/authors',json={'authors':[{'name':'Alina Oprea'}],'customTags':['TEE']},headers={'Authorization':'Bearer '+local_research}).status_code == 200
                assert research.put('/api/content/impression',json={'text':'Trusted execution environments'},headers={'Authorization':'Bearer '+local_research}).status_code == 200
                research_link = research.post('/api/auth/fastcas/link',json={'key':research_key})
                assert research_link.status_code == 200, research_link.text
                research_callback = complete(research_link.json()['url'])
                assert research.get(research_callback).headers['location'] == '/?fastcas=complete'
                assert research.get('/api/auth/fastcas/status').json()['link']['state'] == 'active'

                news.headers['X-CSRF-Token'] = news.get('/api/auth/session-init').json()['csrf']
                logged = news.post('/api/auth/login',json={'email':'alice@example.test','password':'original-local-password'})
                assert logged.status_code == 200, logged.text
                local_news = news.cookies['fastnews_session']
                news.headers['X-CSRF-Token'] = logged.json()['csrf']
                news_link = news.post('/api/auth/fastcas/link',json={'password':'original-local-password'})
                assert news_link.status_code == 200, news_link.text
                news_callback = complete(news_link.json()['url'])
                assert news.get(news_callback).headers['location'] == '/login?fastcas=complete'
                assert news.get('/api/auth/fastcas/status').json()['link']['state'] == 'active'
                login_url = news.get('/api/auth/fastcas/login').headers['location']
                callback = complete(login_url)
                assert news.get(callback).headers['location'] == '/login?fastcas=complete'
                cas_news = news.cookies['fastnews_session']
                assert cas_news != local_news
                me = news.get('/api/auth/me').json()
                assert me['source'] == 'fastcas' and me['user_id'] == news_user
                assert news.get('/api/auth/research/live').status_code == 403

                csrf = browser.get(issuer+'/api/v1/me').json()['csrf']
                consent = dict(caller_client='news',target_client='research',resource='research-api',scope='research:read',active=True)
                granted = browser.post(issuer+'/api/v1/me/delegations',json=consent,headers={'Origin':issuer,'X-CSRF-Token':csrf})
                assert granted.status_code == 204, granted.text
                live = news.get('/api/auth/research/live')
                assert live.status_code == 200, live.text
                assert live.json()['researchAccountId'] == opened.json()['accountId']
                assert live.json()['authors'][0]['name'] == 'Alina Oprea'
                assert live.json()['impression']['text'] == 'Trusted execution environments'
                with accounts.connect(True) as db:
                    db.execute('UPDATE cas_token_vault SET access_expires=0 WHERE session_hash=?',(accounts.session(cas_news)['hash'],))
                assert news.get('/api/auth/research/live').status_code == 200
                assert news.post('/api/auth/research/sync',json={'replace':False},headers={'X-CSRF-Token':'invalid'}).status_code == 403
                news.headers['X-CSRF-Token'] = me['csrf']
                assert news.post('/api/auth/research/sync',json={'replace':False},headers={'Origin':'https://attacker.example'}).status_code == 403
                synced = news.post('/api/auth/research/sync',json={'replace':False})
                assert synced.status_code == 200, synced.text
                assert news.get('/api/content/impression').json()['impression']['text'] == 'Trusted execution environments'
                assert accounts.session(local_news)['source'] == 'local'
                consent['active'] = False
                revoked = browser.post(issuer+'/api/v1/me/delegations',json=consent,headers={'Origin':issuer,'X-CSRF-Token':csrf})
                assert revoked.status_code == 204, revoked.text
                assert news.get('/api/auth/research/live').status_code == 403
                assert news.get('/api/content/impression').json()['impression']['text'] == 'Trusted execution environments'
                assert accounts.session(local_news) and accounts.session(cas_news)
            data = (Path(temporary)/'news'/'accounts.sqlite').read_bytes()
            assert b'integration-client-secret-32-characters-long' not in data
            assert research_key.encode() not in data
            print('FastNews/Research delegated content contract passed')
        finally:
            news_server.shutdown();news_server.server_close();news_thread.join(timeout=5)
            if news_server.cas._sdk: news_server.cas._sdk.close()
    finally:
        research_process.terminate()
        try: research_process.wait(timeout=5)
        except subprocess.TimeoutExpired: research_process.kill();research_process.wait(timeout=5)
        research_process.stdout.close()
