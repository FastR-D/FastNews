"""Optional FastCAS login and user-confirmed binding of existing local accounts."""
import json
import os
import secrets
import threading
import time

from werkzeug.security import check_password_hash
from fastnews_accounts import AccountError, digest
from fastnews_cas_store import CASStore


class CASService:
    def __init__(self, accounts, sdk=None, env=None):
        env = os.environ if env is None else env
        self.accounts, self._sdk, self._lock = accounts, sdk, threading.Lock()
        self.config = {key:env.get('FASTNEWS_FASTCAS_'+key.upper(),'') for key in ('issuer','client_id','client_secret','redirect_uri')}
        self.enabled = all(self.config.values())
        if any(self.config.values()) and not self.enabled:
            raise ValueError('FastCAS requires all four connection settings')
        self.development = env.get('FASTNEWS_FASTCAS_ALLOW_LOOPBACK_HTTP') == 'true'
        self.store = CASStore(accounts,self.config['issuer'],self.config['client_id'])
        self.research_enabled = env.get('FASTNEWS_FASTCAS_RESEARCH_CONNECT') == 'true'
        self.research_url = env.get('FASTRESEARCH_API_URL','')
        if self.research_enabled:
            if not self.enabled:
                raise ValueError('Research connector requires FastCAS configuration')
            from fastnews_cas_vault import CASTokenVault
            from research_import import ResearchImporter
            with ResearchImporter(self.research_url):
                pass
            self.vault = CASTokenVault(accounts,env.get('FASTNEWS_FASTCAS_VAULT_KEY',''),self.config['issuer'],self.config['client_id'])
        else:
            self.vault = None

    @property
    def sdk(self):
        if not self.enabled:
            raise AccountError('未启用 FastCAS',404)
        with self._lock:
            if self._sdk is None:
                from fastcas import Configuration, FastCAS
                self._sdk = FastCAS(Configuration(**self.config,allow_loopback_http=self.development),self.store)
        return self._sdk

    def prove(self, raw, password, peer):
        self.accounts.limit('cas-proof',peer)
        session = self.accounts.session(raw)
        with self.accounts.connect() as db:
            user = db.execute("SELECT * FROM users WHERE id=? AND status='active'",(session['user_id'],)).fetchone() if session else None
        if not user or not isinstance(password,str) or len(password)>256 or not check_password_hash(user['password'],password):
            raise AccountError('请验证当前账号的本地密码',403)
        return session

    def begin_link(self, binding, raw, password, peer):
        session = self.prove(raw,password,peer)
        return self.sdk.begin_link(binding,local_account_ref=session['user_id'],local_session_id=session['hash'])

    def begin_login(self, binding):
        scopes = ['openid','profile','email','offline_access','research:read'] if self.research_enabled else None
        return self.sdk.begin_login(binding,scopes=scopes)

    @staticmethod
    def same_identity(left, right):
        return all(left[key] == right[key] for key in ('id','client_id','subject','local_account_ref'))

    def accept(self, remote):
        if remote['state'] == 'revoked':
            self.store.apply_verified_event(dict(id='reconcile:'+remote['id']+':'+str(remote['version']),type='account_link.revoked',link=remote))
        else:
            self.store.save(remote)
        with self.accounts.connect() as db:
            actual = db.execute('SELECT state,version FROM cas_links WHERE issuer=? AND id=?',(self.config['issuer'],remote['id'])).fetchone()
            if not actual or actual['state'] != remote['state'] or actual['version'] != remote['version']:
                raise AccountError('认证状态已更改，请刷新后重试',409)

    def reconcile(self, user_id):
        local = self.store.current(user_id)
        if not local:
            raise AccountError('没有待处理的认证',404)
        remote = self.sdk.get_link(local['id'])
        if not self.same_identity(local,remote):
            raise AccountError('认证关系不匹配',403)
        if remote['state'] == 'prepared':
            remote = self.sdk.activate_link(remote['id'])
        self.accept(remote)
        return remote

    def finish(self, callback, binding, raw):
        session = self.accounts.session(raw)
        result = self.sdk.finish_login(callback,binding,local_account_ref=session['user_id'] if session else '',local_session_id=session['hash'] if session else '')
        if result['transaction']['purpose'] == 'link':
            link = self.sdk.prepare_link(result)
            with self.accounts.connect(True) as db:
                live = db.execute("SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>? AND u.status='active'",(session['hash'],time.time())).fetchone() if session else None
                if not live or live['user_id'] != link['local_account_ref']:
                    raise AccountError('原登录会话已失效',401)
                self.store.save_in_transaction(db,link)
            self.accept(self.sdk.activate_link(link['id']))
            return None
        if result['transaction']['purpose'] != 'login':
            raise AccountError('请先按项目邀请注册账号',403)
        local = self.store.subject(result['identity']['subject'])
        if not local:
            raise AccountError('尚未绑定本地账号，请先使用原方式登录并认证',409)
        if local['state'] == 'prepared':
            self.reconcile(local['local_account_ref'])
        return self.issue(self.sdk.resolve_link(result['identity']['subject']),result['identity'],result['tokens'])

    def issue(self, link, identity, tokens=None):
        self.store.validate(link)
        if identity['issuer'] != self.config['issuer'] or identity['subject'] != link['subject'] or link['state'] != 'active':
            raise AccountError('认证关系无效',403)
        with self.accounts.connect(True) as db:
            row = db.execute('SELECT * FROM cas_links WHERE issuer=? AND id=?',(self.config['issuer'],link['id'])).fetchone()
            user = db.execute("SELECT id FROM users WHERE id=? AND status='active'",(link['local_account_ref'],)).fetchone()
            if not row or not user or row['state'] != 'active' or row['version'] != link['version'] or not self.same_identity(json.loads(row['payload']),link):
                raise AccountError('本地账号或认证关系不可用',403)
            raw,now = secrets.token_urlsafe(32),time.time()
            provider = {'issuer':self.config['issuer'],'sid':identity.get('sid'),'link_id':link['id'],'link_version':link['version'],'checked':now}
            db.execute('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)',(digest(raw),user['id'],secrets.token_urlsafe(32),now+7*86400,'fastcas',now,json.dumps(provider)))
            if self.vault and tokens:
                self.vault.save(db,raw,identity['subject'],tokens)
            return raw

    def delegated_research_profile(self, raw):
        if not self.research_enabled:
            raise AccountError('未启用 FastCAS Research 连接',404)
        current = self.accounts.session(raw)
        if not current or current['source'] != 'fastcas':
            raise AccountError('请先使用 FastCAS 登录',401)
        self.validate_session(current)
        link = self.store.current(current['user_id'])
        if not link or link['state'] != 'active':
            raise AccountError('FastCAS 认证已失效',401)
        source = self.vault.access(raw,link['subject'],self.sdk)
        try:
            claims = self.sdk.verify_access_token(source,self.config['client_id'],['research:read'])
        except Exception:
            raise AccountError('FastCAS 授权已失效，请重新登录',401) from None
        if claims.get('sub') != link['subject'] or claims.get('service') is True:
            raise AccountError('FastCAS 授权身份不匹配',401)
        try:
            delegated = self.sdk.exchange_token(source,'research-api',['research:read'])
        except Exception:
            raise AccountError('FastCAS 尚未授权访问 Research',403) from None
        if not isinstance(delegated.get('access_token'),str) or not delegated['access_token']:
            raise AccountError('FastCAS 委托响应无效',502)
        from research_import import ResearchImporter
        with ResearchImporter(self.research_url) as importer:
            profile = importer.request('GET','/api/connectors/news/profile',token=delegated['access_token'])
        if not isinstance(profile.get('researchAccountId'),str) or not profile['researchAccountId']:
            raise AccountError('Research 连接返回内容无效',502)
        return profile

    def revoke(self, raw, password, peer):
        session = self.prove(raw,password,peer)
        local = self.store.current(session['user_id'])
        if not local:
            return
        remote = self.sdk.get_link(local['id'])
        if not self.same_identity(local,remote):
            raise AccountError('认证关系不匹配',403)
        self.accept(remote if remote['state']=='revoked' else self.sdk.revoke_link(remote))

    def validate_session(self, session):
        if session['source'] != 'fastcas':
            return
        provider = json.loads(session['provider'])
        local = self.store.current(session['user_id'])
        if not self.enabled or provider.get('issuer') != self.config['issuer'] or not local or local['id'] != provider.get('link_id') or local['version'] != provider.get('link_version') or local['state'] != 'active':
            raise AccountError('FastCAS 会话已失效，请使用本地登录',401)
        if provider.get('checked',0)+300 > time.time():
            return
        try:
            remote = self.sdk.resolve_link(local['subject'])
        except Exception:
            raise AccountError('无法确认 FastCAS 认证，请使用本地登录',401) from None
        if not self.same_identity(local,remote) or remote['state'] != 'active' or remote['version'] != local['version']:
            raise AccountError('FastCAS 认证已更改',401)
        with self.accounts.connect(True) as db:
            updated = db.execute("""UPDATE sessions SET provider=json_set(provider,'$.checked',?) WHERE hash=? AND expires>?
                AND EXISTS(SELECT 1 FROM cas_links l WHERE l.issuer=? AND l.id=? AND l.state='active' AND l.version=?)""",
                (time.time(),session['hash'],time.time(),self.config['issuer'],local['id'],local['version']))
            if not updated.rowcount:
                raise AccountError('会话已失效',401)
