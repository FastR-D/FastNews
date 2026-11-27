import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EmptyState } from '@fastrd/ui-react'
import {
  ReadingButton as Button,
  ReadingSurface as Section,
  ReadingSelect as Select,
  ReadingInput as TextField,
  ReadingHeader,
  SourceMark,
} from '../components/ReadingLayout'
import { ArrowLeft, ArrowUpRight, Search, ListPlus } from 'lucide-react'
import { useApp } from '../context'
import { api, message, safeURL } from '../api'
import { Busy, ErrorMessage } from '../components/Common'
import type { DirectorySource } from '../types'

const categories: Record<string, string> = {
  security: '安全研究与媒体',
  ai: 'AI 与论文精选',
  research: '学术团队',
  cve: 'CVE 与漏洞',
  telegram: 'Telegram',
  arxiv: '预印本',
}
export default function Sources() {
  const { profile, notify } = useApp()
  const [queue, setQueue] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState('')
  const [params, setParams] = useSearchParams()
  const pendingFilters = useRef(params)
  useEffect(() => {
    pendingFilters.current = params
  }, [params])
  const category = params.get('category') || ''
  const categoryList = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const list = categoryList.current
    const selected = list?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    if (!list || !selected || list.scrollWidth <= list.clientWidth) return
    const parent = list.getBoundingClientRect()
    const child = selected.getBoundingClientRect()
    if (child.left < parent.left || child.right > parent.right)
      list.scrollTo({ left: list.scrollLeft + child.left - parent.left })
  }, [category])
  const status = params.get('status') || ''
  const q = params.get('q') || ''
  const [query, setQuery] = useState(q)
  const [sources, setSources] = useState<DirectorySource[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (profile?.role !== 'admin') return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const data = await api<{
          queue?: { source: string; state: string }[]
          runs: { status: string; sources: { source: string; state: string }[] }[]
        }>('api/admin/collection', { signal: abort.signal })
        if (abort.signal.aborted) return
        const states: Record<string, string> = {}
        for (const item of data.queue || []) states[item.source] = item.state
        for (const run of data.runs)
          if (['running', 'stopping'].includes(run.status))
            for (const item of run.sources)
              if (['queued', 'running'].includes(item.state)) states[item.source] = item.state
        setQueue(states)
      } catch (e) {
        if (!abort.signal.aborted) setError(message(e))
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, 5000)
    }
    void poll()
    return () => {
      abort.abort()
      clearTimeout(timer)
    }
  }, [profile?.role, retry])
  async function enqueue(source: DirectorySource) {
    setAdding(source.id)
    setError('')
    try {
      const item = await api<{ state: string }>('api/admin/collection/queue', {
        method: 'POST',
        body: JSON.stringify({ source: source.id }),
      })
      setQueue((previous) => ({ ...previous, [source.id]: item.state }))
      if (source.configured)
        setSources((previous) =>
          previous.map((item) => (item.id === source.id ? { ...item, disabled: false } : item)),
        )
      notify(
        item.state === 'needs_configuration'
          ? '已加入待接入队列，可在进程管理中查看'
          : '已加入采集队列',
      )
    } catch (e) {
      setError(message(e))
    } finally {
      setAdding('')
    }
  }
  useEffect(() => setQuery(q), [q])
  useEffect(() => {
    const abort = new AbortController()
    setBusy(true)
    setError('')
    api<{ sources: DirectorySource[]; archiveDate: string }>('api/sources', {
      signal: abort.signal,
    })
      .then((v) => {
        setSources(v.sources)
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(message(e))
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false)
      })
    return () => abort.abort()
  }, [retry])
  function update(key: string, value: string) {
    const next = new URLSearchParams(pendingFilters.current)
    if (value) next.set(key, value)
    else next.delete(key)
    pendingFilters.current = next
    setParams(next)
  }
  function clearFilters() {
    pendingFilters.current = new URLSearchParams()
    setParams(pendingFilters.current)
  }
  const filtered = sources.filter(
    (s) =>
      (!category || s.category === category) &&
      (!status ||
        (status === 'active'
          ? s.configured && !s.disabled
          : status === 'primary'
            ? s.verification === 'primary'
            : s.verification === 'candidate')) &&
      (!q ||
        [
          s.name,
          s.description,
          s.note,
          s.url,
          ...s.references.map(
            (r) =>
              `${r.title} ${r.url} ${r.url.includes('zhihu.com') ? '知乎' : r.url.includes('reddit.com') ? 'Reddit' : ''}`,
          ),
        ].some((value) => value?.toLowerCase().includes(q.toLowerCase()))),
  )
  return (
    <div className="page-content">
      <ReadingHeader
        title="信源目录"
        action={
          <Link className="reading-action" to="/secnews/">
            <ArrowLeft size={15} />
            回到阅读
          </Link>
        }
      />
      <div className="grid lg:grid-cols-[170px_minmax(0,1fr)] gap-5 items-start">
        <aside className="lg:sticky lg:top-20 min-w-0">
          <h2 className="text-xs tracking-widest text-[var(--fastui-muted)] mt-0 mb-3">
            按领域发现
          </h2>
          <div
            role="group"
            ref={categoryList}
            aria-label="信源领域"
            className="flex lg:flex-col gap-1 items-start overflow-x-auto lg:overflow-visible"
          >
            {[['', '全部信源'], ...Object.entries(categories)].map(([value, label]) => (
              <Button
                variant="quiet"
                className="shrink-0"
                key={value}
                aria-pressed={category === value}
                onClick={() => update('category', value)}
              >
                <span>{label}</span>
                <span className="text-xs text-[var(--fastui-muted)] tabular-nums">
                  {sources.filter((s) => !value || s.category === value).length}
                </span>
              </Button>
            ))}
          </div>
        </aside>
        <div className="min-w-0">
          <form
            className="reading-surface p-4 flex flex-wrap gap-3 mb-5"
            role="search"
            aria-label="搜索信源目录"
            onSubmit={(e) => {
              e.preventDefault()
              update('q', query.trim())
            }}
          >
            <div className="flex gap-2 flex-1 min-w-48">
              <TextField
                className="flex-1 min-w-0"
                aria-label="搜索信源"
                placeholder="搜索信源…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button type="submit" aria-label="查找信源">
                <Search size={16} />
              </Button>
            </div>
            <Select
              className="min-w-0 max-w-full"
              aria-label="信源状态"
              value={status}
              onChange={(e) => update('status', e.target.value)}
            >
              <option value="">全部状态</option>
              <option value="active">已启用配置</option>
              <option value="primary">已核验上游</option>
              <option value="candidate">待验证候选</option>
            </Select>
          </form>
          <ErrorMessage error={error} />
          {error && <Button onClick={() => setRetry((n) => n + 1)}>重新加载信源</Button>}
          {busy ? (
            <Busy />
          ) : (
            !error && (
              <>
                <div className="flex items-center justify-between mb-4 text-sm text-[var(--fastui-muted)]">
                  <span aria-live="polite">{filtered.length} 个匹配来源</span>
                  {(q || category || status) && (
                    <Button variant="quiet" onClick={clearFilters}>
                      清除目录筛选
                    </Button>
                  )}
                </div>
                {!filtered.length ? (
                  <EmptyState title="没有匹配的信源">试试其他关键词或放宽筛选。</EmptyState>
                ) : (
                  <div className="source-grid">
                    {filtered.map((source) => (
                      <Section
                        key={source.id}
                        data-testid="source-card"
                        className="reading-source-card p-5 flex flex-col min-w-0"
                      >
                        <div className="flex flex-wrap items-center gap-2 mb-4 text-xs text-[var(--fastui-muted)]">
                          <SourceMark category={source.category} size="large" />
                          {profile?.role === 'admin' && (
                            <Button
                              className="source-queue-button"
                              variant="quiet"
                              disabled={!!adding || !!queue[source.id]}
                              aria-label={`将${source.name}纳入采集队列`}
                              title={
                                queue[source.id] === 'needs_configuration'
                                  ? '尚未配置可用采集接口，可在进程管理中查看'
                                  : '纳入采集队列'
                              }
                              onClick={() => void enqueue(source)}
                            >
                              <ListPlus size={15} />
                              {adding === source.id
                                ? '加入中…'
                                : queue[source.id] === 'needs_configuration'
                                  ? '待接入'
                                  : queue[source.id] === 'running'
                                    ? '采集中'
                                    : queue[source.id]
                                      ? '已排队'
                                      : '纳入采集'}
                            </Button>
                          )}
                          <div className="source-card-meta">
                            <span
                              className={`source-pill ${source.configured && !source.disabled ? 'source-pill--active' : source.verification === 'candidate' ? 'source-pill--candidate' : ''}`}
                            >
                              {source.configured
                                ? source.disabled
                                  ? '已停用'
                                  : '已配置采集'
                                : source.verification === 'primary'
                                  ? '已核验上游'
                                  : '待验证候选'}
                            </span>
                            <span>{categories[source.category] || source.category}</span>
                          </div>
                        </div>
                        <h2 className="text-base font-semibold leading-snug m-0 break-words">
                          <a
                            className="news-title"
                            href={safeURL(source.url)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {source.name} <ArrowUpRight size={14} className="inline" />
                          </a>
                        </h2>
                        <p className="text-sm leading-6 text-[var(--fastui-secondary)] break-words mt-3 mb-4 flex-1">
                          {source.description}
                        </p>
                      </Section>
                    ))}
                  </div>
                )}
              </>
            )
          )}
        </div>
      </div>
    </div>
  )
}
