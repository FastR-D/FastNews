"""HTTP adapter for independent FastNews accounts; never forwards local tokens."""
import hmac
import json
import os
import secrets
from http.cookies import SimpleCookie

from fastnews_accounts import AccountError


def cookie_value(handler, name):
    jar = SimpleCookie()
    try:
        jar.load(handler.headers.get('Cookie',''))
        return jar[name].value if name in jar else ''
    except Exception:
        return ''


def cookie(name, value, age=7*86400):
    secure = os.environ.get('FASTNEWS_COOKIE_SECURE','true').lower() == 'true'
    return f'{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}' + ('; Secure' if secure else '')


def reply(handler, status, payload, cookies=()):
    body = json.dumps(payload, ensure_ascii=False).encode()
    handler.close_connection = True
    handler.send_response(status)
    handler.send_header('Connection','close')
    handler.send_header('Content-Type','application/json; charset=utf-8')
    handler.send_header('Cache-Control','no-store')
    handler.send_header('X-Content-Type-Options','nosniff')
    handler.send_header('Content-Length',str(len(body)))
    for value in cookies:
        handler.send_header('Set-Cookie',value)
    handler.end_headers()
    if handler.command != 'HEAD':
        handler.wfile.write(body)


def session(handler):
    current = handler.server.accounts.session(cookie_value(handler,'fastnews_session'))
    if current and current['source'] == 'fastcas':
        try:
            handler.server.cas.validate_session(current)
        except AccountError:
            return None
    return current


