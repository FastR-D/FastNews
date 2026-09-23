"""Browser and signed event endpoints for the optional FastCAS provider."""
import hmac
import json
import secrets
from urllib.parse import parse_qs, urlparse

from fastnews_accounts import AccountError
from fastnews_accounts_http import cookie, cookie_value, reply, session


def dispatch(handler, path, public_base=''):
    if not path.startswith('/api/auth/fastcas/'):
        return False
    service = handler.server.cas
    def redirect(location, values=()):
        handler.close_connection = True
        handler.send_response(302)
        handler.send_header('Location',location)
        handler.send_header('Connection','close')
        handler.send_header('Cache-Control','no-store')
        handler.send_header('Referrer-Policy','no-referrer')
        handler.send_header('Content-Length','0')
        for value in values:
            handler.send_header('Set-Cookie',value)
        handler.end_headers()
    def body(limit):
        try:
            size = int(handler.headers.get('Content-Length','0'))
        except ValueError:
            raise AccountError('请求长度无效') from None
        if size < 0 or size > limit:
            raise AccountError('请求过大',413)
        return handler.rfile.read(size)
    try:
        if path.endswith('/available') and handler.command == 'GET':
            reply(handler,200,{'enabled':service.enabled})
            return True
        if not service.enabled:
            raise AccountError('未启用 FastCAS',404)
        raw = cookie_value(handler,'fastnews_session')
        if path.endswith('/events') and handler.command == 'POST':
            if handler.headers.get('Content-Type','').split(';')[0] != 'application/jwt':
                raise AccountError('需要签名事件',415)
            def apply(event):
                if event['type'] == 'account_link.revoked':
                    service.store.apply_verified_event(event)
                elif event['status'] == 'disabled':
                    service.store.apply_verified_logout({'id':event['id'],'subject':event['subject']})
            service.sdk.handle_notification(body(65536).decode('ascii'),apply)
            reply(handler,200,{'ok':True})
        elif path.endswith('/backchannel-logout') and handler.command == 'POST':
            if handler.headers.get('Content-Type','').split(';')[0] != 'application/x-www-form-urlencoded':
                raise AccountError('需要签名退出通知',415)
            fields = parse_qs(body(65536).decode('ascii'),strict_parsing=True)
            if set(fields) != {'logout_token'} or len(fields['logout_token']) != 1:
                raise AccountError('退出通知格式无效',400)
            service.store.apply_verified_logout(service.sdk.verify_logout(fields['logout_token'][0]))
            reply(handler,200,{'ok':True})
        elif path.endswith('/login') and handler.command == 'GET':
            binding = secrets.token_urlsafe(32)
            redirect(service.begin_login(binding),[cookie('fastnews_cas_binding',binding,300)])
        elif path.endswith('/callback') and handler.command == 'GET':
            callback = service.config['redirect_uri'].split('?',1)[0]+'?'+urlparse(handler.path).query
            try:
                token = service.finish(callback,cookie_value(handler,'fastnews_cas_binding'),raw)
                values = [cookie('fastnews_cas_binding','',0)]
                if token:
                    values.append(cookie('fastnews_session',token))
                redirect(public_base+'/login?fastcas=complete',values)
            except Exception:
                redirect(public_base+'/login?fastcas=failed',[cookie('fastnews_cas_binding','',0)])
        else:
            current = session(handler)
            if not current:
                raise AccountError('请先登录本地账号',401)
            if path.endswith('/status') and handler.command == 'GET':
                reply(handler,200,{'enabled':True,'link':service.store.current(current['user_id'])})
                return True
            target = urlparse(service.config['redirect_uri'])
            if handler.command != 'POST' or handler.headers.get('Origin') != target.scheme+'://'+target.netloc:
                raise AccountError('不允许跨站认证操作',403)
            if not hmac.compare_digest(current['csrf'].encode(),handler.headers.get('X-CSRF-Token','').encode()):
                raise AccountError('请求校验失败',403)
            data = json.loads(body(8192) or b'{}')
            if not isinstance(data,dict):
                raise AccountError('请求格式无效')
            if path.endswith('/link'):
                binding = secrets.token_urlsafe(32)
                url = service.begin_link(binding,raw,data.get('password'),handler.client_address[0])
                reply(handler,200,{'url':url},[cookie('fastnews_cas_binding',binding,300)])
            elif path.endswith('/revoke'):
                service.revoke(raw,data.get('password'),handler.client_address[0])
                reply(handler,200,{'ok':True})
            elif path.endswith('/reconcile'):
                service.reconcile(current['user_id'])
                reply(handler,200,{'ok':True})
            else:
                raise AccountError('接口不存在',404)
    except AccountError as error:
        reply(handler,error.status,{'error':str(error)})
    except (ValueError,UnicodeError):
        reply(handler,400,{'error':'请求格式无效'})
    except Exception as error:
        status = getattr(error,'status',502)
        reply(handler,status if status in {400,401,403,409,429} else 502,{'error':'FastCAS 操作未完成，请重试或使用本地登录'})
    return True
