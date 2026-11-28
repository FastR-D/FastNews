import BackToTop from './components/BackToTop'
import './components/Reading.css'
import { AccountMenu } from './components/AccountMenu'
import { api, message } from './api'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Dialog, EmptyState, TextField } from '@fastrd/ui-react'
import {
  ChevronRight,
  LogIn,
  Menu,
  Moon,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  UserRound,
  Users,
  Activity,
  X,
  Newspaper,
} from 'lucide-react'
import { AppProvider, useApp } from './context'
import { Busy } from './components/Common'
import ImpressionDialog from './components/ImpressionDialog'
import { navigation, currentPage } from './navigation'
import { theme } from './theme'
const EntityPage = lazy(() => import('./pages/Entity'))
const ReportReader = lazy(() => import('./pages/ReportReader'))
const Home = lazy(() => import('./pages/Home'))
const Papers = lazy(() => import('./pages/Papers'))
const Coverage = lazy(() => import('./pages/Coverage'))
const News = lazy(() => import('./pages/News'))
const Sources = lazy(() => import('./pages/Sources'))
const Arxiv = lazy(() => import('./pages/Arxiv'))
const Trend = lazy(() => import('./pages/Trend'))
const Generate = lazy(() => import('./pages/Generate'))
const Authors = lazy(() => import('./pages/Authors'))
const Inbox = lazy(() => import('./pages/Inbox'))
const Account = lazy(() => import('./pages/Account'))
const UsersPage = lazy(() => import('./pages/Users'))
const Processes = lazy(() => import('./pages/Processes'))

