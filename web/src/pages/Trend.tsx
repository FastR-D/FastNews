import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Button, EmptyState, InspectorSection, Select, Toolbar } from '@fastrd/ui-react'
import { ArrowUpRight, RotateCw } from 'lucide-react'
import { api, message, safeURL } from '../api'
import { Busy, ErrorMessage, PageHeading, Panel } from '../components/Common'

interface WindowStats {
  start: string
  end: string
  papers: number
  observedDays: number
}

interface Evidence {
  title: string
  url: string
  date: string
  match: string
}

interface TrendReport {
  current: WindowStats
  previous: WindowStats
  stale: boolean
  comparable: boolean
  matched: number
  topics: {
    id: string
    label: string
    keywords: string[]
    count: number
    previous: number
    share: number
    change: number | null
    evidence: Evidence[]
  }[]
  candidates: { phrase: string; count: number; evidence: Evidence[] }[]
}

const scopes = { ai: 'AI 与机器学习', security: '网络安全', software: '软件工程' }
const windows = ['7', '14', '30']
const integer = new Intl.NumberFormat('zh-CN')
const percentage = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 })
const delta = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
})

function Papers({ papers }: { papers: Evidence[] }) {
  return (
    <ul className="list-none m-0 p-0 grid gap-3" aria-label="论文证据">
      {papers.map((paper) => (
        <li key={paper.url} className="min-w-0 break-words">
          <a className="fastui-link" href={safeURL(paper.url)} target="_blank" rel="noreferrer">
            {paper.title} <ArrowUpRight size={12} className="inline" />
          </a>
          <small className="block mt-1 text-[var(--fastui-muted)]">
            {paper.date} · {paper.match}
          </small>
        </li>
      ))}
    </ul>
  )
}

function Coverage({ label, stats }: { label: string; stats: WindowStats }) {
  return (
    <div className="min-w-0">
      <dt className="text-[var(--fastui-muted)]">{label}</dt>
      <dd className="m-0 mt-1 font-semibold tabular-nums">{integer.format(stats.papers)} 篇</dd>
      <dd className="m-0 mt-1 text-11px text-[var(--fastui-muted)] tabular-nums">
        {stats.start} 至 {stats.end} · {stats.observedDays} 个有数据日
      </dd>
    </div>
  )
}

function TrendDisclosure({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <details className="fastui-inspector-section">
      <summary>{label}</summary>
      <div className="fastui-inspector-body">{children}</div>
    </details>
  )
}

