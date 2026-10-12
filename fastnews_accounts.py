"""Local FastNews identities and personal content, independent of Research/CAS."""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from werkzeug.security import check_password_hash, generate_password_hash

_METHOD = 'scrypt:32768:8:1'
_DUMMY = generate_password_hash(secrets.token_urlsafe(32), method=_METHOD)


class AccountError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def email_address(value):
    value = value.strip().lower()
    if len(value) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
        raise AccountError('请输入有效邮箱')
    return value


def password_hash(value):
    if not 12 <= len(value) <= 256:
        raise AccountError('密码需要 12–256 个字符')
    return generate_password_hash(value, method=_METHOD)


class Accounts:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.root / 'accounts.sqlite'
        descriptor = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(descriptor)
        self.path.chmod(0o600)
        self._inbox_lock = threading.Lock()
        self._inbox_user_locks = {}
        with self.connect() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active');
                CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires REAL NOT NULL,source TEXT NOT NULL,authenticated REAL NOT NULL,provider TEXT NOT NULL DEFAULT '{}');
                CREATE TABLE IF NOT EXISTS credentials(hash TEXT PRIMARY KEY,kind TEXT NOT NULL,email TEXT NOT NULL,user_id TEXT REFERENCES users(id),expires REAL NOT NULL,consumed REAL);
                CREATE TABLE IF NOT EXISTS limits(id TEXT PRIMARY KEY,attempts INTEGER NOT NULL,expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS personal(user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,content TEXT NOT NULL,PRIMARY KEY(user_id,kind));
                CREATE TABLE IF NOT EXISTS research_connections(user_id TEXT PRIMARY KEY REFERENCES users(id),research_account_id TEXT NOT NULL UNIQUE,key_id TEXT NOT NULL,imported REAL NOT NULL,snapshot_hash TEXT NOT NULL,counts TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,user_id TEXT,action TEXT NOT NULL,created REAL NOT NULL);
            ''')

    @contextmanager
    def connect(self, write=False):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            if write:
                db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def create(self, email, password, name=''):
        email, encoded = email_address(email), password_hash(password)
        user_id = str(uuid.uuid4())
        try:
            with self.connect(True) as db:
                db.execute('INSERT INTO users(id,email,password,name) VALUES(?,?,?,?)', (user_id, email, encoded, name[:80] or email))
        except sqlite3.IntegrityError:
            raise AccountError('账号已存在', 409) from None
        return user_id

    def limit(self, action, peer, maximum=12):
        now, key = time.time(), digest(action+':'+peer)
        with self.connect(True) as db:
            row = db.execute('SELECT * FROM limits WHERE id=?', (key,)).fetchone()
            attempts = row['attempts']+1 if row and row['expires'] > now else 1
            expires = row['expires'] if row and row['expires'] > now else now+900
            db.execute('INSERT OR REPLACE INTO limits VALUES(?,?,?)', (key, attempts, expires))
        if attempts > maximum:
            raise AccountError('操作频繁，请稍后重试', 429)

    def login(self, email, password, peer):
        email = email_address(email)
        self.limit('login:'+email, peer)
        if len(password) > 256:
            raise AccountError('邮箱或密码错误', 401)
        with self.connect() as db:
            row = db.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
        if not check_password_hash(row['password'] if row else _DUMMY, password) or not row or row['status'] != 'active':
            raise AccountError('邮箱或密码错误', 401)
        raw, csrf, now = secrets.token_urlsafe(32), secrets.token_urlsafe(32), time.time()
        with self.connect(True) as db:
            # Password recovery/disable may race the expensive password check.
            current = db.execute('SELECT password,status FROM users WHERE id=?', (row['id'],)).fetchone()
            if not current or current['status'] != 'active' or current['password'] != row['password']:
                raise AccountError('账号状态已更改，请重新登录', 401)
            db.execute('DELETE FROM limits WHERE id=?', (digest('login:'+email+':'+peer),))
            db.execute('DELETE FROM sessions WHERE expires<=?', (now,))
            db.execute('INSERT INTO sessions(hash,user_id,csrf,expires,source,authenticated) VALUES(?,?,?,?,?,?)', (digest(raw), row['id'], csrf, now+7*86400, 'local', now))
        return raw, csrf

    def session(self, raw):
        with self.connect() as db:
            row = db.execute('''SELECT s.*,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id
                WHERE s.hash=? AND s.expires>? AND u.status='active' ''', (digest(raw), time.time())).fetchone()
            return dict(row) if row else None

    def logout(self, raw):
        with self.connect(True) as db:
            db.execute('DELETE FROM sessions WHERE hash=?', (digest(raw),))

    def issue(self, kind, email):
        """Offline administrator operation. Never expose token issuance publicly."""
        email = email_address(email)
        if kind not in {'invite','recovery'}:
            raise AccountError('凭证类型无效')
        raw, now = secrets.token_urlsafe(32), time.time()
        with self.connect(True) as db:
            user = db.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
            if (kind == 'invite' and user) or (kind == 'recovery' and (not user or user['status'] != 'active')):
                raise AccountError('账号不符合凭证条件', 409)
            db.execute('UPDATE credentials SET consumed=? WHERE kind=? AND email=? AND consumed IS NULL', (now, kind, email))
            db.execute('INSERT INTO credentials VALUES(?,?,?,?,?,NULL)', (digest(raw),kind,email,user['id'] if user else None,now+3600))
        return raw

    def redeem(self, kind, raw, password, peer):
        self.limit('redeem', peer)
        if kind not in {'invite','recovery'} or not 32 <= len(raw) <= 256:
            raise AccountError('凭证无效或已过期')
        encoded, now = password_hash(password), time.time()
        try:
            with self.connect(True) as db:
                row = db.execute('SELECT * FROM credentials WHERE hash=? AND kind=? AND expires>? AND consumed IS NULL', (digest(raw),kind,now)).fetchone()
                if not row:
                    raise AccountError('凭证无效或已过期')
                user_id = row['user_id']
                if kind == 'invite':
                    user_id = str(uuid.uuid4())
                    db.execute('INSERT INTO users(id,email,password,name) VALUES(?,?,?,?)', (user_id,row['email'],encoded,row['email']))
                else:
                    changed = db.execute("UPDATE users SET password=? WHERE id=? AND email=? AND status='active'", (encoded,user_id,row['email']))
                    if not changed.rowcount:
                        raise AccountError('凭证无效或已过期')
                    db.execute('DELETE FROM sessions WHERE user_id=?', (user_id,))
                db.execute('UPDATE credentials SET consumed=? WHERE hash=?', (now,digest(raw)))
                db.execute('INSERT INTO audit VALUES(?,?,?,?)', (str(uuid.uuid4()),user_id,'account.'+kind,now))
        except sqlite3.IntegrityError:
            raise AccountError('账号已存在',409) from None
        return user_id

    def personal(self, user_id, kind, value=None):
        if kind not in {'authors','impression','inbox','settings'}:
            raise AccountError('个人资料类型无效')
        with self.connect(write=value is not None) as db:
            if not db.execute("SELECT 1 FROM users WHERE id=? AND status='active'", (user_id,)).fetchone():
                raise AccountError('账号不可用',401)
            if value is not None:
                encoded = json.dumps(value,ensure_ascii=False)
                if len(encoded.encode()) > 256*1024:
                    raise AccountError('个人资料过大',413)
                db.execute('INSERT INTO personal VALUES(?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET content=excluded.content', (user_id,kind,encoded))
            row = db.execute('SELECT content FROM personal WHERE user_id=? AND kind=?', (user_id,kind)).fetchone()
            return json.loads(row['content']) if row else None

    def update_personal(self, user_id, kind, transform):
        if kind not in {'authors','impression','inbox','settings'}:
            raise AccountError('个人资料类型无效')
        with self.connect(True) as db:
            if not db.execute("SELECT 1 FROM users WHERE id=? AND status='active'", (user_id,)).fetchone():
                raise AccountError('账号不可用',401)
            previous = db.execute('SELECT content FROM personal WHERE user_id=? AND kind=?', (user_id,kind)).fetchone()
            value = transform(json.loads(previous['content']) if previous else None)
            encoded = json.dumps(value,ensure_ascii=False)
            if len(encoded.encode())>256*1024:
                raise AccountError('个人资料过大',413)
            db.execute('INSERT INTO personal VALUES(?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET content=excluded.content', (user_id,kind,encoded))
            return value

    def daily_inbox(self, user_id, generate):
        """Generate outside SQLite's write transaction, then insert once per day.

        A per-account lock avoids repeated expensive generation in one process.
        The transactional second check also prevents duplicate writes across
        FastNews processes sharing the same SQLite database.
        """
        import inbox_push
        with self._inbox_lock:
            lock = self._inbox_user_locks.setdefault(user_id, threading.Lock())
        with lock:
            items = self.personal(user_id, 'inbox') or []
            if inbox_push.find_today_item(items):
                return items, False
            item, created = generate(items)
            if not created or not item:
                return items, False
            inserted = False
            def merge(current):
                nonlocal inserted
                current = current or []
                if inbox_push.find_today_item(current):
                    return current
                inserted = True
                return [item, *current][:inbox_push.MAX_INBOX]
            return self.update_personal(user_id, 'inbox', merge), inserted

    def research_connection(self, user_id):
        with self.connect() as db:
            row = db.execute('SELECT research_account_id,key_id,imported,snapshot_hash,counts FROM research_connections WHERE user_id=?',(user_id,)).fetchone()
            return {**dict(row),'counts':json.loads(row['counts'])} if row else None

    def import_research_snapshot(self, user_id, research_account_id, key_id, sections, replace=False):
        """Copy a proven Research account snapshot atomically; store no Research secret."""
        if not isinstance(research_account_id,str) or not 1 <= len(research_account_id) <= 128 or not isinstance(key_id,str) or len(key_id) > 128:
            raise AccountError('Research 身份无效',400)
        if set(sections) != {'authors','impression','inbox'} or not isinstance(sections['authors'],dict) or not isinstance(sections['impression'],dict) or not isinstance(sections['inbox'],list):
            raise AccountError('Research 快照无效',400)
        if (not isinstance(sections['authors'].get('authors'),list) or not isinstance(sections['authors'].get('customTags'),list)
            or not isinstance(sections['impression'].get('text'),str) or len(sections['inbox']) > 1000):
            raise AccountError('Research 快照无效',400)
        encoded = {kind:json.dumps(value,ensure_ascii=False,sort_keys=True) for kind,value in sections.items()}
        if any(len(value.encode())>256*1024 for value in encoded.values()):
            raise AccountError('Research 快照过大',413)
        snapshot_hash = hashlib.sha256(json.dumps(encoded,sort_keys=True).encode()).hexdigest()
        counts = {'authors':len(sections['authors']['authors']),'inbox':len(sections['inbox'])}
        now = time.time()
        try:
            with self.connect(True) as db:
                if not db.execute("SELECT 1 FROM users WHERE id=? AND status='active'",(user_id,)).fetchone():
                    raise AccountError('账号不可用',401)
                current = db.execute('SELECT research_account_id FROM research_connections WHERE user_id=?',(user_id,)).fetchone()
                if current and current['research_account_id'] != research_account_id:
                    raise AccountError('已连接另一个 Research 账号，请先解除连接',409)
                occupied = db.execute('SELECT user_id FROM research_connections WHERE research_account_id=?',(research_account_id,)).fetchone()
                if occupied and occupied['user_id'] != user_id:
                    raise AccountError('此 Research 账号已连接其他 FastNews 账号',409)
                if not replace and any(db.execute('SELECT 1 FROM personal WHERE user_id=? AND kind=?',(user_id,kind)).fetchone() for kind in sections):
                    raise AccountError('本地已有个人内容；如需覆盖请明确选择替换',409)
                for kind,value in encoded.items():
                    db.execute('INSERT INTO personal(user_id,kind,content) VALUES(?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET content=excluded.content',(user_id,kind,value))
                db.execute('INSERT INTO research_connections VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET key_id=excluded.key_id,imported=excluded.imported,snapshot_hash=excluded.snapshot_hash,counts=excluded.counts',
                    (user_id,research_account_id,key_id,now,snapshot_hash,json.dumps(counts)))
                db.execute('INSERT INTO audit VALUES(?,?,?,?)',(str(uuid.uuid4()),user_id,'research.snapshot.import',now))
        except sqlite3.IntegrityError:
            raise AccountError('Research 账号已连接其他 FastNews 账号',409) from None
        return {'researchAccountId':research_account_id,'keyId':key_id,'importedAt':now,'snapshotHash':snapshot_hash,'counts':counts}
