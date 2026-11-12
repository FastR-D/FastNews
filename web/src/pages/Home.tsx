import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AssetCard,
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
  ChartNoAxesCombined,
  FileText,
  GraduationCap,
  Mail,
  Search,
  Sparkles,
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
  const navigate = useNavigate()
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
  const reports = (tab === 'conference' ? top : tab === 'weekly' ? weekly : catalog.reports).filter(
    (report) => report.title.toLowerCase().includes(search.toLowerCase()),
  )
  return (
    <>
      <PageHeading
        title="安全研究报告工作台"
        description="跟进安全动态，发现研究线索，让每一次阅读有所积累。"
        action={
          <Link className="fastui-button fastui-button--primary no-underline" to="/field-briefing/">
            <Sparkles size={14} />
            探索研究方向
          </Link>
        }
      />
      <Metrics
        items={[
          {
            label: '已总结论文',
            value: catalog.topPapers,
            detail: '四大安全顶会 · 中文摘要',
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
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-[var(--fastui-muted)]">
            <h2 className="fastui-heading m-0 text-sm">开始你的研究</h2>
            <span>从问题出发，连接证据与洞见</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 mb-5">
            <AssetCard
              label="领域导读"
              description="梳理研究脉络、关键进展与开放问题，推荐高相关论文。"
              preview={<BookOpen size={28} />}
              onClick={() => navigate('/field-briefing/')}
            />
            <AssetCard
              label="总结汇报"
              description="从顶会摘要中提炼发现，生成有论文证据支撑的实证简报。"
              preview={<ChartNoAxesCombined size={28} />}
              onClick={() => navigate('/summary-brief/')}
            />
          </div>
          <Panel
            title="顶会报告"
            action={
              <Link className="fastui-link inline-flex items-center gap-1" to="/top-conf/">
                浏览论文 <ArrowRight size={12} />
              </Link>
            }
          >
            <TabBar
              label="报告分类"
              tabs={[
                { id: 'conference', label: `顶会报告 · ${top.length}`, controls: 'report-results' },
                {
                  id: 'weekly',
                  label: `安全资讯周报 · ${weekly.length}`,
                  controls: 'report-results',
                },
                { id: 'downloads', label: '全部下载', controls: 'report-results' },
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
              <ReportList reports={reports} download={tab === 'downloads'} />
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
                        {article.source}
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
              <span className="text-[var(--fastui-focus)]">
                <Mail size={18} />
              </span>
              <h3 className="fastui-heading m-0 text-sm">每天一篇，保持研究节奏</h3>
              <p className="m-0 text-[var(--fastui-secondary)]">
                结合关注作者与研究印象，发现值得阅读的论文。
              </p>
              <Link className="fastui-link inline-flex items-center gap-1" to="/inbox/">
                查看今日私信 <ArrowRight size={12} />
              </Link>
            </div>
            <InspectorSection label="研究印象" open>
              <p className="m-0 break-words">
                {profile?.impression.text || '记录研究方向和关注问题，让论文推荐更贴近你。'}
              </p>
              <Link className="fastui-link" to={profile ? '/impression/' : '/login'}>
                {profile ? '编辑研究印象' : '登录并完善印象'} <ArrowUpRight size={12} />
              </Link>
            </InspectorSection>
          </Panel>
          <div className="flex gap-3 items-center p-4 text-[var(--fastui-muted)]">
            <BookOpen size={15} />
            <p>
              以论文证据为起点，
              <br />
              持续连接你的研究兴趣。
            </p>
          </div>
        </aside>
      </div>
    </>
  )
}