function Workspace() {
  const { catalog, profile, notice, notify, catalogError, retryCatalog, refresh } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const current = currentPage(location.pathname)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('fastnews-sidebar-collapsed') === 'true'
    } catch {
      return false
    }
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mode, setMode] = useState(theme.resolved)
  const [impressionOpen, setImpressionOpen] = useState(false)
  const [query, setQuery] = useState('')
  useEffect(() => theme.subscribe((state) => setMode(state.resolved)), [])
  useEffect(() => {
    setMobileOpen(false)
    document.title = `${current.label} · FastNews`
    if (location.hash)
      requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView())
    else window.scrollTo(0, 0)
  }, [location.pathname, location.hash, current.label])
  const navItem = (item: (typeof navigation)[number]) => {
    const count =
      item.to === '/top-conf/'
        ? catalog?.reports.filter((report) => report.kind === 'top-conf').length
        : item.to === '/inbox/'
          ? profile?.inboxUnread
          : undefined
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === '/'}
        className="workspace-navlink"
        aria-pressed={
          item.to === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.to.replace(/\/$/, ''))
        }
      >
        <span className="flex items-center gap-2 w-full min-w-0">
          <item.icon size={16} className="shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
          {!!count && (
            <span
              className="text-11px tabular-nums"
              aria-label={`${count} ${item.to === '/inbox/' ? '条未读' : '份报告'}`}
            >
              {count}
            </span>
          )}
        </span>
      </NavLink>
    )
  }
  const sidebar = (
    <div className="flex flex-col flex-1 min-h-0 px-3 pt-5 pb-4">
      <nav aria-label="主导航" className="grid gap-4">
        {['工作空间', '发现与研究', '我的研究'].map((group) => (
          <div key={group}>
            <p className="mx-3 mt-0 mb-2 text-11px text-[var(--fastui-muted)]">
              {group === '工作空间' ? '工作区' : group}
            </p>
            <div className="grid auto-rows-[minmax(38px,auto)] gap-1">
              {navigation.filter((item) => item.group === group).map(navItem)}
            </div>
          </div>
        ))}
        {profile?.role === 'admin' && (
          <div>
            <p className="mx-3 mt-0 mb-2 text-11px text-[var(--fastui-muted)]">管理员工作台</p>
            <div className="grid auto-rows-[minmax(38px,auto)] gap-1">
              <NavLink
                className="workspace-navlink"
                to="/admin/users/"
                aria-pressed={location.pathname.startsWith('/admin/users')}
              >
                <span className="flex items-center gap-2 w-full">
                  <Users size={16} />
                  用户管理
                </span>
              </NavLink>
              <NavLink
                className="workspace-navlink"
                to="/admin/jobs/"
                aria-pressed={location.pathname.startsWith('/admin/jobs/')}
              >
                <span className="flex items-center gap-2 w-full">
                  <Activity size={16} />
                  进程管理
                </span>
              </NavLink>
            </div>
          </div>
        )}
      </nav>
    </div>
  )
  return (
    <div className="min-h-dvh flex flex-col">
      <a className="fastui-link sr-only focus:not-sr-only" href="#main-content">
        跳转到主要内容
      </a>
      <header
        data-testid="workspace-header"
        className="sticky top-0 z-20 bg-[var(--fastui-surface)] border-b border-b-solid border-b-[var(--fastui-border)]"
      >
        <div
          role="group"
          aria-label="工作台操作"
          className="min-h-14 flex items-center gap-2 sm:gap-3 px-3 sm:px-5"
        >
          <span className="min-[901px]:hidden">
            <Button
              variant="icon"
              aria-label="打开导航"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={16} />
            </Button>
          </span>
          <Link
            data-testid="brand"
            aria-label="FastNews 首页"
            className="fastui-link inline-flex items-center gap-2 no-underline shrink-0"
            to="/"
          >
            <span className="grid place-items-center w-8 h-8 rounded-lg bg-[var(--fastui-primary)] text-[var(--fastui-on-primary)]">
              <Newspaper size={20} />
            </span>
            <strong className="hidden min-[400px]:inline text-base text-[var(--fastui-text)]">
              FastNews
            </strong>
          </Link>
          <span className="hidden min-[901px]:inline-flex">
            <Button
              variant="icon"
              aria-label={collapsed ? '打开总览栏' : '隐藏总览栏'}
              aria-expanded={!collapsed}
              onClick={() => {
                setCollapsed(!collapsed)
                try {
                  localStorage.setItem('fastnews-sidebar-collapsed', String(!collapsed))
                } catch {
                  /* Storage is optional. */
                }
              }}
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </Button>
          </span>
          <form
            className="hidden md:flex items-center gap-2 mx-auto min-w-0"
            role="search"
            onSubmit={(event) => {
              event.preventDefault()
              navigate(`/top-conf/?q=${encodeURIComponent(query.trim())}`)
            }}
          >
            <Search size={14} />
            <TextField
              aria-label="全站论文搜索"
              placeholder="搜索论文、研究方向…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button type="submit" variant="quiet" aria-label="提交全站搜索">
              <ChevronRight size={15} />
            </Button>
          </form>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Button variant="quiet" aria-label="个人印象" onClick={() => setImpressionOpen(true)}>
              <UserRound size={14} />
              <span className="hidden sm:inline">个人印象</span>
            </Button>
            {profile ? (
              <AccountMenu
                name={profile.person}
                detail={profile.email}
                actions={[
                  { label: '账号设置', onSelect: () => navigate('/account/') },
                  {
                    label: '退出登录',
                    danger: true,
                    onSelect: () => {
                      void api(
                        profile.source === 'research' ? 'api/content/logout' : 'api/auth/logout',
                        { method: 'POST', body: '{}' },
                      )
                        .then(() => refresh())
                        .then(() => navigate('/login'))
                        .catch((error) => notify(message(error)))
                    },
                  },
                ]}
              />
            ) : (
              <Link
                to="/login"
                className="fastui-button fastui-button--quiet no-underline whitespace-nowrap"
                aria-label="登录"
              >
                <LogIn size={14} />
                登录
              </Link>
            )}
            <Button
              variant="icon"
              aria-label={mode === 'dark' ? '切换浅色模式' : '切换深色模式'}
              onClick={() => theme.setMode(mode === 'dark' ? 'light' : 'dark')}
            >
              {mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
          </div>
        </div>
      </header>
      <div className="flex flex-1 min-w-0">
        <div className="hidden min-[901px]:flex sticky top-14 self-start h-[calc(100dvh-56px)]">
          {!collapsed && (
            <aside
              className="w-56 box-border flex flex-col bg-[var(--fastui-chrome)] border-r border-r-solid border-r-[var(--fastui-border)] overflow-y-auto"
              id="workspace-navigation"
              aria-label="工作空间"
            >
              {sidebar}
            </aside>
          )}
        </div>
        <main
          className="min-w-0 flex-1 flex flex-col bg-[var(--fastui-chrome)]"
          id="main-content"
          tabIndex={-1}
        >
          <div className="workspace-content">
            {catalogError && (
              <Alert tone="danger" className="flex items-center justify-between gap-3 mb-4">
                <span>{catalogError}</span>
                <Button onClick={retryCatalog}>重新加载</Button>
              </Alert>
            )}
            {notice && (
              <Alert tone="info" className="flex items-center justify-between gap-3 mb-4">
                <span>{notice}</span>
                <Button variant="icon" aria-label="关闭通知" onClick={() => notify('')}>
                  <X size={14} />
                </Button>
              </Alert>
            )}
            <Suspense fallback={<Busy />}>
              <Routes>
                <Route path="/authors/:name/" element={<EntityPage kind="author" />} />
                <Route path="/institutions/:name/" element={<EntityPage kind="institution" />} />
                <Route
                  path="/"
                  element={<Home onEditImpression={() => setImpressionOpen(true)} />}
                />
                <Route path="/top-conf/" element={<Papers />} />
                <Route path="/coverage/" element={<Coverage />} />
                <Route
                  path="/brief/"
                  element={<Generate key="field-briefing" kind="field-briefing" />}
                />
                <Route
                  path="/summary/"
                  element={<Generate key="summary-brief" kind="summary-brief" />}
                />
                <Route path="/updates/" element={<News />} />
                <Route path="/sources/" element={<Sources />} />
                <Route path="/top-conf/:conference/:year/" element={<ReportReader />} />
                <Route path="/reports/:kind/:slug/" element={<ReportReader />} />
                <Route path="/arxiv/" element={<Arxiv />} />
                <Route path="/trends/" element={<Trend />} />
                <Route path="/inbox/" element={<Inbox />} />
                <Route path="/following/" element={<Authors />} />
                <Route path="/login" element={<Account />} />
                <Route path="/account/" element={<Account />} />
                <Route path="/admin/users/" element={<UsersPage />} />
                <Route path="/admin/jobs/" element={<Processes />} />
                <Route
                  path="*"
                  element={
                    <EmptyState
                      title="页面不存在"
                      action={
                        <Link className="fastui-link" to="/">
                          返回总览
                        </Link>
                      }
                    >
                      请通过导航继续浏览研究内容。
                    </EmptyState>
                  }
                />
              </Routes>
              <BackToTop />
            </Suspense>
          </div>
        </main>
      </div>
      <Dialog open={mobileOpen} onClose={() => setMobileOpen(false)} label="工作空间导航">
        <header className="flex items-center justify-between">
          <h2 className="fastui-heading m-0 text-base">工作空间</h2>
          <Button variant="icon" aria-label="关闭导航" onClick={() => setMobileOpen(false)}>
            <X size={16} />
          </Button>
        </header>
        {sidebar}
      </Dialog>
      <ImpressionDialog open={impressionOpen} onClose={() => setImpressionOpen(false)} />
    </div>
  )
}
export default function App() {
  return (
    <AppProvider>
      <AccessGate />
    </AppProvider>
  )
}

function AccessGate() {
  const { profile, authReady, requireLogin } = useApp()
  const location = useLocation()
  if (!authReady) return <Busy />
  if (requireLogin && !profile) {
    if (location.pathname !== '/login')
      return (
        <Navigate
          to={`/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`}
          replace
        />
      )
    return (
      <main className="login-shell">
        <div className="login-card">
          <Suspense fallback={<Busy />}>
            <Account />
          </Suspense>
        </div>
      </main>
    )
  }
  return <Workspace />
}
