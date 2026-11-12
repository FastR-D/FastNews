import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Badge,
  Button,
  Checkbox,
  InspectorSection,
  SegmentedControl,
  TextField,
} from '@fastrd/ui-react'
import { api, asset, message, setCSRF, safeURL } from '../api'
import { useApp } from '../context'
import { ErrorMessage, PageHeading, Panel } from '../components/Common'
import FastReadConnection from '../components/FastReadConnection'
type CASStatus = { enabled: boolean; login_enabled: boolean; link_enabled: boolean }
type Connection = {
  researchAccountId: string
  importedAt: number
  counts: { authors: number; inbox: number }
}
export default function Account() {
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
    [proof, setProof] = useState(''),
    [key, setKey] = useState(''),
    [replace, setReplace] = useState(false),
    [connection, setConnection] = useState<Connection | null>(null),
    [casLive, setCASLive] = useState(false),
    [live, setLive] = useState<unknown>(null)
  async function preauth() {
    const v = await api<{ csrf: string }>('api/auth/session-init')
    setCSRF(v.csrf)
  }
  async function status() {
    if (!profile || profile.source === 'research') return
    const research = await api<{ connection: Connection | null; casLive: boolean }>(
      'api/auth/research/status',
    )
    setConnection(research.connection)
    setCASLive(research.casLive)
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
        await refresh()
        notify('已登录 FastNews')
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
  async function importResearch(sync = false) {
    await api(`api/auth/research/${sync ? 'sync' : 'import'}`, {
      method: 'POST',
      body: JSON.stringify(sync ? { replace } : { key, replace }),
    })
    setKey('')
    await refresh()
    await status()
    notify('Research 内容已复制到本地账号')
  }
  return (
    <>
      <PageHeading
        title="FastNews 账号"
        description="使用本地账号或 FastCAS 登录，个人内容归当前账号所有。"
        action={
          <Link className="fastui-link" to="/">
            返回总览
          </Link>
        }
      />
      {params.get('fastcas') === 'failed' && (
        <ErrorMessage error="FastCAS 登录未完成。请先使用本地账号登录并绑定，再重试。" />
      )}
      {params.get('fastcas') === 'complete' && (
        <p className="text-[var(--fastui-success)]">FastCAS 认证已完成。</p>
      )}
      <ErrorMessage error={error} />
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {!profile ? (
          <Panel title="登录与恢复">
            <form
              aria-label="本地账号"
              className="grid gap-4 p-4 sm:p-6"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <SegmentedControl
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
              <p className="text-[var(--fastui-muted)]">
                已有账号可登录后绑定 FastCAS。恢复凭证由管理员发放。
              </p>
            </form>
          </Panel>
        ) : (
          <Panel title="当前账号" action={<Badge tone="success">已登录</Badge>}>
            <div className="grid gap-4 p-4 sm:p-6">
              <strong>{profile.person}</strong>
              <p>{profile.email}</p>
              <p className="text-[var(--fastui-muted)]">
                登录来源：
                {profile.source === 'fastcas'
                  ? 'FastCAS'
                  : profile.source === 'research'
                    ? 'Research Key'
                    : '本地密码'}
              </p>
              <Button
                loading={busy}
                onClick={() =>
                  action(async () => {
                    await api(
                      profile.source === 'research' ? 'api/content/logout' : 'api/auth/logout',
                      { method: 'POST', body: '{}' },
                    )
                    await refresh()
                    setLink(null)
                    setConnection(null)
                    setLive(null)
                    await preauth()
                  })
                }
              >
                退出登录
              </Button>
            </div>
          </Panel>
        )}
        {profile && profile.source !== 'research' && <FastReadConnection key={profile.userId} />}
        {profile && profile.source !== 'research' && (
          <Panel title="FastCAS 认证">
            <div className="grid gap-4 p-4 sm:p-6">
              {cas?.enabled ? (
                <>
                  <p>{link ? `绑定状态：${link.state}` : '尚未绑定 FastCAS 身份'}</p>
                  <p className="text-[var(--fastui-muted)]">
                    同邮箱或同名不会自动合并。绑定与解绑需要验证当前账号的本地密码。
                  </p>
                  <label className="fastui-field">
                    本地密码
                    <TextField
                      type="password"
                      autoComplete="current-password"
                      value={proof}
                      onChange={(e) => setProof(e.target.value)}
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {!link && cas.link_enabled && (
                      <Button
                        variant="primary"
                        loading={busy}
                        disabled={!proof}
                        onClick={() => action(() => casAction('link'))}
                      >
                        认证已有账号
                      </Button>
                    )}
                    {link && (
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
                      <Button loading={busy} onClick={() => action(() => casAction('reconcile'))}>
                        重试待完成认证
                      </Button>
                    )}
                  </div>
                  {cas.login_enabled && (
                    <a className="fastui-link" href={asset('api/auth/fastcas/login')}>
                      使用 FastCAS 重新登录
                    </a>
                  )}
                </>
              ) : (
                <p className="text-[var(--fastui-muted)]">
                  此实例未启用 FastCAS，本地登录照常可用。
                </p>
              )}
            </div>
          </Panel>
        )}
        {profile && profile.source !== 'research' && (
          <Panel title="Research 内容连接" className="col-span-full">
            <div className="grid gap-4 p-4 sm:p-6">
              {connection && (
                <p className="text-[var(--fastui-success)]">
                  已导入 {connection.counts.authors} 位作者、{connection.counts.inbox} 条私信 ·{' '}
                  {new Date(connection.importedAt * 1000).toLocaleString('zh-CN', {
                    timeZone: 'Asia/Shanghai',
                  })}
                </p>
              )}
              <p className="text-[var(--fastui-muted)]">
                输入 Research Key，验证后复制关注作者、研究印象与收件箱。复制后两边各自保存。
              </p>
              <label className="fastui-field">
                Research Key
                <TextField
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                明确替换本地已有作者、研究印象和私信
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  disabled={!key}
                  loading={busy}
                  onClick={() => action(() => importResearch())}
                >
                  验证并导入快照
                </Button>
                {casLive && (
                  <>
                    <Button
                      loading={busy}
                      onClick={() =>
                        action(async () => {
                          const v = await api('api/auth/research/live')
                          setLive(v)
                        })
                      }
                    >
                      实时读取 Research
                    </Button>
                    <Button loading={busy} onClick={() => action(() => importResearch(true))}>
                      同步本次快照到本地
                    </Button>
                  </>
                )}
              </div>
              {live !== null && (
                <InspectorSection open label="Research 实时内容">
                  <pre className="overflow-auto max-h-90 whitespace-pre-wrap break-all p-4 text-xs bg-[var(--fastui-raised)]">
                    {JSON.stringify(live, null, 2)}
                  </pre>
                </InspectorSection>
              )}
            </div>
          </Panel>
        )}
      </div>
    </>
  )
}