export default function Trend() {
  const [params, setParams] = useSearchParams()
  const requestedScope = params.get('scope') || 'ai'
  const scope = Object.hasOwn(scopes, requestedScope) ? requestedScope : 'ai'
  const requestedDays = params.get('days') || '30'
  const days = windows.includes(requestedDays) ? requestedDays : '30'
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ key: string; report?: TrendReport; error?: string }>()
  const query = new URLSearchParams({ scope, days }).toString()
  const requestKey = `${query}:${attempt}`
  const current = result?.key === requestKey ? result : undefined
  const report = current?.report
  const sort = params.get('sort') === 'growth' && report?.comparable ? 'growth' : 'volume'
  const topics = report?.topics || []
  const ranked =
    sort === 'growth'
      ? [...topics].sort((left, right) => (right.change ?? 0) - (left.change ?? 0))
      : topics
  const maxCount = topics[0]?.count || 1

  useEffect(() => {
    const abort = new AbortController()
    api<TrendReport>(`api/trend?${query}`, { signal: abort.signal })
      .then((report) => {
        if (!abort.signal.aborted) setResult({ key: requestKey, report })
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) setResult({ key: requestKey, error: message(error) })
      })
    return () => abort.abort()
  }, [query, requestKey])

  function filter(key: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set(key, value)
      return next
    })
  }

  return (
    <>
      <PageHeading title="研究趋势" />
      <Panel title="研究方向榜">
        <Toolbar label="趋势筛选" className="flex-wrap">
          <label className="fastui-field">
            研究领域
            <Select value={scope} onChange={(event) => filter('scope', event.target.value)}>
              {Object.entries(scopes).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <label className="fastui-field">
            统计窗口
            <Select value={days} onChange={(event) => filter('days', event.target.value)}>
              {windows.map((value) => (
                <option key={value} value={value}>
                  {value} 天
                </option>
              ))}
            </Select>
          </label>
          <label className="fastui-field">
            排序
            <Select value={sort} onChange={(event) => filter('sort', event.target.value)}>
              <option value="volume">论文量</option>
              <option value="growth" disabled={!report?.comparable}>
                占比变化
              </option>
            </Select>
          </label>
        </Toolbar>
        {!current && <Busy />}
        {current?.error && (
          <div className="p-4">
            <ErrorMessage error={current.error} />
            <Button onClick={() => setAttempt((value) => value + 1)}>
              <RotateCw size={14} /> 重试
            </Button>
          </div>
        )}
        {report && (
          <>
            {report.current.end && (
              <div className="px-4 pt-4">
                {report.stale && (
                  <Alert tone="warning">
                    数据截至 {report.current.end}（UTC），此后无已采集的新论文。
                  </Alert>
                )}
                <dl className="grid grid-cols-2 lg:grid-cols-3 gap-4 my-4">
                  <Coverage label="本期样本" stats={report.current} />
                  <Coverage label="前期样本" stats={report.previous} />
                  <div className="min-w-0">
                    <dt className="text-[var(--fastui-muted)]">命中已知方向</dt>
                    <dd className="m-0 mt-1 font-semibold tabular-nums">
                      {integer.format(report.matched)} 篇
                    </dd>
                    <dd className="m-0 mt-1 text-11px text-[var(--fastui-muted)]">
                      未匹配论文仍计入样本
                    </dd>
                  </div>
                </dl>
                {!report.comparable && report.current.papers > 0 && (
                  <p className="text-11px text-[var(--fastui-muted)]">
                    两期采集覆盖不足，暂不比较占比变化。
                  </p>
                )}
              </div>
            )}
            {!ranked.length ? (
              <EmptyState
                title={report.current.papers ? '没有方向达到 3 篇论文' : '该窗口暂无论文数据'}
              />
            ) : (
              <ol
                key={query}
                className="m-0 px-4 pb-4 list-none grid gap-2"
                aria-label="研究方向排名"
              >
                {ranked.map((topic, index) => (
                  <li key={topic.id} className="min-w-0">
                    <TrendDisclosure
                      label={
                        <span className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 w-full items-start">
                          <span className="min-w-0 break-words">
                            <span className="text-[var(--fastui-muted)] tabular-nums mr-2">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            {topic.label}
                          </span>
                          <span className="text-right whitespace-nowrap tabular-nums">
                            {integer.format(topic.count)} 篇 · {percentage.format(topic.share)}%
                            {topic.change !== null && (
                              <span className="block text-11px font-normal text-[var(--fastui-secondary)]">
                                {delta.format(topic.change)} 个百分点
                              </span>
                            )}
                          </span>
                          <span className="col-span-2 min-w-0 break-words font-normal text-11px text-[var(--fastui-muted)]">
                            {topic.keywords.join(' · ')}
                          </span>
                          <progress
                            className="fastui-progress col-span-2 w-full h-2"
                            max={maxCount}
                            value={topic.count}
                            aria-hidden="true"
                          />
                        </span>
                      }
                    >
                      <p className="m-0 text-11px text-[var(--fastui-muted)]">
                        本期 {topic.count} 篇 · 前期 {topic.previous} 篇
                      </p>
                      <Papers papers={topic.evidence} />
                    </TrendDisclosure>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </Panel>
      {!!report?.candidates.length && (
        <Panel title="候选研究术语">
          <ul className="list-none m-0 p-4 grid md:grid-cols-2 gap-2">
            {report.candidates.map((candidate) => (
              <li key={candidate.phrase} className="min-w-0">
                <TrendDisclosure
                  label={
                    <span className="flex items-start justify-between gap-2 w-full">
                      <span className="min-w-0 break-words">{candidate.phrase}</span>
                      <span className="shrink-0 tabular-nums text-[var(--fastui-muted)]">
                        {candidate.count} 篇
                      </span>
                    </span>
                  }
                >
                  <Papers papers={candidate.evidence} />
                </TrendDisclosure>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {report?.current.end && (
        <InspectorSection label="数据口径">
          <p className="m-0 text-[var(--fastui-secondary)]">
            各期按 UTC 采集日等长比较，覆盖现有 AI/NLP、安全与软件工程订阅及其交叉分类，不代表全量
            arXiv。按论文 ID
            去重，同一论文可命中多个方向。候选术语在至少两个采集日、三篇论文的标题和原始摘要中同时出现，尚未归类。
          </p>
        </InspectorSection>
      )}
    </>
  )
}
