import { useEffect, useState } from 'react'
import { Badge, Button, EmptyState, Select, TextField } from '@fastrd/ui-react'
import { Search } from 'lucide-react'
import { api, message } from '../api'
import { useApp } from '../context'
import type { Generation, Paper } from '../types'
import {
  Busy,
  ErrorMessage,
  PageHeading,
  Pagination,
  Panel,
  PaperCard,
  ReportList,
} from '../components/Common'
export default function Papers() {
  const { catalog, profile } = useApp()
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q') ?? ''),
    [q, setQ] = useState(query),
    [conference, setConference] = useState(''),
    [year, setYear] = useState(''),
    [category, setCategory] = useState(''),
    [page, setPage] = useState(1),
    [papers, setPapers] = useState<Paper[]>([]),
    [total, setTotal] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [related, setRelated] = useState<Paper[] | null>(null),
    [ranking, setRanking] = useState(false)
  useEffect(() => {
    const abort = new AbortController()
    setBusy(true)
    setError('')
    const params = new URLSearchParams({
      source: 'top-conf',
      q,
      conference,
      year,
      category,
      page: String(page),
      pageSize: '12',
    })
    api<{ papers: Paper[]; total: number }>(`api/papers?${params}`, { signal: abort.signal })
      .then((v) => {
        setPapers(v.papers)
        setTotal(v.total)
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(message(e))
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false)
      })
    return () => abort.abort()
  }, [q, conference, year, category, page])
  const filter = (fn: (s: string) => void, value: string) => {
    fn(value)
    setPage(1)
    setRelated(null)
  }
  async function findRelated() {
    setRanking(true)
    setError('')
    try {
      const params = new URLSearchParams({
        source: 'top-conf',
        q: query || profile?.impression.text || '',
        conference,
        year,
        category,
        pageSize: '40',
      })
      const pool = await api<{ papers: Paper[] }>(`api/papers?${params}`)
      const v = await api<Generation>('api/related-work', {
        method: 'POST',
        body: JSON.stringify({
          topic: query,
          impression: profile?.impression.text || '',
          candidates: pool.papers,
        }),
      })
      const byID = new Map(v.items?.map((i) => [i.id, i]))
      setRelated(
        (v.candidates || papers)
          .filter((p) => byID.has(p.id))
          .map((p) => ({ ...p, reason: byID.get(p.id)?.reason }))
          .sort((a, b) => (byID.get(b.id)?.score || 0) - (byID.get(a.id)?.score || 0)),
      )
    } catch (e) {
      setError(message(e))
    } finally {
      setRanking(false)
    }
  }
  return (
    <>
      <PageHeading
        title="顶会论文总结"
        description="按研究方向浏览 USENIX、IEEE S&P、NDSS 和 ACM CCS 等安全顶会总结。"
        action={<Badge>Local Index</Badge>}
      />
      <section className="stats">
        <div className="stat">
          <strong>{catalog?.topPapers.toLocaleString() || '—'}</strong>
          <span>已总结论文</span>
        </div>
        <div className="stat">
          <strong>4</strong>
          <span>会议</span>
        </div>
        <div className="stat">
          <strong>{catalog?.categories.length || '—'}</strong>
          <span>研究类别</span>
        </div>
      </section>
      <div className="workspace papers-workspace">
        <Panel title="论文检索" action={<span className="muted">{total} 篇</span>}>
          <form
            className="search-toolbar"
            onSubmit={(e) => {
              e.preventDefault()
              filter(setQ, query)
            }}
          >
            <TextField
              aria-label="搜索论文"
              placeholder="输入方向或关键词，使用向量检索…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button type="submit" variant="primary">
              <Search size={13} />
              搜索
            </Button>
            <Button loading={ranking} onClick={findRelated}>
              找 related work
            </Button>
          </form>
          <div className="filter-grid">
            <label className="fastui-field">
              会议
              <Select
                aria-label="会议"
                value={conference}
                onChange={(e) => filter(setConference, e.target.value)}
              >
                <option value="">全部会议</option>
                {Object.entries(catalog?.conferences || {}).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="fastui-field">
              年份
              <Select
                aria-label="年份"
                value={year}
                onChange={(e) => filter(setYear, e.target.value)}
              >
                <option value="">全部年份</option>
                {catalog?.years.map((y) => <option key={y}>{y}</option>)}
              </Select>
            </label>
            <label className="fastui-field">
              研究类别
              <Select
                aria-label="研究类别"
                value={category}
                onChange={(e) => filter(setCategory, e.target.value)}
              >
                <option value="">全部类别</option>
                {catalog?.categories.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </label>
          </div>
          <ErrorMessage error={error} />
          {related && (
            <div className="result-toolbar">
              <span>Related work · {related.length} 篇</span>
              <Button onClick={() => setRelated(null)}>返回论文列表</Button>
            </div>
          )}
          {busy ? (
            <Busy />
          ) : (related || papers).length ? (
            (related || papers).map((p) => <PaperCard key={p.id} paper={p} />)
          ) : (
            <EmptyState title="没有符合筛选条件的论文" />
          )}
          {!related && <Pagination page={page} total={total} size={12} onChange={setPage} />}
        </Panel>
        <aside>
          <Panel title="顶会报告">
            <ReportList reports={catalog?.reports.filter((r) => r.kind === 'top-conf') || []} />
          </Panel>
        </aside>
      </div>
    </>
  )
}
