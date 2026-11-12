import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Button, EmptyState, SegmentedControl } from '@fastrd/ui-react'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { api, message, safeURL } from '../api'
import { useApp } from '../context'
import type { NewsArticle } from '../types'
import { Busy, ErrorMessage, PageHeading, Panel, ReportList } from '../components/Common'
function channel(a: NewsArticle) {
  const source = a.source.toLowerCase()
  if (source.includes('bleepingcomputer')) return 'bleepingcomputer'
  if (source.includes('arxiv')) return 'arxiv'
  return 'other'
}
function score(a: NewsArticle) {
  const provided = a.recommendation_score ?? a.importance ?? a.score
  if (provided !== undefined && Number.isFinite(provided))
    return Math.max(0, Math.min(10, provided))
  const text = [a.title, a.title_zh, a.summary_zh, a.description].join(' ').toLowerCase()
  let value = channel(a) === 'bleepingcomputer' ? 4.6 : 4.2
  for (const term of [
    'zero-day',
    '0-day',
    'actively exploited',
    'vulnerability',
    'ransomware',
    'prompt injection',
    'jailbreak',
  ])
    if (text.includes(term))
      value += ['zero-day', '0-day', 'actively exploited'].includes(term) ? 2 : 0.7
  return Math.min(10, value)
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
      api<{ articles: NewsArticle[] }>(`api/news?date=${date}`, { signal: abort.signal })
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
  const first = new Date(`${month || date.slice(0, 7) || '2026-11'}-01T00:00:00`)
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const offset = (first.getDay() + 6) % 7
  function move(delta: number) {
    const next = new Date(first.getFullYear(), first.getMonth() + delta, 1)
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
  }
  const boards = !showAll
    ? ['top']
    : kind === 'all'
      ? [
          'bleepingcomputer',
          'arxiv',
          ...(articles.some((a) => channel(a) === 'other') ? ['other'] : []),
        ]
      : [kind]
  return (
    <>
      <PageHeading
        title="安全资讯"
        description="按日期浏览安全新闻与 AI 研究，查看每日导读和重点推荐。"
      />
      <div className="workspace news-workspace">
        <aside>
          <Panel title="资讯日历">
            <div className="calendar">
              <div className="calendar-toolbar">
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
              <div className="calendar-grid">
                {'一二三四五六日'.split('').map((d) => (
                  <span className="weekday" key={d}>
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
                      className={available.has(day) ? 'has-news' : ''}
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
              <p className="muted">圆点表示当天有资讯</p>
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
          <div className="news-toolbar">
            <SegmentedControl
              label="资讯频道"
              options={[
                { value: 'all', label: '全部' },
                { value: 'bleepingcomputer', label: 'BleepingComputer' },
                { value: 'arxiv', label: 'arXiv' },
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
          </div>
          <ErrorMessage error={error} />
          {busy ? (
            <Busy />
          ) : articles.length === 0 ? (
            <EmptyState title="当天暂无资讯" />
          ) : (
            <div className="news-boards">
              {boards.map((board) => {
                const sorted = articles
                  .filter((a) =>
                    board === 'top' ? kind === 'all' || channel(a) === kind : channel(a) === board,
                  )
                  .sort((a, b) => score(b) - score(a))
                return (
                  <details open key={board} className="news-channel">
                    <summary className="board-head">
                      <small>{board === 'top' ? 'TOP PICKS' : 'CHANNEL'}</small>
                      <h3>
                        {board === 'top'
                          ? '优先推荐'
                          : board === 'bleepingcomputer'
                            ? 'BleepingComputer'
                            : board === 'arxiv'
                              ? 'arXiv'
                              : '其他来源'}{' '}
                        <Badge>{sorted.length}</Badge>
                      </h3>
                    </summary>
                    {(showAll ? sorted : sorted.slice(0, 10)).map((a, i) => (
                      <article className="news-row" key={a._id || a.link}>
                        <div className="news-rank">{String(i + 1).padStart(2, '0')}</div>
                        <div>
                          <h3>
                            <a href={safeURL(a.link)} target="_blank" rel="noreferrer">
                              {a.title_zh || a.title}
                              <ExternalLink size={12} />
                            </a>
                          </h3>
                          {(a.summary_zh || a.description) && (
                            <p className="paper-summary">
                              {showAll
                                ? a.summary_zh || a.description
                                : (a.summary_zh || a.description)?.slice(0, 220)}
                            </p>
                          )}
                          <div className="paper-meta">
                            <Badge>
                              {channel(a) === 'bleepingcomputer'
                                ? 'BleepingComputer'
                                : channel(a) === 'arxiv'
                                  ? 'arXiv'
                                  : '其他来源'}
                            </Badge>
                            <span title={a.score_reason}>价值 {score(a).toFixed(1)}</span>
                            <span>{a.published?.slice(0, 10)}</span>
                            {a.author && <span>{a.author}</span>}
                          </div>
                        </div>
                      </article>
                    ))}
                    {!showAll && sorted.length > 10 && (
                      <Button className="show-more" onClick={() => setShowAll(true)}>
                        展开剩余 {sorted.length - 10} 条
                      </Button>
                    )}
                    {sorted.length === 0 && <EmptyState title="该频道当天暂无资讯" />}
                  </details>
                )
              })}
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}
