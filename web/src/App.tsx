import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { NavLink, Link, Route, Routes, useLocation, Navigate } from 'react-router-dom'
import { Alert, Badge, Button, Dialog, TextArea } from '@fastrd/ui-react'
import {
  BookOpen,
  ChartNoAxesCombined,
  GraduationCap,
  LayoutDashboard,
  Mail,
  Menu,
  Moon,
  Newspaper,
  Sun,
  Users,
  Zap,
  UserRound,
  X,
} from 'lucide-react'
import { api, APIError, message, setCSRF } from './api'
import { AppContext } from './context'
import type { Catalog, Profile } from './types'
import { ErrorMessage } from './components/Common'
import Home from './pages/Home'
import Papers from './pages/Papers'
import News from './pages/News'
import Generate from './pages/Generate'
import Authors from './pages/Authors'
import Inbox from './pages/Inbox'
import Account from './pages/Account'
import { theme } from './theme'
const navigation: [string, string, ReactNode][] = [
  ['/', '总览', <LayoutDashboard />],
  ['/inbox/', '私信', <Mail />],
  ['/top-conf/', '顶会报告', <GraduationCap />],
  ['/field-briefing/', '领域导读', <BookOpen />],
  ['/summary-brief/', '总结汇报', <ChartNoAxesCombined />],
  ['/secnews/', '安全资讯', <Newspaper />],
  ['/authors', '关注作者', <Users />],
]
export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [profile, setProfile] = useState<Profile | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('fastnews-sidebar-collapsed') === 'true',
  )
  const [mode, setMode] = useState(theme.resolved)
  const [impressionOpen, setImpressionOpen] = useState(false),
    [text, setText] = useState(''),
    [saving, setSaving] = useState(false),
    [impressionError, setImpressionError] = useState('')
  const location = useLocation()
  const refresh = useCallback(async () => {
    try {
      const p = await api<Profile>('api/content/me')
      setProfile(p)
      setCSRF(p.csrf)
    } catch (e) {
      if (e instanceof APIError && e.status === 401) {
        setProfile(null)
        setCSRF('')
      } else throw e
    }
  }, [])
  useEffect(() => {
    refresh().catch((e) => setError(message(e)))
  }, [refresh])
  useEffect(() => {
    const abort = new AbortController()
    api<Catalog>('api/catalog', { signal: abort.signal })
      .then((value) => {
        setCatalog(value)
        setError('')
      })
      .catch((e) => {
        if (abort.signal.aborted) return
        if (e instanceof APIError && e.status === 401) {
          setCatalog(null)
          return
        }
        setError(message(e))
      })
    return () => abort.abort()
  }, [profile?.userId])
  useEffect(() => theme.subscribe((state) => setMode(state.resolved)), [])
  useEffect(() => {
    if (profile?.userId)
      api<{ unread: number }>('api/content/inbox')
        .then((v) => setProfile((p) => (p ? { ...p, inboxUnread: v.unread } : p)))
        .catch((e) => setNotice(message(e)))
  }, [profile?.userId])
  useEffect(() => {
    if (location.pathname.startsWith('/impression')) {
      setText(profile?.impression.text || '')
      setImpressionOpen(true)
    }
    if (location.hash === '#authors') {
      document.getElementById('authors')?.scrollIntoView()
    }
  }, [location.pathname, location.hash, profile?.impression.text])
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 7000)
    return () => clearTimeout(t)
  }, [notice])
  async function saveImpression() {
    setSaving(true)
    setImpressionError('')
    try {
      await api('api/content/impression', { method: 'PUT', body: JSON.stringify({ text }) })
      await refresh()
      setImpressionOpen(false)
      setNotice('研究印象已保存')
    } catch (e) {
      setImpressionError(message(e))
    } finally {
      setSaving(false)
    }
  }
  const nav = (
    <>
      {navigation.map(([to, label, icon]) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
        >
          {icon}
          <span>{label}</span>
          {label === '私信' && !!profile?.inboxUnread && <Badge>{profile.inboxUnread}</Badge>}
          {label === '顶会报告' && catalog && (
            <small>{catalog.reports.filter((r) => r.kind === 'top-conf').length}</small>
          )}
        </NavLink>
      ))}
    </>
  )
  return (
    <AppContext.Provider value={{ catalog, profile, refresh, notify: setNotice }}>
      <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <aside className="sidebar">
          <Link className="brand" to="/">
            <span className="brand-mark">
              <Zap />
            </span>
            <span>
              <strong>FastNews</strong>
              <small>Research briefings</small>
            </span>
          </Link>
          <p className="nav-label">WORKSPACE</p>
          <nav aria-label="主导航">{nav}</nav>
          <div className="sidebar-footer">
            <span>本地报告索引 · FastRead</span>
            <Link to="/login">
              <UserRound size={13} />
              {profile?.person || '账号 / 登录'}
            </Link>
          </div>
        </aside>
        <main className="main">
          <header className="topbar">
            <div className="topbar-start">
              <Button
                variant="icon"
                aria-label={collapsed ? '打开总览栏' : '隐藏总览栏'}
                aria-pressed={collapsed}
                onClick={() => {
                  setCollapsed(!collapsed)
                  localStorage.setItem('fastnews-sidebar-collapsed', String(!collapsed))
                }}
              >
                <Menu size={17} />
              </Button>
              <span>
                <strong>FastNews</strong>
                <span className="muted"> / Research briefings</span>
              </span>
            </div>
            <div className="topbar-actions">
              <Button
                onClick={() => {
                  setText(profile?.impression.text || '')
                  setImpressionError('')
                  setImpressionOpen(true)
                }}
              >
                <UserRound size={13} />
                个人印象
              </Button>
              <Button
                variant="icon"
                aria-label={mode === 'dark' ? '切换浅色模式' : '切换深色模式'}
                onClick={() => theme.setMode(mode === 'dark' ? 'light' : 'dark')}
              >
                {mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </Button>
              <Link to="/login" className="account-link">
                {profile?.person || '登录'}
              </Link>
            </div>
          </header>
          <nav className="mobile-nav" aria-label="移动端导航">
            {nav}
          </nav>
          <div className="page">
            <ErrorMessage error={error} />
            {notice && (
              <Alert tone="info" className="notice">
                {notice}
                <Button variant="icon" aria-label="关闭通知" onClick={() => setNotice('')}>
                  <X size={12} />
                </Button>
              </Alert>
            )}
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/index.html" element={<Navigate to="/" replace />} />
              <Route path="/top-conf/*" element={<Papers />} />
              <Route path="/field-briefing/*" element={<Generate kind="field-briefing" />} />
              <Route path="/summary-brief/*" element={<Generate kind="summary-brief" />} />
              <Route path="/secnews/*" element={<News />} />
              <Route path="/inbox/*" element={<Inbox />} />
              <Route path="/authors" element={<Authors />} />
              <Route path="/impression/*" element={<Home />} />
              <Route path="/login" element={<Account />} />
              <Route path="/auth/*" element={<Account />} />
              <Route
                path="*"
                element={
                  <p>
                    页面不存在。<Link to="/">返回总览</Link>
                  </p>
                }
              />
            </Routes>
          </div>
        </main>
      </div>
      <Dialog open={impressionOpen} onClose={() => setImpressionOpen(false)} label="个人印象">
        <div className="dialog-body">
          <div className="dialog-title">
            <h2>个人印象</h2>
            <Button
              variant="icon"
              aria-label="关闭个人印象"
              onClick={() => setImpressionOpen(false)}
            >
              <X size={15} />
            </Button>
          </div>
          {profile ? (
            <>
              <p className="muted">写下你的研究方向、关注问题和希望跟踪的论文类型。</p>
              <TextArea
                aria-label="研究印象"
                value={text}
                maxLength={4000}
                onChange={(e) => setText(e.target.value)}
                rows={8}
              />
              <div className="muted">{Array.from(text).length} / 4000</div>
              <ErrorMessage error={impressionError} />
              <div className="dialog-actions">
                <Button onClick={() => setImpressionOpen(false)}>取消</Button>
                <Button variant="primary" loading={saving} onClick={saveImpression}>
                  保存印象
                </Button>
              </div>
            </>
          ) : (
            <p>
              <Link to="/login" onClick={() => setImpressionOpen(false)}>
                请先登录 FastNews 账号
              </Link>
            </p>
          )}
        </div>
      </Dialog>
    </AppContext.Provider>
  )
}
