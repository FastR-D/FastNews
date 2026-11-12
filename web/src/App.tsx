import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Dialog, EmptyState, StatusBar, TextField } from '@fastrd/ui-react'
import {
  ChevronRight,
  LogIn,
  Menu,
  Moon,
  Search,
  BookOpen,
  ChartNoAxesCombined,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  UserRound,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { AppProvider, useApp } from './context'
import { Busy } from './components/Common'
import ImpressionDialog from './components/ImpressionDialog'
import { navigation, currentPage } from './navigation'
import { theme } from './theme'
const Home = lazy(() => import('./pages/Home'))
const Papers = lazy(() => import('./pages/Papers'))
const News = lazy(() => import('./pages/News'))
const Generate = lazy(() => import('./pages/Generate'))
const Authors = lazy(() => import('./pages/Authors'))
const Inbox = lazy(() => import('./pages/Inbox'))
const Account = lazy(() => import('./pages/Account'))
const UsersPage = lazy(() => import('./pages/Users'))

function Workspace() {
  const { catalog, profile, notice, notify, catalogError, retryCatalog } = useApp()
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
    if (location.pathname.startsWith('/impression')) setImpressionOpen(true)
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
        className="fastui-button fastui-button--quiet no-underline box-border"
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
    <div className="flex flex-col flex-1 min-h-0 px-3 min-[1101px]:px-4 pt-7 pb-4">
      <div className="grid gap-2 px-2 pb-6">
        <Link to="/field-briefing/" className="fastui-button fastui-button--primary no-underline">
          <BookOpen size={14} />
          探索研究方向
        </Link>
        <Link to="/summary-brief/" className="fastui-button no-underline">
          <ChartNoAxesCombined size={14} />
          生成总结汇报
        </Link>
      </div>
      <nav aria-label="主导航" className="grid gap-5">
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
          <div className="grid auto-rows-[minmax(38px,auto)]">
            <NavLink
              className="fastui-button fastui-button--quiet no-underline"
              to="/admin/users"
              aria-pressed={location.pathname.startsWith('/admin/users')}
            >
              <span className="flex items-center gap-2 w-full">
                <Users size={16} />
                用户管理
              </span>
            </NavLink>
          </div>
        )}
      </nav>
      <div className="mt-auto pt-8 px-3 text-[var(--fastui-muted)]">
        <p className="text-11px m-0">安全研究，持续积累。</p>
        <p className="text-11px mt-1 mb-0">
          {catalog
            ? `${catalog.topPapers.toLocaleString()} 篇论文 · ${catalog.reports.length} 份报告`
            : '发现值得深入的问题'}
        </p>
      </div>
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
          className="min-h-14 flex items-center gap-3 px-3 sm:px-5 min-[901px]:px-7"
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
            className="fastui-link inline-flex items-center gap-2 no-underline shrink-0"
            to="/"
          >
            <Zap size={28} />
            <strong className="text-17px text-[var(--fastui-text)]">FastNews</strong>
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
            <Link
              to="/login"
              className="fastui-button fastui-button--quiet no-underline"
              aria-label={profile?.person || '登录'}
            >
              <LogIn size={14} />
              <span className="hidden sm:inline max-w-28 truncate">
                {profile?.person || '登录'}
              </span>
            </Link>
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
              className="w-50 min-[1101px]:w-56 box-border flex flex-col bg-[var(--fastui-chrome)] border-r border-r-solid border-r-[var(--fastui-border)] overflow-y-auto"
              id="workspace-navigation"
              aria-label="工作空间"
            >
              {sidebar}
            </aside>
          )}
        </div>
        <main
          className="min-w-0 flex-1 flex flex-col bg-[var(--fastui-surface)]"
          id="main-content"
          tabIndex={-1}
        >
          <div className="p-3 sm:p-6 min-[1101px]:px-10 min-[1101px]:pt-8 min-w-0 flex-1 w-full box-border max-w-400 mx-auto">
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
                <Route path="/" element={<Home />} />
                <Route path="/index.html" element={<Navigate to="/" replace />} />
                <Route path="/top-conf/*" element={<Papers />} />
                <Route
                  path="/field-briefing/*"
                  element={<Generate key="field-briefing" kind="field-briefing" />}
                />
                <Route
                  path="/summary-brief/*"
                  element={<Generate key="summary-brief" kind="summary-brief" />}
                />
                <Route path="/secnews/*" element={<News />} />
                <Route path="/inbox/*" element={<Inbox />} />
                <Route path="/authors" element={<Authors />} />
                <Route path="/impression/*" element={<Home />} />
                <Route path="/login" element={<Account />} />
                <Route path="/auth/*" element={<Account />} />
                <Route path="/admin/users" element={<UsersPage />} />
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
            </Suspense>
          </div>
          <StatusBar role="contentinfo" aria-label="工作台状态">
            <span>FastNews</span>
            <span>
              {catalog
                ? `${catalog.topPapers.toLocaleString()} 篇顶会论文 · ${catalog.reports.length} 份报告`
                : '安全研究报告工作台'}
            </span>
            <span className="ml-auto hidden sm:inline">
              {profile ? '个人研究空间' : '公开资料库'}
            </span>
          </StatusBar>
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
      <Workspace />
    </AppProvider>
  )
}