def dispatch(handler, path):
    if not path.startswith('/api/auth/'):
        return False
    accounts = handler.server.accounts
    try:
        if path == '/api/auth/info' and handler.command == 'GET':
            reply(handler,200,{'local':True,'registration':'invite','fastcas':getattr(getattr(handler.server,'cas',None),'enabled',False)})
        elif path == '/api/auth/session-init' and handler.command == 'GET':
            csrf = secrets.token_urlsafe(32)
            reply(handler,200,{'csrf':csrf},[cookie('fastnews_preauth',csrf,1800)])
        elif path == '/api/auth/me' and handler.command == 'GET':
            current = session(handler)
            if not current:
                raise AccountError('请先登录',401)
            reply(handler,200,{key:current[key] for key in ('user_id','email','name','csrf','source')})
        elif path == '/api/auth/research/status' and handler.command == 'GET':
            current = session(handler)
            if not current:
                raise AccountError('请先登录',401)
            reply(handler,200,{'connection':accounts.research_connection(current['user_id']),
                'casLive':current['source']=='fastcas' and getattr(handler.server.cas,'research_enabled',False)})
        elif path == '/api/auth/research/live' and handler.command == 'GET':
            current = session(handler)
            if not current:
                raise AccountError('请先登录',401)
            profile = handler.server.cas.delegated_research_profile(cookie_value(handler,'fastnews_session'))
            reply(handler,200,profile)
        elif path == '/api/auth/research/sync' and handler.command == 'POST':
            current = session(handler)
            if not current:
                raise AccountError('请先登录',401)
            origin = os.environ.get('FASTNEWS_PUBLIC_ORIGIN','').rstrip('/') or 'http://'+handler.headers.get('Host','')
            if handler.headers.get('Origin') != origin or not hmac.compare_digest(current['csrf'].encode(),handler.headers.get('X-CSRF-Token','').encode()):
                raise AccountError('请求校验失败',403)
            try:
                size = int(handler.headers.get('Content-Length','0'))
                if not 0 < size <= 1024:
                    raise ValueError()
                body = json.loads(handler.rfile.read(size))
            except (ValueError,UnicodeDecodeError):
                raise AccountError('请求格式无效',400) from None
            if not isinstance(body,dict) or set(body) != {'replace'} or type(body['replace']) is not bool:
                raise AccountError('请求格式无效',400)
            profile = handler.server.cas.delegated_research_profile(cookie_value(handler,'fastnews_session'))
            sections = {'authors':{'authors':profile.get('authors'),'customTags':profile.get('customTags')},
                'impression':profile.get('impression'),'inbox':profile.get('inbox')}
            result = accounts.import_research_snapshot(current['user_id'],profile.get('researchAccountId'),'',sections,body['replace'])
            reply(handler,200,{'connection':result})
        elif path == '/api/auth/research/import' and handler.command == 'POST':
            current = session(handler)
            if not current:
                raise AccountError('请先登录',401)
            origin = os.environ.get('FASTNEWS_PUBLIC_ORIGIN','').rstrip('/') or 'http://'+handler.headers.get('Host','')
            if handler.headers.get('Origin') != origin:
                raise AccountError('不允许跨站请求',403)
            if not hmac.compare_digest(current['csrf'].encode(),handler.headers.get('X-CSRF-Token','').encode()):
                raise AccountError('请求校验失败',403)
            try:
                size = int(handler.headers.get('Content-Length','0'))
                if not 0 < size <= 8192:
                    raise ValueError()
                body = json.loads(handler.rfile.read(size))
            except (ValueError,UnicodeDecodeError):
                raise AccountError('请求格式无效',400) from None
            if not isinstance(body,dict) or set(body)-{'key','replace'} or not isinstance(body.get('key'),str) or type(body.get('replace',False)) is not bool:
                raise AccountError('请求格式无效',400)
            from research_import import ResearchImporter
            configured = getattr(handler.server,'research_importer',None)
            if configured:
                account_id,key_id,sections = configured.snapshot(body['key'])
            else:
                try:
                    with ResearchImporter() as importer:
                        account_id,key_id,sections = importer.snapshot(body['key'])
                except ValueError:
                    raise AccountError('Research 地址配置无效',503) from None
            result = accounts.import_research_snapshot(current['user_id'],account_id,key_id,sections,body.get('replace',False))
            reply(handler,200,{'connection':result})
        elif path in {'/api/auth/login','/api/auth/register','/api/auth/recover','/api/auth/logout'} and handler.command == 'POST':
            origin = os.environ.get('FASTNEWS_PUBLIC_ORIGIN','').rstrip('/')
            actual = handler.headers.get('Origin')
            if actual and actual != (origin or 'http://'+handler.headers.get('Host','')):
                raise AccountError('不允许跨站请求',403)
            if path.endswith('/logout'):
                current = session(handler)
                if not current:
                    raise AccountError('请先登录',401)
                csrf = current['csrf']
            else:
                csrf = cookie_value(handler,'fastnews_preauth')
            header = handler.headers.get('X-CSRF-Token','')
            if len(csrf)<32 or not hmac.compare_digest(csrf.encode(),header.encode()):
                raise AccountError('请刷新登录页面重试',403)
            try:
                size = int(handler.headers.get('Content-Length','0'))
            except ValueError:
                raise AccountError('请求长度无效') from None
            if size<0 or size>8192:
                raise AccountError('请求过大',413)
            try:
                data = json.loads(handler.rfile.read(size) or b'{}')
            except (ValueError,UnicodeDecodeError):
                raise AccountError('请求格式无效') from None
            if not isinstance(data,dict) or any(not isinstance(v,str) for v in data.values()):
                raise AccountError('请求格式无效')
            peer = handler.client_address[0]
            if path.endswith('/login'):
                raw,csrf = accounts.login(data.get('email',''),data.get('password',''),peer)
                reply(handler,200,{'csrf':csrf},[cookie('fastnews_session',raw)])
            elif path.endswith('/logout'):
                accounts.logout(cookie_value(handler,'fastnews_session'))
                reply(handler,200,{'ok':True},[cookie('fastnews_session','',0)])
            else:
                accounts.redeem('invite' if path.endswith('/register') else 'recovery',data.get('token',''),data.get('password',''),peer)
                reply(handler,200,{'ok':True})
        else:
            reply(handler,404,{'error':'接口不存在'})
    except AccountError as error:
        reply(handler,error.status,{'error':str(error)})
    return True


