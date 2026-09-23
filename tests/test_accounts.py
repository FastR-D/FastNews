from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
import inbox_push
from fastnews_accounts import Accounts, AccountError


def test_independent_login_recovery_and_personal_isolation(tmp_path):
    accounts = Accounts(tmp_path)
    first = accounts.create('one@example.com', 'original-password')
    second = accounts.create('two@example.com', 'original-password')
    accounts.personal(first, 'authors', ['Original author'])
    assert accounts.personal(second, 'authors') is None
    session, _ = accounts.login('one@example.com', 'original-password', 'peer')
    recovery = accounts.issue('recovery', 'one@example.com')
    assert accounts.redeem('recovery', recovery, 'replacement-password', 'peer') == first
    assert accounts.session(session) is None
    assert accounts.personal(first, 'authors') == ['Original author']
    renewed, _ = accounts.login('one@example.com', 'replacement-password', 'peer')
    assert accounts.session(renewed)['user_id'] == first
    accounts.logout(renewed)
    assert accounts.session(renewed) is None
    with pytest.raises(AccountError):
        accounts.redeem('recovery', recovery, 'replacement-password', 'peer')


def test_invitation_single_use_across_threads_and_restart(tmp_path):
    accounts = Accounts(tmp_path)
    invitation = accounts.issue('invite', 'new@example.com')
    def consume(_):
        try:
            return Accounts(tmp_path).redeem('invite', invitation, 'original-password', 'peer')
        except AccountError:
            return None
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(consume, range(4)))
    assert len([value for value in results if value]) == 1
    raw, _ = Accounts(tmp_path).login('new@example.com', 'original-password', 'peer')
    assert Accounts(tmp_path).session(raw)['source'] == 'local'


def test_disabled_users_and_failed_login_rate_limit(tmp_path):
    accounts = Accounts(tmp_path)
    user = accounts.create('one@example.com', 'original-password')
    raw, _ = accounts.login('one@example.com', 'original-password', 'peer')
    with accounts.connect(True) as db:
        db.execute("UPDATE users SET status='disabled' WHERE id=?", (user,))
    assert accounts.session(raw) is None
    for _ in range(12):
        with pytest.raises(AccountError) as error:
            accounts.login('one@example.com', 'original-password', 'peer')
        assert error.value.status == 401
    with pytest.raises(AccountError) as error:
        accounts.login('one@example.com', 'original-password', 'peer')
    assert error.value.status == 429


def test_daily_inbox_insert_once_across_account_instances(tmp_path):
    first = Accounts(tmp_path)
    second = Accounts(tmp_path)
    user = first.create('one@example.com', 'original-password')
    barrier = Barrier(2)
    today = inbox_push.shanghai_today()

    def generate(index):
        def run(items):
            assert items == []
            barrier.wait(timeout=5)
            return {'id':f'daily-{index}','date':today,'kind':'daily-paper','read':False}, True
        return run

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(account.daily_inbox,user,generate(index)) for index,account in enumerate((first,second))]
        results = [future.result() for future in futures]
    assert sum(inserted for _,inserted in results) == 1
    assert len(first.personal(user,'inbox')) == 1
    assert first.daily_inbox(user,lambda _: pytest.fail('generated twice'))[1] is False
