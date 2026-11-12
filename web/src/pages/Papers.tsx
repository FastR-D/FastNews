import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Button, EmptyState, Select, TextField, Toolbar } from '@fastrd/ui-react'
import { Search } from 'lucide-react'
import { api, message } from '../api'
import { useApp } from '../context'
import type { Generation, Paper } from '../types'
import {
  Busy,
  Metrics,
  ErrorMessage,
  PageHeading,
  Pagination,
  Panel,
  PaperCard,
  ReportList,
} from '../components/Common'
export default function Papers() {
  const { catalog, profile } = useApp()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const conference = params.get('conference') || ''
  const year = params.get('year') || ''
  const category = params.get('category') || ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [query, setQuery] = useState(q)
  const setFilter = (key: string, value: string) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (value) next.set(key, value)
      else next.delete(key)
      if (key !== 'page') next.delete('page')
      return next
    })
    setRelated(null)
  }
  useEffect(() => {
    setQuery(q)
    setRelated(null)
  }, [q])
  const [papers, setPapers] = useState<Paper[]>([]),
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
        (v.candidates || pool.papers)
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
        action={<Badge>四大安全顶会</Badge>}
      />
      <Metrics
        items={[
          { label: '已总结论文', value: catalog?.topPapers || '—', detail: '中文摘要与原文链接' },
          { label: '安全顶会', value: 4, detail: 'USENIX · S&P · NDSS · CCS' },
          {
            label: '研究类别',
            value: catalog?.categories.length || '—',
            detail: '按方向定位相关工作',
          },
          { label: '当前结果', value: total, detail: '支持会议、年份与类别组合筛选' },
        ]}
      />
      <div className="grid min-[1200px]:grid-cols-[minmax(0,1fr)_280px] gap-4 items-start">
        <Panel
          title="论文检索"
          action={<span className="text-[var(--fastui-muted)]">{total} 篇</span>}
        >
          <form
            className="flex flex-wrap gap-2 p-3"
            onSubmit={(e) => {
              e.preventDefault()
              setFilter('q', query.trim())
            }}
          >
            <TextField
              className="flex-1 min-w-0"
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
          <Toolbar label="筛选状态">
            <span>{q ? `检索：${q}` : '全部研究方向'}</span>
            <Button
              className="ml-auto"
              variant="quiet"
              disabled={!params.size}
              onClick={() => {
                setParams({})
                setQuery('')
                setRelated(null)
              }}
            >
              清除筛选
            </Button>
          </Toolbar>
          <div className="grid sm:grid-cols-3 gap-3 p-3">
            <label className="fastui-field">
              会议
              <Select
                aria-label="会议"
                value={conference}
                onChange={(e) => setFilter('conference', e.target.value)}
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
                onChange={(e) => setFilter('year', e.target.value)}
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
                onChange={(e) => setFilter('category', e.target.value)}
              >
                <option value="">全部类别</option>
                {catalog?.categories.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </label>
          </div>
          <ErrorMessage error={error} />
          {related && (
            <div className="flex items-center justify-between gap-3 p-3">
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
          {!related && (
            <Pagination
              page={page}
              total={total}
              size={12}
              onChange={(value) => setFilter('page', String(value))}
            />
          )}
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
