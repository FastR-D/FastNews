"""Encrypted, session-bound FastCAS refresh-token storage for optional connectors."""
import base64
import os
import time

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from fastnews_accounts import AccountError, digest


class CASTokenVault:
    def __init__(self, accounts, key, issuer, client_id):
        try:
            decoded = base64.urlsafe_b64decode(key + '=' * (-len(key) % 4))
        except (ValueError,base64.binascii.Error):
            decoded = b''
        if len(decoded) != 32 or not key or base64.urlsafe_b64encode(decoded).decode().rstrip('=') != key.rstrip('='):
            raise ValueError('FASTNEWS_FASTCAS_VAULT_KEY must be a base64url-encoded 32-byte key')
        self.accounts = accounts
        self.cipher = AESGCM(decoded)
        self.issuer, self.client_id = issuer, client_id
        with accounts.connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS cas_token_vault(
                session_hash TEXT PRIMARY KEY REFERENCES sessions(hash) ON DELETE CASCADE,
                subject TEXT NOT NULL, access_cipher BLOB NOT NULL, refresh_cipher BLOB NOT NULL,
                access_expires REAL NOT NULL, updated REAL NOT NULL)''')

    def _aad(self, session_hash, subject):
        return f'{self.issuer}\n{self.client_id}\n{session_hash}\n{subject}'.encode()

    def _seal(self, value, session_hash, subject):
        nonce = os.urandom(12)
        return nonce+self.cipher.encrypt(nonce,value.encode(),self._aad(session_hash,subject))

    def _open(self, value, session_hash, subject):
        try:
            return self.cipher.decrypt(value[:12],value[12:],self._aad(session_hash,subject)).decode()
        except Exception:
            raise AccountError('FastCAS 授权存储不可读，请重新登录',409) from None

    def save(self, db, raw_session, subject, tokens):
        access, refresh = tokens.get('access_token'), tokens.get('refresh_token')
        if not isinstance(access,str) or not access or not isinstance(refresh,str) or not refresh:
            return False
        session_hash = digest(raw_session)
        expires = time.time()+max(0,int(tokens.get('expires_in') or 0))
        db.execute('''INSERT INTO cas_token_vault VALUES(?,?,?,?,?,?)
            ON CONFLICT(session_hash) DO UPDATE SET subject=excluded.subject,access_cipher=excluded.access_cipher,
                refresh_cipher=excluded.refresh_cipher,access_expires=excluded.access_expires,updated=excluded.updated''',
            (session_hash,subject,self._seal(access,session_hash,subject),self._seal(refresh,session_hash,subject),expires,time.time()))
        return True

    def access(self, raw_session, subject, sdk):
        session_hash = digest(raw_session)
        # SQLite serializes refresh rotation across FastNews workers. The short
        # network request stays inside this transaction to prevent token replay.
        with self.accounts.connect(True) as db:
            row = db.execute('''SELECT v.* FROM cas_token_vault v JOIN sessions s ON s.hash=v.session_hash
                WHERE v.session_hash=? AND v.subject=? AND s.source='fastcas' AND s.expires>?''',
                (session_hash,subject,time.time())).fetchone()
            if not row:
                raise AccountError('请重新使用 FastCAS 登录以启用 Research 连接',409)
            if row['access_expires'] > time.time()+30:
                return self._open(row['access_cipher'],session_hash,subject)
            refresh = self._open(row['refresh_cipher'],session_hash,subject)
            try:
                tokens = sdk.refresh(refresh)
            except Exception:
                raise AccountError('FastCAS 授权已失效，请重新登录',401) from None
            if not self.save(db,raw_session,subject,tokens):
                raise AccountError('FastCAS 未返回可续期授权，请重新登录',409)
            return tokens['access_token']
