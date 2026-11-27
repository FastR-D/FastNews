import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Badge,
  EmptyState,
  InspectorSection,
  ListRow,
  TabBar,
  TextField,
  Toolbar,
} from '@fastrd/ui-react'
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  FileText,
  GraduationCap,
  Search,
  Users,
} from 'lucide-react'
import { useApp } from '../context'
import { api, message, safeURL } from '../api'
import type { NewsArticle } from '../types'
import {
  Busy,
  CatalogState,
  ErrorMessage,
  Metrics,
  PageHeading,
  Panel,
  ReportList,
} from '../components/Common'
import Authors from './Authors'

export default function Home() {
  const { catalog, profile } = useApp()
  const [news, setNews] = useState<NewsArticle[]>([])
  const [newsError, setNewsError] = useState('')
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('conference')
  const [search, setSearch] = useState('')
  useEffect(() => {
    if (!catalog?.dates[0]) return
    const abort = new AbortController()
    setLoading(true)
    setNewsError('')
    api<{ articles: NewsArticle[] }>(`api/news?date=${catalog.dates[0]}`, { signal: abort.signal })
      .then((value) => setNews(value.articles))
      .catch((error) => {
        if (!abort.signal.aborted) setNewsError(message(error))
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => abort.abort()
  }, [catalog?.dates[0]])
  if (!catalog) return <CatalogState />
  const top = catalog.reports.filter((report) => report.kind === 'top-conf')
  const weekly = catalog.reports.filter((report) => report.kind === 'secnews')
  const reports = (tab === 'conference' ? top : weekly).filter((report) =>
    report.title.toLowerCase().includes(search.toLowerCase()),
  )
  return (
    <>
      <PageHeading title="研究工作台" />
      <Metrics
        items={[
          {
            label: '已总结论文',
            value: catalog.topPapers,
            detail: '多领域会议 · 中文摘要',
            icon: <GraduationCap size={16} />,
          },
          {
            label: '研究报告',
            value: catalog.reports.length,
            detail: `${top.length} 份顶会报告 · ${weekly.length} 份资讯周报`,
            icon: <FileText size={16} />,
          },
          {
            label: '研究类别',
            value: catalog.categories.length,
            detail: `${catalog.years.length} 个年份的研究积累`,
            icon: <BookOpen size={16} />,
          },
          {
            label: '关注作者',
            value: profile?.authors.length || 0,
            detail: profile ? '持续跟进感兴趣的研究者' : '登录后建立个人研究网络',
            icon: <Users size={16} />,
          },
        ]}
      />
      <div className="grid min-[1200px]:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
        <div className="min-w-0">
          <Panel
            title="顶会报告"
            action={
              <Link className="fastui-link inline-flex items-center gap-1" to="/top-conf/">
                浏览论文 <ArrowRight size={12} />
              </Link>
            }
          >
            <div className="p-4">
              <TabBar
                label="报告分类"
                tabs={[
                  {
                    id: 'conference',
                    label: `顶会报告 · ${top.length}`,
                    controls: 'report-results',
                  },
                  {
                    id: 'weekly',
                    label: `资讯周报 · ${weekly.length}`,
                    controls: 'report-results',
                  },
                ]}
                activeId={tab}
                onSelect={setTab}
              />
              <Toolbar label="报告筛选">
                <Search size={14} />
                <TextField
                  className="flex-1"
                  aria-label="搜索报告"
                  placeholder="按报告名称筛选…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <span className="text-[var(--fastui-muted)]">{reports.length} 份报告</span>
              </Toolbar>
              <div id="report-results" role="tabpanel" aria-labelledby={tab}>
                <ReportList reports={reports} />
              </div>
            </div>
          </Panel>
          <Authors embedded />
        </div>
        <aside className="min-w-0">
          <Panel
            title="最新快讯"
            action={<Badge tone="success">{catalog.dates[0] || '暂无日期'}</Badge>}
          >
            <ErrorMessage error={newsError} />
            {loading ? (
              <Busy />
            ) : news.length ? (
              <div>
                {news.slice(0, 5).map((article, index) => (
                  <ListRow key={article._id || article.link} className="items-start">
                    <span className="text-[var(--fastui-muted)] tabular-nums">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <a
                        className="fastui-link no-underline break-words"
                        href={safeURL(article.link)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {article.title_zh || article.title}
                      </a>
                      <small className="block mt-2 text-[var(--fastui-muted)]">
                        {article.source_name || article.source}
                      </small>
                    </div>
                  </ListRow>
                ))}
              </div>
            ) : (
              !newsError && <EmptyState title="暂无最新资讯" />
            )}
            <Link
              className="fastui-link flex items-center justify-center gap-2 p-3"
              to={`/secnews/${catalog.dates[0] ? `?date=${catalog.dates[0]}` : ''}`}
            >
              查看全部资讯 <ArrowRight size={13} />
            </Link>
          </Panel>
          <Panel title="我的研究">
            <div className="p-4 grid gap-3">
              <Link className="fastui-link inline-flex items-center gap-1" to="/inbox/">
                查看今日私信 <ArrowRight size={12} />
              </Link>
            </div>
            <InspectorSection label="研究印象" open>
              <p className="m-0 break-words">{profile?.impression.text}</p>
              <Link className="fastui-link" to={profile ? '/impression/' : '/login'}>
                {profile ? '编辑研究印象' : '登录并完善印象'} <ArrowUpRight size={12} />
              </Link>
            </InspectorSection>
          </Panel>
        </aside>
      </div>
    </>
  )
}
