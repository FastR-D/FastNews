"""Real Chrome -> FastNews account page -> FastCAS/PostgreSQL contract."""
import os
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastnews_accounts import Accounts
from fastnews_cas import CASService
from generate_homepage import render_homepage
from serve import FastNewsHandler

issuer = os.environ['FASTCAS_CONTRACT_ISSUER']
origin = os.environ['FASTCAS_CONTRACT_NEWS_ORIGIN']
root = Path(__file__).resolve().parents[1]
os.environ.update(FASTNEWS_COOKIE_SECURE='false', FASTNEWS_PUBLIC_ORIGIN=origin, FASTNEWS_PUBLIC_PATH='')

with tempfile.TemporaryDirectory() as temp:
    site = Path(temp)
    shutil.copytree(root / 'assets', site / 'assets')
    (site / 'top-conf').mkdir()
    (site / 'secnews').mkdir()
    previous_cwd = Path.cwd()
    try:
        os.chdir(site)
        render_homepage(Path('index.html'))
    finally:
        os.chdir(previous_cwd)
    os.environ['FASTNEWS_ROOT'] = temp
    server = ThreadingHTTPServer(('127.0.0.1', urlparse(origin).port), FastNewsHandler)
    accounts = server.accounts = Accounts(temp)
    user = accounts.create('alice@example.test', 'original-local-password')
    accounts.personal(user, 'impression', {'text': 'Browser preserved research notes', 'updatedAt': '2026-09-23'})
    env = {'FASTNEWS_FASTCAS_' + key: value for key, value in dict(
        ISSUER=issuer, CLIENT_ID='news', CLIENT_SECRET='integration-client-secret-32-characters-long',
        REDIRECT_URI=origin + '/api/auth/fastcas/callback', ALLOW_LOOPBACK_HTTP='true',
    ).items()}
    server.cas = CASService(accounts, env=env)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                if httpx.get(origin + '/api/auth/fastcas/available', timeout=.5).status_code == 200:
                    break
            except httpx.TransportError:
                time.sleep(.05)
        else:
            raise AssertionError('FastNews browser server startup timeout')
        subprocess.run(['node', str(root.parent / 'FastCAS' / 'web' / 'tests' / 'fastnews_contract.mjs')],
                       env=os.environ, check=True, timeout=70)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        if server.cas._sdk:
            server.cas._sdk.close()
