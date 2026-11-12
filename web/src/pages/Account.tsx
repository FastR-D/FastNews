import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, Checkbox, SegmentedControl, TextField } from '@fastrd/ui-react'
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
  const [mode, setMode] = useState('login'),
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
    api<CASStatus>('api/auth/fastcas/available')
      .then(setCAS)
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
        description="本地登录、邀请注册与恢复独立于 FastCAS，个人内容归当前账号所有。"
        action={<Link to="/">返回总览</Link>}
      />
      {params.get('fastcas') === 'failed' && (
        <ErrorMessage error="FastCAS 登录未完成。请先使用本地账号登录并绑定，再重试。" />
      )}
      {params.get('fastcas') === 'complete' && <p className="success-text">FastCAS 认证已完成。</p>}
      <ErrorMessage error={error} />
      <div className="account-layout">
        {!profile ? (
          <Panel title="登录与恢复">
            <form
              className="account-form"
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
                  { value: 'recover', label: '恢复账号' },
                ]}
                value={mode}
                onChange={(value) => {
                  setMode(value)
                  setError('')
                }}
              />
              {mode === 'login' ? (
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
                {mode === 'login' ? '登录' : mode === 'register' ? '创建账号' : '更新密码'}
              </Button>
              {cas?.login_enabled && (
                <a className="file-link" href={asset('api/auth/fastcas/login')}>
                  使用 FastCAS 登录
                </a>
              )}
              <p className="muted">邀请与恢复凭证由管理员发放，一小时内有效且仅能使用一次。</p>
            </form>
          </Panel>
        ) : (
          <Panel title="当前账号" action={<Badge tone="success">已登录</Badge>}>
            <div className="account-form">
              <strong>{profile.person}</strong>
              <p>{profile.email}</p>
              <p className="muted">
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
            <div className="account-form">
              {cas?.enabled ? (
                <>
                  <p>{link ? `绑定状态：${link.state}` : '尚未绑定 FastCAS 身份'}</p>
                  <p className="muted">
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
                  <div className="row-actions">
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
                    <a href={asset('api/auth/fastcas/login')}>使用 FastCAS 重新登录</a>
                  )}
                </>
              ) : (
                <p className="muted">此实例未启用 FastCAS，本地登录照常可用。</p>
              )}
            </div>
          </Panel>
        )}
        {profile && profile.source !== 'research' && (
          <Panel title="Research 内容连接" className="workspace-wide">
            <div className="account-form">
              {connection && (
                <p className="success-text">
                  已导入 {connection.counts.authors} 位作者、{connection.counts.inbox} 条私信 ·{' '}
                  {new Date(connection.importedAt * 1000).toLocaleString('zh-CN')}
                </p>
              )}
              <p className="muted">
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
              <label className="checkbox-label">
                <Checkbox checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                明确替换本地已有作者、研究印象和私信
              </label>
              <div className="row-actions">
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
                <details open>
                  <summary>Research 实时内容</summary>
                  <pre className="json-preview">{JSON.stringify(live, null, 2)}</pre>
                </details>
              )}
            </div>
          </Panel>
        )}
      </div>
    </>
  )
}
