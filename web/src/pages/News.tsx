import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Badge,
  Button,
  EmptyState,
  InspectorSection,
  SegmentedControl,
  Toolbar,
} from '@fastrd/ui-react'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { api, message, safeURL } from '../api'
import { useApp } from '../context'
import type { NewsArticle } from '../types'
import { Busy, ErrorMessage, PageHeading, Panel, ReportList } from '../components/Common'
const sourceLabels: Record<string, string> = {
  thehackernews: 'The Hacker News',
  securityweek: 'SecurityWeek',
}
function channel(a: NewsArticle) {
  const source = a.source.toLowerCase()
  if (source.includes('bleepingcomputer')) return 'bleepingcomputer'
  return 'other'
}
function score(a: NewsArticle) {
  const provided = a.recommendation_score ?? a.importance ?? a.score
  return typeof provided === 'number' &&
    Number.isFinite(provided) &&
    provided >= 0 &&
    provided <= 10
    ? provided
    : null
}
export default function News() {
  const { catalog } = useApp()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') || catalog?.dates[0] || ''
  const [month, setMonth] = useState(''),
    [articles, setArticles] = useState<NewsArticle[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [kind, setKind] = useState('all'),
    [showAll, setShowAll] = useState(false)
  useEffect(() => {
    if (date) {
      setMonth(date.slice(0, 7))
      const abort = new AbortController()
      setBusy(true)
      setError('')
      setShowAll(false)
      api<{ articles: NewsArticle[] }>(
        `api/news?${new URLSearchParams({ date, source: 'security' })}`,
        { signal: abort.signal },
      )
        .then((v) => setArticles(v.articles))
        .catch((e) => {
          if (!abort.signal.aborted) setError(message(e))
        })
        .finally(() => {
          if (!abort.signal.aborted) setBusy(false)
        })
      return () => abort.abort()
    }
  }, [date])
  const available = useMemo(() => new Set(catalog?.dates || []), [catalog])
  const first = new Date(
    `${month || date.slice(0, 7) || new Date().toISOString().slice(0, 7)}-01T00:00:00`,
  )
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const offset = (first.getDay() + 6) % 7
  function move(delta: number) {
    const next = new Date(first.getFullYear(), first.getMonth() + delta, 1)
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
  }
  const boards = !showAll
    ? ['top']
    : kind === 'all'
      ? ['bleepingcomputer', ...(articles.some((a) => channel(a) === 'other') ? ['other'] : [])]
      : [kind]
  return (
    <>
      <PageHeading
        title="安全资讯"
        description="按日期浏览安全新闻，查看每日导读和重点推荐。预印本请进入 arXiv 导读。"
      />
      <div className="grid min-[1100px]:grid-cols-[260px_minmax(0,1fr)] gap-4 items-start">
        <aside>
          <Panel title="资讯日历">
            <div data-testid="calendar" className="p-3">
              <div className="flex items-center justify-between mb-3">
                <Button
                  variant="icon"
                  aria-label="上个月"
                  disabled={
                    !!catalog?.dates.length &&
                    month <= catalog.dates[catalog.dates.length - 1].slice(0, 7)
                  }
                  onClick={() => move(-1)}
                >
                  <ChevronLeft size={16} />
                </Button>
                <strong>{month.replace('-', ' 年 ')} 月</strong>
                <Button
                  variant="icon"
                  aria-label="下个月"
                  disabled={!!catalog?.dates.length && month >= catalog.dates[0].slice(0, 7)}
                  onClick={() => move(1)}
                >
                  <ChevronRight size={16} />
                </Button>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {'一二三四五六日'.split('').map((d) => (
                  <span className="text-center text-[var(--fastui-muted)]" key={d}>
                    {d}
                  </span>
                ))}
                {Array.from({ length: offset }, (_, i) => (
                  <span key={`empty-${i}`} />
                ))}
                {Array.from({ length: days }, (_, i) => {
                  const day = `${month}-${String(i + 1).padStart(2, '0')}`
                  return (
                    <Button
                      key={day}
                      variant={day === date ? 'primary' : 'quiet'}
                      title={available.has(day) ? '当天有资讯' : '当天无资讯'}
                      aria-label={day}
                      aria-pressed={day === date}
                      disabled={!available.has(day)}
                      onClick={() => setParams({ date: day })}
                    >
                      {i + 1}
                    </Button>
                  )
                })}
              </div>
              <p className="text-[var(--fastui-muted)]">可选日期表示当天有资讯</p>
            </div>
          </Panel>
          <Panel title="安全资讯周报">
            <ReportList reports={catalog?.reports.filter((r) => r.kind === 'secnews') || []} />
          </Panel>
        </aside>
        <Panel
          title={date ? `${date} · 每日资讯` : '每日资讯'}
          action={<Badge>{articles.length} 条</Badge>}
        >
          <Toolbar label="资讯筛选">
            <SegmentedControl
              label="资讯频道"
              options={[
                { value: 'all', label: '全部' },
                { value: 'bleepingcomputer', label: 'BleepingComputer' },
                { value: 'other', label: '更多安全来源' },
              ]}
              value={kind}
              onChange={(value) => {
                setKind(value)
                setShowAll(true)
              }}
            />
            <Button onClick={() => setShowAll(!showAll)}>
              {showAll ? '收起详情' : '查看全部详情'}
            </Button>
          </Toolbar>
          <ErrorMessage error={error} />
          {busy ? (
            <Busy />
          ) : articles.length === 0 ? (
            <EmptyState title="当天暂无资讯" />
          ) : (
            <div className="grid">
              {boards.map((board) => {
                const sorted = articles
                  .filter((a) =>
                    board === 'top' ? kind === 'all' || channel(a) === kind : channel(a) === board,
                  )
                  .sort(
                    (a, b) =>
                      (score(b) ?? -1) - (score(a) ?? -1) ||
                      (Date.parse(b.published || '') || 0) - (Date.parse(a.published || '') || 0),
                  )
                const scored = sorted.filter((article) => score(article) !== null)
                const prioritised = !showAll && scored.length ? scored : sorted
                return (
                  <InspectorSection
                    key={board}
                    open
                    label={`${board === 'top' ? (scored.length ? '优先推荐 · Top 10' : '最新资讯 · 尚未评分') : board === 'bleepingcomputer' ? 'BleepingComputer' : '其他来源'} · ${prioritised.length} 条`}
                  >
                    {(showAll ? prioritised : prioritised.slice(0, 10)).map((a, i) => (
                      <article
                        data-testid="news-row"
                        className="flex gap-3 p-4 border-b border-b-solid border-b-[var(--fastui-border)]"
                        key={a._id || a.link}
                      >
                        <div className="text-[var(--fastui-muted)] tabular-nums shrink-0">
                          {String(i + 1).padStart(2, '0')}
                        </div>
                        <div className="min-w-0">
                          <h3 className="fastui-heading my-2">
                            <a
                              className="fastui-link break-words"
                              href={safeURL(a.link)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {a.title_zh || a.title}
                              <ExternalLink size={12} />
                            </a>
                          </h3>
                          {(a.summary_zh || a.description) && (
                            <p className="leading-loose text-[var(--fastui-secondary)] break-words">
                              {showAll
                                ? a.summary_zh || a.description
                                : (a.summary_zh || a.description)?.slice(0, 220)}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-2 text-[var(--fastui-muted)]">
                            <Badge>
                              {channel(a) === 'bleepingcomputer'
                                ? 'BleepingComputer'
                                : sourceLabels[a.source] || '其他来源'}
                            </Badge>
                            <span title={a.score_reason}>
                              {score(a) === null ? '尚未评分' : `价值 ${score(a)!.toFixed(1)}`}
                            </span>
                            <span>{a.published?.slice(0, 10)}</span>
                            {a.author && <span>{a.author}</span>}
                          </div>
                        </div>
                      </article>
                    ))}
                    {!showAll && prioritised.length > 10 && (
                      <Button className="m-3" onClick={() => setShowAll(true)}>
                        展开全部 {sorted.length} 条资讯
                      </Button>
                    )}
                    {sorted.length === 0 && <EmptyState title="该频道当天暂无资讯" />}
                  </InspectorSection>
                )
              })}
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}