def content_dispatch(handler, path):
    if not path.startswith('/api/content/') or not cookie_value(handler,'fastnews_session'):
        return False
    try:
        current = session(handler)
        if not current:
            raise AccountError('请重新登录本地账号',401)
        accounts, user = handler.server.accounts, current['user_id']
        name = path.removeprefix('/api/content/')
        if name == 'me' and handler.command == 'GET':
            authors = accounts.personal(user,'authors') or {'authors':[],'customTags':[]}
            inbox = accounts.personal(user,'inbox') or []
            reply(handler,200,{'userId':user,'person':current['name'],'email':current['email'],'source':current['source'],'csrf':current['csrf'],
                **authors,'impression':accounts.personal(user,'impression') or {'text':'','updatedAt':''},'inboxUnread':sum(not item.get('read') for item in inbox)})
            return True
        if name not in {'authors','impression','inbox','settings'}:
            raise AccountError('本地账号不支持此接口',404)
        if handler.command not in {'GET','PUT'}:
            raise AccountError('请求方法不支持',405)
        if handler.command == 'PUT':
            if not hmac.compare_digest(current['csrf'].encode(),handler.headers.get('X-CSRF-Token','').encode()):
                raise AccountError('请求校验失败',403)
            expected = os.environ.get('FASTNEWS_PUBLIC_ORIGIN','').rstrip('/') or 'http://'+handler.headers.get('Host','')
            if handler.headers.get('Origin') and handler.headers['Origin'] != expected:
                raise AccountError('不允许跨站请求',403)
            try:
                size = int(handler.headers.get('Content-Length','0'))
                if not 0 <= size <= 256*1024:
                    raise AccountError('请求过大',413)
                data = json.loads(handler.rfile.read(size) or b'{}')
                if not isinstance(data,dict):
                    raise ValueError()
            except (ValueError,UnicodeDecodeError):
                raise AccountError('请求格式无效') from None
            if name == 'authors':
                authors, tags = data.get('authors',[]), data.get('customTags',[])
                if not isinstance(authors,list) or len(authors)>200 or not isinstance(tags,list) or len(tags)>100 or any(not isinstance(tag,str) or len(tag)>100 for tag in tags):
                    raise AccountError('作者或标签格式无效')
                accounts.personal(user,name,{'authors':authors,'customTags':tags})
            elif name == 'impression':
                import datetime
                text = data.get('text','')
                if not isinstance(text,str) or len(text)>20000:
                    raise AccountError('研究印象格式无效')
                accounts.personal(user,name,{'text':text,'updatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
            elif name == 'inbox':
                ids = data.get('readIds',[])
                if not isinstance(ids,list) or len(ids)>1000 or any(not isinstance(value,str) for value in ids):
                    raise AccountError('已读标记无效')
                # Browser clients may mark their messages read, not inject delivery.
                if set(data)-{'readIds'}:
                    raise AccountError('不支持修改消息内容')
                wanted = set(ids)
                accounts.update_personal(user,'inbox',lambda items:[{**item,'read':True} if item.get('id') in wanted else item for item in (items or [])])
            else:
                accounts.personal(user,name,data)
        generated = False
        if name == 'inbox' and handler.command == 'GET' and callable(getattr(handler.server,'daily_inbox_generator',None)):
            value, generated = accounts.daily_inbox(user,lambda items: handler.server.daily_inbox_generator(accounts,user,items))
        else:
            value = accounts.personal(user,name)
        if name == 'inbox':
            items = value or []
            payload = {'items':items,'unread':sum(not item.get('read') for item in items),'generatedToday':generated}
        elif name == 'impression':
            payload = {'impression':value or {'text':'','updatedAt':''}}
        elif name == 'authors':
            payload = value or {'authors':[],'customTags':[]}
        else:
            payload = {'settings':value or {}}
        reply(handler,200,payload)
    except AccountError as error:
        reply(handler,error.status,{'error':str(error)})
    return True
