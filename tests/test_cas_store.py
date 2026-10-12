import json
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastnews_accounts import Accounts, digest
from fastnews_cas_store import CASStore


def test_atomic_transactions_and_revocation(tmp_path):
    accounts = Accounts(tmp_path)
    user = accounts.create('reader@example.com','original-password')
    local, _ = accounts.login('reader@example.com','original-password','peer')
    store = CASStore(accounts,'https://cas.example','news')
    store.put({'state':'single','expires_at':time.time()+300,'verifier':'private'})
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: CASStore(Accounts(tmp_path),store.issuer,store.client_id).take('single'),range(4)))
    assert sum(result is not None for result in results) == 1
    link = dict(id='old',client_id='news',local_account_ref=user,subject='subject',state='active',version=2)
    store.save(link)
    with accounts.connect(True) as db:
        db.execute('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)',(digest('cas-session'),user,'csrf',time.time()+300,'fastcas',time.time(),json.dumps({'issuer':store.issuer,'link_id':'old','link_version':2})))
        db.execute("CREATE TRIGGER reject_event BEFORE INSERT ON cas_events BEGIN SELECT RAISE(ABORT,'injected'); END")
    event = dict(id='event',type='account_link.revoked',link={**link,'state':'revoked','version':3})
    with pytest.raises(Exception,match='injected'):
        store.apply_verified_event(event)
    assert accounts.session('cas-session')
    assert store.current(user)['state'] == 'active'
    with accounts.connect(True) as db:
        db.execute('DROP TRIGGER reject_event')
    store.apply_verified_event(event)
    store.apply_verified_event(event)
    assert accounts.session('cas-session') is None
    assert accounts.session(local)
    store.save(link)
    assert store.current(user) is None
    store.save({**link,'id':'new'})
    store.apply_verified_event({**event,'id':'late-event'})
    assert store.current(user)['id'] == 'new'


def test_logout_is_atomic_sid_scoped_and_preserves_local_login(tmp_path):
    accounts = Accounts(tmp_path)
    user = accounts.create('reader@example.com','original-password')
    local, _ = accounts.login('reader@example.com','original-password','peer')
    store = CASStore(accounts,'https://cas.example','news')
    store.save(dict(id='link',client_id='news',local_account_ref=user,subject='subject',state='active',version=2))
    with accounts.connect(True) as db:
        for raw, sid in [('cas-a','sid-a'),('cas-b','sid-b')]:
            provider = json.dumps({'issuer':store.issuer,'link_id':'link','link_version':2,'sid':sid})
            db.execute('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)',(digest(raw),user,'csrf',time.time()+300,'fastcas',time.time(),provider))
        db.execute("CREATE TRIGGER reject_logout BEFORE INSERT ON cas_events BEGIN SELECT RAISE(ABORT,'injected'); END")
    with pytest.raises(Exception,match='injected'):
        store.apply_verified_logout(dict(id='logout-a',subject='subject',sid='sid-a'))
    assert accounts.session('cas-a')
    with accounts.connect(True) as db:
        db.execute('DROP TRIGGER reject_logout')
    store.apply_verified_logout(dict(id='logout-a',subject='subject',sid='sid-a'))
    store.apply_verified_logout(dict(id='logout-a',subject='subject',sid='sid-a'))
    assert accounts.session('cas-a') is None
    assert accounts.session('cas-b')
    store.apply_verified_logout(dict(id='logout-all',subject='subject',sid=None))
    assert accounts.session('cas-b') is None
    assert accounts.session(local)
