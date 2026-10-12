import json
import os
import re
import select
import shutil
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
import pytest

from fastnews_accounts import AccountError, Accounts
from fastnews_cas import CASService
from research_import import ResearchImporter
from serve import FastNewsHandler


def test_research_key_snapshot_and_local_import(tmp_path, monkeypatch):
    seen = []
    class Research(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def respond(self, status, value):
            encoded = json.dumps(value).encode()
            self.send_response(status)
            self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)
        def do_POST(self):
            raw = self.rfile.read(int(self.headers.get('Content-Length','0')))
            seen.append((self.path,self.headers.get('Authorization'),json.loads(raw)))
            if self.path == '/api/content/unlock':
                return self.respond(200,{'session':'research-temporary-session','accountId':'research-account-1','keyId':'research-key-1'})
            if self.path == '/api/content/logout':
                return self.respond(200,{'ok':True})
            self.respond(404,{})
        def do_GET(self):
            seen.append((self.path,self.headers.get('Authorization'),None))
            assert self.headers.get('Authorization') == 'Bearer research-temporary-session'
            values = {
                '/api/content/me':{'accountId':'research-account-1','keyId':'research-key-1'},
                '/api/content/authors':{'authors':[{'name':'Alice'}],'customTags':['security']},
                '/api/content/impression':{'impression':{'text':'Original research','updatedAt':'2026-09-23'}},
                '/api/content/inbox':{'items':[{'id':'original-message','read':False}]},
            }
            self.respond(200,values[self.path])

    research = ThreadingHTTPServer(('127.0.0.1',0),Research)
    research_thread = threading.Thread(target=research.serve_forever,daemon=True)
    research_thread.start()
    news = ThreadingHTTPServer(('127.0.0.1',0),FastNewsHandler)
    news.accounts = Accounts(tmp_path)
    news.cas = CASService(news.accounts,env={})
    news.research_importer = ResearchImporter(f'http://127.0.0.1:{research.server_port}')
    user = news.accounts.create('one@example.com','original-password')
    other = news.accounts.create('two@example.com','original-password')
    news_thread = threading.Thread(target=news.serve_forever,daemon=True)
    news_thread.start()
    monkeypatch.setenv('FASTNEWS_COOKIE_SECURE','false')
    try:
        origin = f'http://127.0.0.1:{news.server_port}'
        with httpx.Client(base_url=origin) as client:
            csrf = client.get('/api/auth/session-init').json()['csrf']
            client.headers['X-CSRF-Token'] = csrf
            assert client.post('/api/auth/login',json={'email':'one@example.com','password':'original-password'}).status_code == 200
            csrf = client.get('/api/auth/me').json()['csrf']
            client.headers['X-CSRF-Token'] = csrf
            assert client.get('/api/auth/research/status').json()['connection'] is None
            payload = {'key':'fk_real-research-key','replace':False}
            assert client.post('/api/auth/research/import',json=payload).status_code == 403
            assert client.post('/api/auth/research/import',json=payload,headers={'Origin':origin,'X-CSRF-Token':'invalid'}).status_code == 403
            response = client.post('/api/auth/research/import',json=payload,headers={'Origin':origin})
            assert response.status_code == 200, response.text
            assert response.json()['connection']['counts'] == {'authors':1,'inbox':1}
            assert client.get('/api/content/authors').json()['authors'] == [{'name':'Alice'}]
            assert client.get('/api/content/impression').json()['impression']['text'] == 'Original research'
            assert client.get('/api/content/inbox').json()['items'][0]['id'] == 'original-message'
            assert client.post('/api/auth/research/import',json=payload,headers={'Origin':origin}).status_code == 409
            assert client.post('/api/auth/research/import',json={**payload,'replace':True},headers={'Origin':origin}).status_code == 200
            assert client.get('/api/auth/research/status').json()['connection']['research_account_id'] == 'research-account-1'
            assert user != other
            with news.accounts.connect() as db:
                assert db.execute('SELECT count(*) FROM personal WHERE user_id=?',(other,)).fetchone()[0] == 0
        assert seen[0] == ('/api/content/unlock',None,{'key':'fk_real-research-key'})
        assert seen[-1][0] == '/api/content/logout'
        assert b'fk_real-research-key' not in (tmp_path/'accounts.sqlite').read_bytes()
        assert b'research-temporary-session' not in (tmp_path/'accounts.sqlite').read_bytes()
    finally:
        news.shutdown();news.server_close();news_thread.join(timeout=5)
        research.shutdown();research.server_close();research_thread.join(timeout=5)


