"""FastCAS SDK persistence adapter; events must be verified by the SDK first."""
import json
import time


class CASStore:
    def __init__(self, accounts, issuer, client_id):
        self.accounts, self.issuer, self.client_id = accounts, issuer, client_id
        with accounts.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS cas_transactions(state TEXT PRIMARY KEY,payload TEXT NOT NULL,expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS cas_links(issuer TEXT NOT NULL,id TEXT NOT NULL,client_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),subject TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('prepared','active','revoked')),version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(issuer,id));
                CREATE UNIQUE INDEX IF NOT EXISTS cas_local_live ON cas_links(issuer,client_id,user_id) WHERE state!='revoked';
                CREATE UNIQUE INDEX IF NOT EXISTS cas_subject_live ON cas_links(issuer,client_id,subject) WHERE state!='revoked';
                CREATE TABLE IF NOT EXISTS cas_events(issuer TEXT NOT NULL,id TEXT NOT NULL,created REAL NOT NULL,PRIMARY KEY(issuer,id));
            ''')

    def put(self, transaction):
        with self.accounts.connect(True) as db:
            db.execute('DELETE FROM cas_transactions WHERE expires<?', (time.time(),))
            db.execute('INSERT INTO cas_transactions VALUES(?,?,?)', (transaction['state'],json.dumps(transaction),transaction['expires_at']))

    def take(self, state):
        with self.accounts.connect(True) as db:
            row = db.execute('SELECT payload FROM cas_transactions WHERE state=?',(state,)).fetchone()
            db.execute('DELETE FROM cas_transactions WHERE state=?',(state,))
            return json.loads(row['payload']) if row else None

    def current(self, user_id):
        with self.accounts.connect() as db:
            row = db.execute("SELECT payload FROM cas_links WHERE issuer=? AND client_id=? AND user_id=? AND state!='revoked'",(self.issuer,self.client_id,user_id)).fetchone()
            return json.loads(row['payload']) if row else None

    def subject(self, subject):
        with self.accounts.connect() as db:
            row = db.execute("SELECT payload FROM cas_links WHERE issuer=? AND client_id=? AND subject=? AND state!='revoked'",(self.issuer,self.client_id,subject)).fetchone()
            return json.loads(row['payload']) if row else None

    def validate(self, link):
        if link.get('client_id') != self.client_id or link.get('state') not in {'prepared','active','revoked'}:
            raise ValueError('Invalid FastCAS link')
        if type(link.get('version')) is not int or link['version'] < 1:
            raise ValueError('Invalid FastCAS version')
        if any(not isinstance(link.get(key),str) or not link[key] for key in ('id','subject','local_account_ref')):
            raise ValueError('Invalid FastCAS identity')

    def save_in_transaction(self, db, link):
        self.validate(link)
        row = db.execute('SELECT * FROM cas_links WHERE issuer=? AND id=?',(self.issuer,link['id'])).fetchone()
        if row:
            if (row['client_id'],row['user_id'],row['subject']) != (self.client_id,link['local_account_ref'],link['subject']):
                raise ValueError('FastCAS identity changed')
            if row['version'] >= link['version'] or row['state'] == 'revoked':
                return
        db.execute('''INSERT INTO cas_links VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(issuer,id)
            DO UPDATE SET state=excluded.state,version=excluded.version,payload=excluded.payload''',
            (self.issuer,link['id'],self.client_id,link['local_account_ref'],link['subject'],link['state'],link['version'],json.dumps(link)))

    def save(self, link):
        with self.accounts.connect(True) as db:
            self.save_in_transaction(db,link)

    def apply_verified_event(self, event):
        link = event['link']
        self.validate(link)
        if event.get('type') != 'account_link.revoked' or link['state'] != 'revoked' or not isinstance(event.get('id'),str) or not event['id']:
            raise ValueError('Invalid FastCAS event')
        with self.accounts.connect(True) as db:
            if db.execute('SELECT 1 FROM cas_events WHERE issuer=? AND id=?',(self.issuer,event['id'])).fetchone():
                return
            if db.execute('SELECT 1 FROM users WHERE id=?',(link['local_account_ref'],)).fetchone():
                self.save_in_transaction(db,link)
                db.execute("""DELETE FROM sessions WHERE source='fastcas' AND json_extract(provider,'$.issuer')=?
                    AND json_extract(provider,'$.link_id')=? AND json_extract(provider,'$.link_version')<=?""",(self.issuer,link['id'],link['version']))
            db.execute('INSERT INTO cas_events VALUES(?,?,?)',(self.issuer,event['id'],time.time()))

    def apply_verified_logout(self, notice):
        if (not isinstance(notice.get('id'), str) or not notice['id'] or
            not isinstance(notice.get('subject'), str) or not notice['subject'] or
            (notice.get('sid') is not None and not isinstance(notice['sid'], str))):
            raise ValueError('Invalid FastCAS logout')
        with self.accounts.connect(True) as db:
            if db.execute('SELECT 1 FROM cas_events WHERE issuer=? AND id=?',(self.issuer,notice['id'])).fetchone():
                return
            db.execute("""DELETE FROM sessions WHERE source='fastcas' AND json_extract(provider,'$.issuer')=?
                AND json_extract(provider,'$.link_id') IN
                  (SELECT id FROM cas_links WHERE issuer=? AND client_id=? AND subject=?)
                AND (? IS NULL OR json_extract(provider,'$.sid')=?)""",
                (self.issuer,self.issuer,self.client_id,notice['subject'],notice.get('sid'),notice.get('sid')))
            db.execute('INSERT INTO cas_events VALUES(?,?,?)',(self.issuer,notice['id'],time.time()))
