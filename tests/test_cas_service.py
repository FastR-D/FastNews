import pytest
import base64
import os
from fastnews_accounts import Accounts, AccountError
from fastnews_cas import CASService


def test_existing_account_login_and_revoke_without_local_dependency(tmp_path):
    accounts = Accounts(tmp_path)
    user = accounts.create('reader@example.com','original-password')
    local, _ = accounts.login('reader@example.com','original-password','peer')
    class SDK:
        link = dict(id='link',client_id='news',subject='subject',local_account_ref=user,state='active',version=2)
        def get_link(self, _): return self.link.copy()
        def resolve_link(self, _): return self.link.copy()
    sdk = SDK()
    env = {'FASTNEWS_FASTCAS_'+key:value for key,value in dict(ISSUER='https://cas.example',CLIENT_ID='news',CLIENT_SECRET='secret',REDIRECT_URI='https://news.example/callback').items()}
    service = CASService(accounts,sdk,env)
    service.store.save(sdk.link)
    with pytest.raises(AccountError): service.prove(local,'wrong','peer')
    cas = service.issue(sdk.link,{'issuer':'https://cas.example','subject':'subject'})
    assert accounts.session(cas)['user_id'] == user
    service.validate_session(accounts.session(cas))
    sdk.link = {**sdk.link,'state':'revoked','version':3}
    service.revoke(local,'original-password','peer')
    assert accounts.session(local) and accounts.session(cas) is None
    with pytest.raises(AccountError): service.accept({**sdk.link,'state':'active','version':2})
    disabled = CASService(accounts,env={})
    assert not disabled.enabled
    with pytest.raises(AccountError): _ = disabled.sdk


def test_delegated_research_vault_refresh_and_session_isolation(tmp_path, monkeypatch):
    accounts = Accounts(tmp_path)
    user = accounts.create('reader@example.com','original-password')
    local, _ = accounts.login('reader@example.com','original-password','peer')
    link = dict(id='link',client_id='news',subject='subject',local_account_ref=user,state='active',version=2)
    class SDK:
        refreshed = 0
        def verify_access_token(self, raw, audience, scopes):
            assert raw in {'source-access','rotated-access'}
            assert audience == 'news' and scopes == ['research:read']
            return {'sub':'subject','service':False}
        def exchange_token(self, raw, audience, scopes):
            assert raw in {'source-access','rotated-access'}
            assert audience == 'research-api' and scopes == ['research:read']
            return {'access_token':'delegated-access'}
        def refresh(self, raw):
            assert raw == 'source-refresh'
            self.refreshed += 1
            return {'access_token':'rotated-access','refresh_token':'rotated-refresh','expires_in':300}
    sdk = SDK()
    values = dict(ISSUER='https://cas.example',CLIENT_ID='news',CLIENT_SECRET='secret',REDIRECT_URI='https://news.example/callback',
        RESEARCH_CONNECT='true',VAULT_KEY=base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('='))
    env = {'FASTNEWS_FASTCAS_'+key:value for key,value in values.items()}
    service = CASService(accounts,sdk,env)
    service.store.save(link)
    from research_import import ResearchImporter
    monkeypatch.setattr(ResearchImporter,'request',lambda self,method,path,**kwargs: (
        {'researchAccountId':'research-account','authors':[],'customTags':[],'impression':{'text':''},'inbox':[]}
        if method=='GET' and path=='/api/connectors/news/profile' and kwargs['token']=='delegated-access' else pytest.fail('wrong Research request')))
    cas = service.issue(link,{'issuer':'https://cas.example','subject':'subject'},
        {'access_token':'source-access','refresh_token':'source-refresh','expires_in':300})
    assert service.delegated_research_profile(cas)['researchAccountId']=='research-account'
    assert sdk.refreshed == 0
    with accounts.connect(True) as db:
        db.execute('UPDATE cas_token_vault SET access_expires=0 WHERE session_hash=?',(accounts.session(cas)['hash'],))
    assert service.delegated_research_profile(cas)['researchAccountId']=='research-account'
    assert sdk.refreshed == 1
    stored = (tmp_path/'accounts.sqlite').read_bytes()
    assert b'source-refresh' not in stored and b'rotated-refresh' not in stored and b'source-access' not in stored
    with pytest.raises(AccountError): service.delegated_research_profile(local)
    service.store.apply_verified_logout({'id':'logout-1','subject':'subject'})
    assert accounts.session(local) is not None
    with accounts.connect() as db:
        assert db.execute('SELECT count(*) FROM cas_token_vault').fetchone()[0] == 0
    with pytest.raises(AccountError): service.delegated_research_profile(cas)


def test_connector_requires_distinct_vault_key(tmp_path):
    accounts = Accounts(tmp_path)
    env = {'FASTNEWS_FASTCAS_'+key:value for key,value in dict(ISSUER='https://cas.example',CLIENT_ID='news',CLIENT_SECRET='secret',REDIRECT_URI='https://news.example/callback',RESEARCH_CONNECT='true').items()}
    with pytest.raises(ValueError): CASService(accounts,env=env)
