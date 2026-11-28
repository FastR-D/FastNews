import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, SegmentedControl, TextField } from '@fastrd/ui-react'
import { api, asset, message, setCSRF, safeURL } from '../api'
import { useApp } from '../context'
import { ErrorMessage, PageHeading, Panel } from '../components/Common'
type CASStatus = { enabled: boolean; login_enabled: boolean; link_enabled: boolean }
export default function Account() {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile, refresh, notify } = useApp()
  const [params] = useSearchParams()
  const [mode, setMode] = useState(params.get('mode') === 'register' ? 'register' : 'login'),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [token, setToken] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [cas, setCAS] = useState<CASStatus | null>(null),
    [link, setLink] = useState<{ id: string; state: string } | null>(null),
    [proof, setProof] = useState('')
  const [details, setDetails] = useState({
    name: '',
    email: '',
    currentPassword: '',
    newPassword: '',
  })
  useEffect(() => {
    if (profile && !busy && location.pathname.replace(/\/$/, '') === '/login')
      navigate({ pathname: '/account/', search: location.search }, { replace: true })
  }, [profile?.userId, busy, location.pathname, location.search, navigate])
  useEffect(() => {
    if (profile)
      setDetails({
        name: profile.person,
        email: profile.email,
        currentPassword: '',
        newPassword: '',
      })
  }, [profile?.userId, profile?.person, profile?.email])
  async function preauth() {
    const v = await api<{ csrf: string }>('api/auth/session-init')
    setCSRF(v.csrf)
  }
  async function status() {
    if (!profile || profile.source === 'research') return
    if (cas?.enabled) {
      const c = await api<{ link: { id: string; state: string } | null }>('api/auth/fastcas/status')
      setLink(c.link)
    }
  }
  useEffect(() => {
    if (params.get('fastcas') === 'register') {
      setMode('cas-register')
      api<{ email: string; name: string }>('api/auth/fastcas/registration')
        .then((p) => {
          setEmail(p.email)
          setName(p.name)
        })
        .catch((e) => setError(message(e)))
    }
  }, [params])
  useEffect(() => {
    api<CASStatus>('api/auth/fastcas/available')
      .then((value) => {
        setCAS(value)
        if (
          params.get('mode') === 'register' &&
          params.get('fastcas') !== 'register' &&
          value.login_enabled
        )
          window.location.replace(asset('api/auth/fastcas/login'))
      })
      .catch((e) => setError(message(e)))
  }, [])
  useEffect(() => {
    if (profile) status().catch((e) => setError(message(e)))
  }, [profile?.userId, cas?.enabled])
  async function submit() {
    setBusy(true)
    setError('')
    try {
      await preauth()
      if (mode === 'cas-register') {
        const result = await api<{ url: string }>('api/auth/fastcas/registration', {
          method: 'POST',
          body: JSON.stringify({ email, name, password }),
        })
        const target = safeURL(result.url)
        if (target) window.location.assign(target)
        return
      }
      await api(
        `api/auth/${mode === 'recover' ? 'recover' : mode === 'register' ? 'register' : 'login'}`,
        {
          method: 'POST',
          body: JSON.stringify({ ...(mode === 'login' ? { email } : { token }), password }),
        },
      )
      setPassword('')
      setToken('')
      if (mode === 'login') {
        const next = params.get('next') || '/'
        // Reload after setting the session cookie so the private shell and profile
        // initialize together, without racing the legacy login redirect.
        window.location.replace(
          asset(
            next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/',
          ),
        )
      } else {
        setMode('login')
        notify('账号已更新，请使用邮箱和密码登录')
        await preauth()
      }
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  async function casAction(command: string) {
    if (command === 'link') {
      const v = await api<{ url: string }>('api/auth/fastcas/link', {
        method: 'POST',
        body: JSON.stringify({ password: proof }),
      })
      const target = safeURL(v.url)
      if (target) window.location.assign(target)
      return
    }
    await api(`api/auth/fastcas/${command}`, {
      method: 'POST',
      body: JSON.stringify({ password: proof }),
    })
    setProof('')
    await refresh()
    await status()
    notify('FastCAS 状态已更新')
  }
  async function saveProfile() {
    await api('api/auth/profile', { method: 'POST', body: JSON.stringify(details) })
    setDetails((value) => ({ ...value, currentPassword: '', newPassword: '' }))
    await refresh()
    notify('账号信息已更新')
  }
  return (
    <>
      <PageHeading
        title={profile ? '账号设置' : '登录 FastNews'}
        action={
          profile && (
            <Link className="fastui-link" to="/">
              返回总览
            </Link>
          )
        }
      />
      {params.get('fastcas') === 'failed' && (
        <ErrorMessage error="FastCAS 登录未完成。请先使用本地账号登录并绑定，再重试。" />
      )}
      {params.get('fastcas') === 'complete' && (
        <p className="text-[var(--fastui-success)]">FastCAS 认证已完成。</p>
      )}
      <ErrorMessage error={error} />
      <div className={profile ? 'grid lg:grid-cols-2 gap-5 items-start' : 'grid gap-5'}>
        {!profile ? (
          <Panel title="">
            <form
              aria-label="本地账号"
              className="grid gap-4 p-4 sm:p-6"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <SegmentedControl
                className="account-operation-tabs"
                label="账号操作"
                options={[
                  { value: 'login', label: '登录' },
                  { value: 'register', label: '邀请注册' },
                  ...(mode === 'cas-register'
                    ? [{ value: 'cas-register', label: '完善平台账号' }]
                    : []),
                  { value: 'recover', label: '恢复账号' },
                ]}
                value={mode}
                onChange={(value) => {
                  setMode(value)
                  setError('')
                }}
              />
              {mode === 'cas-register' && (
                <label className="fastui-field">
                  姓名
                  <TextField
                    value={name}
                    maxLength={120}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              )}
              {mode === 'login' || mode === 'cas-register' ? (
                <label className="fastui-field">
                  邮箱
                  <TextField
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              ) : (
                <label className="fastui-field">
                  {mode === 'register' ? '邀请凭证' : '恢复凭证'}
                  <TextField
                    required
                    autoComplete="off"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </label>
              )}
              <label className="fastui-field">
                {mode === 'login' ? '密码' : '新密码（12–256 个字符）'}
                <TextField
                  type="password"
                  required
                  minLength={mode === 'login' ? 1 : 12}
                  maxLength={256}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <Button type="submit" variant="primary" loading={busy}>
                {mode === 'login'
                  ? '登录'
                  : mode === 'cas-register'
                    ? '创建并绑定账号'
                    : mode === 'register'
                      ? '创建账号'
                      : '更新密码'}
              </Button>
              {cas?.login_enabled && (
                <a
                  className="fastui-button fastui-button--sm no-underline"
                  href={asset('api/auth/fastcas/login')}
                >
                  使用 FastCAS 登录
                </a>
              )}
            </form>
          </Panel>
        ) : (
          <Panel title="账号信息">
            <form
              className="grid gap-4 p-4 sm:p-6"
              aria-label="账号信息"
              onSubmit={(event) => {
                event.preventDefault()
                void action(saveProfile)
              }}
            >
              <label className="fastui-field">
                姓名
                <TextField
                  required
                  maxLength={120}
                  value={details.name}
                  onChange={(event) => setDetails({ ...details, name: event.target.value })}
                />
              </label>
              <label className="fastui-field">
                邮箱
                <TextField
                  type="email"
                  autoComplete="username"
                  required
                  value={details.email}
                  onChange={(event) => setDetails({ ...details, email: event.target.value })}
                />
              </label>
              <label className="fastui-field">
                当前密码
                <TextField
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={256}
                  value={details.currentPassword}
                  onChange={(event) =>
                    setDetails({ ...details, currentPassword: event.target.value })
                  }
                />
              </label>
              <label className="fastui-field">
                新密码
                <TextField
                  type="password"
                  autoComplete="new-password"
                  placeholder="留空则不修改密码"
                  minLength={12}
                  maxLength={256}
                  value={details.newPassword}
                  onChange={(event) => setDetails({ ...details, newPassword: event.target.value })}
                />
              </label>
              <div>
                <Button type="submit" variant="primary" loading={busy}>
                  保存账号信息
                </Button>
              </div>
            </form>
          </Panel>
        )}
        {profile && (
          <Panel title="FastCAS 认证" className="account-cas-panel">
            <div id="fastcas" className="grid gap-4 p-4 sm:p-6">
              {cas?.enabled ? (
                <>
                  <p className="m-0" role="status">
                    {link?.state === 'active'
                      ? '已认证'
                      : link?.state === 'prepared'
                        ? '认证待完成'
                        : '未认证'}
                  </p>
                  {profile.source !== 'research' && (
                    <>
                      <label className="fastui-field">
                        验证当前密码
                        <TextField
                          type="password"
                          autoComplete="current-password"
                          value={proof}
                          onChange={(event) => setProof(event.target.value)}
                        />
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        {(!link || link.state === 'revoked') && cas.link_enabled && (
                          <Button
                            variant="primary"
                            loading={busy}
                            disabled={!proof}
                            onClick={() => action(() => casAction('link'))}
                          >
                            认证已有账号
                          </Button>
                        )}
                        {link?.state === 'active' && (
                          <Button
                            variant="danger"
                            loading={busy}
                            disabled={!proof}
                            onClick={() => action(() => casAction('revoke'))}
                          >
                            解除认证
                          </Button>
                        )}
                        {link?.state === 'prepared' && cas.link_enabled && (
                          <Button
                            loading={busy}
                            onClick={() => action(() => casAction('reconcile'))}
                          >
                            重试认证
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                  {cas.login_enabled && (
                    <a className="fastui-link" href={asset('api/auth/fastcas/login')}>
                      使用 FastCAS 登录
                    </a>
                  )}
                </>
              ) : (
                <p className="m-0 text-[var(--fastui-muted)]">此实例尚未启用 FastCAS。</p>
              )}
            </div>
          </Panel>
        )}
      </div>
    </>
  )
}
