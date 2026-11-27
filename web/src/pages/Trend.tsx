import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Button, EmptyState, Select } from '@fastrd/ui-react'
import { ArrowUpRight, ChevronDown, RotateCw } from 'lucide-react'
import { api, message, safeURL } from '../api'
import { Busy, ErrorMessage, PageHeading } from '../components/Common'

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
    <ul className="trend-evidence" aria-label="论文证据">
      {papers.map((paper) => (
        <li key={paper.url}>
          <a href={safeURL(paper.url)} target="_blank" rel="noreferrer">
            {paper.title}
            <ArrowUpRight size={15} />
          </a>
          <span>
            {paper.date} · {paper.match}
          </span>
        </li>
      ))}
    </ul>
  )
}
function Coverage({ label, stats }: { label: string; stats: WindowStats }) {
  return (
    <div className="trend-card trend-stat">
      <dt>{label}</dt>
      <dd>
        <strong>{integer.format(stats.papers)}</strong>
        <span>篇论文</span>
      </dd>
      <dd className="trend-stat-period">
        <span>{stats.start}</span>
        <span aria-hidden="true">—</span>
        <span>{stats.end}</span>
      </dd>
      <dd className="trend-stat-note">覆盖 {stats.observedDays} 个采集日</dd>
    </div>
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
    <div className="trend-page">
      <PageHeading title="研究趋势" />
      <section className="trend-card trend-filters" aria-label="趋势筛选">
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
      </section>
      {!current && <Busy />}
      {current?.error && (
        <div className="trend-card trend-feedback">
          <ErrorMessage error={current.error} />
          <Button onClick={() => setAttempt((value) => value + 1)}>
            <RotateCw size={14} />
            重试
          </Button>
        </div>
      )}
      {report && (
        <>
          {report.current.end && (
            <>
              {report.stale && (
                <Alert tone="warning">
                  数据截至 {report.current.end}（UTC），此后无已采集的新论文。
                </Alert>
              )}
              <dl className="trend-overview">
                <Coverage label="本期样本" stats={report.current} />
                <Coverage label="前期样本" stats={report.previous} />
                <div className="trend-card trend-stat trend-stat--accent">
                  <dt>命中已知方向</dt>
                  <dd>
                    <strong>{integer.format(report.matched)}</strong>
                    <span>篇论文</span>
                  </dd>
                  <dd className="trend-stat-period">{topics.length} 个研究方向</dd>
                  <dd className="trend-stat-note">未匹配论文仍计入样本</dd>
                </div>
              </dl>
            </>
          )}
          <section aria-labelledby="trend-topics-title">
            <header className="trend-section-header">
              <h2 id="trend-topics-title">研究方向榜</h2>
              <span>{scopes[scope as keyof typeof scopes]}</span>
            </header>
            {!report.comparable && report.current.papers > 0 && (
              <p className="trend-coverage-note">两期采集覆盖不足，暂不比较占比变化。</p>
            )}
            {!ranked.length ? (
              <div className="trend-card">
                <EmptyState
                  title={report.current.papers ? '没有方向达到 3 篇论文' : '该窗口暂无论文数据'}
                />
              </div>
            ) : (
              <ol key={query} className="trend-topic-list" aria-label="研究方向排名">
                {ranked.map((topic, index) => (
                  <li key={topic.id} className="trend-card">
                    <details className="trend-topic">
                      <summary>
                        <span className="trend-topic-heading">
                          <span className="trend-rank">{String(index + 1).padStart(2, '0')}</span>
                          <span className="trend-topic-title">{topic.label}</span>
                        </span>
                        <span className="trend-topic-metrics">
                          <span>
                            <strong>{integer.format(topic.count)}</strong> 篇
                          </span>
                          <span className="trend-share">{percentage.format(topic.share)}%</span>
                        </span>
                        <span className="trend-keywords">
                          {topic.keywords.slice(0, 3).map((word) => (
                            <span key={word}>{word}</span>
                          ))}
                        </span>
                        <span
                          className={`trend-topic-change${topic.change !== null && topic.change > 0 ? ' trend-change-positive' : ''}`}
                        >
                          {topic.change !== null
                            ? `${delta.format(topic.change)} 个百分点`
                            : `前期 ${topic.previous} 篇`}
                        </span>
                        <progress
                          max={maxCount}
                          value={topic.count}
                          aria-label={`${topic.label}论文量`}
                          className="trend-progress"
                        />
                        <ChevronDown className="trend-chevron" size={17} />
                      </summary>
                      <Papers papers={topic.evidence} />
                    </details>
                  </li>
                ))}
              </ol>
            )}
          </section>
          {!!report.candidates.length && (
            <section aria-labelledby="trend-candidates-title">
              <header className="trend-section-header">
                <h2 id="trend-candidates-title">候选研究术语</h2>
                <span>{report.candidates.length} 个术语</span>
              </header>
              <ul className="trend-candidate-grid">
                {report.candidates.map((candidate) => (
                  <li key={candidate.phrase} className="trend-card">
                    <details className="trend-candidate">
                      <summary>
                        <span>{candidate.phrase}</span>
                        <span className="trend-candidate-count">{candidate.count} 篇</span>
                        <ChevronDown className="trend-chevron" size={16} />
                      </summary>
                      <Papers papers={candidate.evidence} />
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {report.current.end && (
            <details className="trend-method">
              <summary>
                数据口径
                <ChevronDown size={15} />
              </summary>
              <p>
                各期按 UTC 采集日等长比较，覆盖现有
                AI/NLP、安全与软件工程订阅及其交叉分类，不代表全量 arXiv。按论文 ID
                去重，同一论文可命中多个方向。候选术语在至少两个采集日、三篇论文的标题和原始摘要中同时出现，尚未归类。
              </p>
            </details>
          )}
        </>
      )}
    </div>
  )
}
