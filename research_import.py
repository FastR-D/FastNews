"""Explicit, one-time Research Key proof and personal-content snapshot import.

The Key and the temporary Research session are never stored by FastNews.
"""
import json
import os
from urllib.parse import urlparse

import requests

from fastnews_accounts import AccountError


class ResearchImporter:
    def __init__(self, base_url=None, client=None):
        self.base_url = (base_url or os.environ.get('FASTRESEARCH_API_URL','http://127.0.0.1:8787')).rstrip('/')
        parsed = urlparse(self.base_url)
        if parsed.path or parsed.query or parsed.fragment or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('FastResearch API URL must be an origin')
        if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in {'127.0.0.1','localhost','::1'}):
            raise ValueError('FastResearch API requires HTTPS outside loopback')
        self._owns_client = client is None
        self.client = client or requests.Session()
        self.client.trust_env = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        if self._owns_client:
            self.client.close()

    def request(self, method, path, *, data=None, token=''):
        headers = {'Accept':'application/json'}
        if token:
            headers['Authorization'] = 'Bearer '+token
        try:
            with self.client.request(method,self.base_url+path,json=data,headers=headers,timeout=10,allow_redirects=False,stream=True) as response:
                if response.status_code != 200:
                    raise AccountError('Research 认证或内容读取失败',401 if response.status_code in {401,403} else 502)
                raw = bytearray()
                for chunk in response.iter_content(64*1024):
                    raw.extend(chunk)
                    if len(raw)>1024*1024:
                        raise AccountError('Research 内容过大',413)
                result = json.loads(raw)
                if not isinstance(result,dict):
                    raise ValueError('invalid JSON object')
                return result
        except requests.RequestException:
            raise AccountError('无法连接 FastResearch',503) from None
        except ValueError:
            raise AccountError('Research 返回内容无效',502) from None

    def snapshot(self, key):
        if not isinstance(key,str) or not 8 <= len(key) <= 256:
            raise AccountError('请输入有效 Research Key',400)
        proof = self.request('POST','/api/content/unlock',data={'key':key})
        token = proof.get('session')
        account_id = proof.get('accountId')
        key_id = proof.get('keyId')
        if not all(isinstance(value,str) and value for value in (token,account_id,key_id)):
            raise AccountError('Research 身份证明不完整',502)
        try:
            me = self.request('GET','/api/content/me',token=token)
            if me.get('accountId') != account_id or me.get('keyId') != key_id:
                raise AccountError('Research 身份在读取期间发生变化',409)
            authors = self.request('GET','/api/content/authors',token=token)
            impression = self.request('GET','/api/content/impression',token=token)
            inbox = self.request('GET','/api/content/inbox',token=token)
            return account_id,key_id,{
                'authors':{'authors':authors.get('authors'),'customTags':authors.get('customTags')},
                'impression':impression.get('impression'),
                'inbox':inbox.get('items'),
            }
        finally:
            try:
                self.request('POST','/api/content/logout',data={},token=token)
            except AccountError:
                pass