def test_import_preserves_existing_content_and_unique_source(tmp_path):
    accounts = Accounts(tmp_path)
    first = accounts.create('one@example.com','original-password')
    second = accounts.create('two@example.com','original-password')
    sections = {'authors':{'authors':[],'customTags':[]},'impression':{'text':'A'},'inbox':[]}
    accounts.personal(first,'authors',{'authors':[{'name':'Local'}],'customTags':[]})
    with pytest.raises(AccountError) as error:
        accounts.import_research_snapshot(first,'research-1','key-1',sections)
    assert error.value.status == 409
    assert accounts.personal(first,'authors')['authors'][0]['name'] == 'Local'
    assert accounts.personal(first,'impression') is None
    accounts.import_research_snapshot(first,'research-1','key-1',sections,replace=True)
    with pytest.raises(AccountError) as error:
        accounts.import_research_snapshot(second,'research-1','key-1',sections)
    assert error.value.status == 409
    assert accounts.personal(second,'authors') is None


def test_research_import_rejects_redirect_and_insecure_remote():
    with pytest.raises(ValueError):
        ResearchImporter('http://research.example')
    class RedirectSession:
        trust_env = False
        def request(self,*args,**kwargs):
            assert kwargs['allow_redirects'] is False
            class Response:
                status_code = 302
                def __enter__(self): return self
                def __exit__(self,*args): pass
            return Response()
    importer = ResearchImporter('https://research.example',RedirectSession())
    with pytest.raises(AccountError) as error:
        importer.snapshot('fk_secret-key')
    assert error.value.status == 502


def test_actual_research_server_snapshot_survives_disconnection(tmp_path):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node.js unavailable')
    entry = Path(__file__).resolve().parents[2] / 'FastResearch' / 'server' / 'index.mjs'
    if not entry.exists():
        pytest.skip('FastResearch checkout unavailable')
    research_dir = tmp_path / 'research'
    research_dir.mkdir()
    env = {**os.environ,'PORT':'0','HOST':'127.0.0.1','FASTRESEARCH_DATA_DIR':str(research_dir),
        'FASTRESEARCH_ACCOUNT_DATABASE':str(research_dir/'accounts.sqlite'),
        'ADMIN_USERNAME':'test-admin','ADMIN_PASSWORD':'test-admin-password'}
    process = subprocess.Popen([node,str(entry)],cwd=research_dir,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
    try:
        origin = None
        deadline = time.monotonic()+15
        while time.monotonic()<deadline and process.poll() is None:
            if not select.select([process.stdout],[],[],0.2)[0]:
                continue
            line = process.stdout.readline()
            match = re.search(r'listening on (http://[^\s]+)',line)
            if match:
                origin = match.group(1)
                break
        assert origin, 'FastResearch did not start'
        with httpx.Client(base_url=origin) as client:
            admin = client.post('/api/admin/login',json={'username':'test-admin','password':'test-admin-password'}).json()['session']
            made = client.post('/api/admin/keys',json={'person':'Reader'},headers={'Authorization':'Bearer '+admin})
            assert made.status_code == 201
            key = made.json()['key']
            opened = client.post('/api/content/unlock',json={'key':key}).json()
            token = opened['session']
            headers = {'Authorization':'Bearer '+token}
            assert client.put('/api/content/authors',json={'authors':[{'name':'Alice'}],'customTags':['security']},headers=headers).status_code == 200
            assert client.put('/api/content/impression',json={'text':'Original research'},headers=headers).status_code == 200
            assert client.put('/api/content/inbox',json={'items':[{'id':'paper-1','date':'2026-09-22','kind':'daily-paper','title':'Paper','read':False}]},headers=headers).status_code == 200
        importer = ResearchImporter(origin)
        account_id,key_id,sections = importer.snapshot(key)
        assert account_id == opened['accountId'] and key_id == opened['keyId']
        assert sections['authors']['authors'][0]['name'] == 'Alice'
        accounts = Accounts(tmp_path/'news')
        user = accounts.create('reader@example.com','original-password')
        accounts.import_research_snapshot(user,account_id,key_id,sections)
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill();process.wait(timeout=5)
        process.stdout.close()
    assert accounts.personal(user,'impression')['text'] == 'Original research'
    assert accounts.personal(user,'inbox')[0]['id'] == 'paper-1'
    assert key.encode() not in (tmp_path/'news'/'accounts.sqlite').read_bytes()
