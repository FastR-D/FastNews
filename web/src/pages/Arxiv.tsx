import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, EmptyState, Select, TextField } from '@fastrd/ui-react'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { api, message } from '../api'
import CollectionDate from '../components/CollectionDate'
import type { NewsArticle } from '../types'
import { Busy, ErrorMessage, PageHeading, Panel, PaperCard } from '../components/Common'

type NewsPage = {
  date: string
  articles: NewsArticle[]
  total: number
  page: number
  pageSize: number
  pages: number
  categories: string[]
}
export default function Arxiv() {
  const [params, setParams] = useSearchParams()
  const requestedDate = params.get('date') || ''
  const category = params.get('category') || ''
  const q = params.get('q') || ''
  const requestedPage = Math.max(1, Math.floor(Number(params.get('page')) || 1))
  const size = [12, 24, 48].includes(Number(params.get('page_size')))
    ? Number(params.get('page_size'))
    : 12
  const [query, setQuery] = useState(q)
  const [result, setResult] = useState<NewsPage | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => setQuery(q), [q])
  function filter(key: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (value) next.set(key, value)
      else next.delete(key)
      if (key !== 'page') next.delete('page')
      if (key === 'date') next.delete('category')
      else if (!next.has('date') && result?.date) next.set('date', result.date)
      return next
    })
  }
  useEffect(() => {
    const abort = new AbortController()
    setBusy(true)
    setError('')
    api<NewsPage>(
      `api/news?${new URLSearchParams({ source: 'arxiv', page: String(requestedPage), page_size: String(size), q, category, ...(requestedDate ? { date: requestedDate } : {}) })}`,
      { signal: abort.signal },
    )
      .then((value) => {
        if (!abort.signal.aborted) setResult(value)
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(message(error))
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false)
      })
    return () => abort.abort()
  }, [requestedDate, requestedPage, size, q, category])
  const date = requestedDate || result?.date || ''
  return (
    <>
      <PageHeading title="arXiv 最新导读" />
      <Panel title="">
        <form
          className="arxiv-toolbar"
          role="search"
          aria-label="arXiv 筛选"
          onSubmit={(event) => {
            event.preventDefault()
            filter('q', query.trim())
          }}
        >
          <div className="arxiv-date-control">
            <span>采集日期</span>
            <CollectionDate value={date} onChange={(value) => filter('date', value)} />
          </div>
          <Select
            aria-label="论文领域"
            value={category}
            onChange={(event) => filter('category', event.target.value)}
          >
            <option value="">全部领域</option>
            {(result?.categories || []).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </Select>
          <div className="arxiv-search">
            <TextField
              aria-label="搜索 arXiv 论文"
              placeholder="搜索标题、作者或摘要…"
              value={query}
              maxLength={200}
              onChange={(event) => setQuery(event.target.value)}
            />
            {(query || q) && (
              <Button
                variant="quiet"
                aria-label="清除论文搜索"
                onClick={() => {
                  setQuery('')
                  filter('q', '')
                }}
              >
                <X size={15} />
              </Button>
            )}
            <Button type="submit" variant="quiet" aria-label="搜索论文">
              <Search size={17} />
            </Button>
          </div>
          <Select
            aria-label="每页论文数"
            value={size}
            onChange={(event) => filter('page_size', event.target.value)}
          >
            {[12, 24, 48].map((value) => (
              <option key={value} value={value}>
                {value} 篇/页
              </option>
            ))}
          </Select>
          <nav className="arxiv-paging" aria-label="论文分页">
            <span aria-live="polite">{result?.total ?? 0} 篇</span>
            <Button
              aria-label="上一页"
              disabled={busy || !result || result.page <= 1}
              onClick={() => filter('page', String((result?.page || 1) - 1))}
            >
              <ChevronLeft size={16} />
            </Button>
            <Button
              variant="quiet"
              aria-current="page"
              disabled={busy}
              aria-label={String(result?.page || 1)}
            >
              {result?.page || 1}
            </Button>
            <span>/ {result?.pages || 1}</span>
            <Button
              aria-label="下一页"
              disabled={busy || !result || result.page >= result.pages}
              onClick={() => filter('page', String((result?.page || 1) + 1))}
            >
              <ChevronRight size={16} />
            </Button>
          </nav>
        </form>
        <ErrorMessage error={error} />
        {busy ? (
          <Busy />
        ) : error ? null : !result?.articles.length ? (
          <EmptyState title="当天暂无匹配的 arXiv 论文">调整搜索词、日期或论文领域。</EmptyState>
        ) : (
          result.articles.map((article) => (
            <PaperCard
              key={article._id || article.link}
              paper={{
                id: article._id || article.link,
                source: 'arxiv',
                title: article.title,
                title_zh: article.title_zh,
                author: article.author,
                link: article.link,
                summary: article.summary_zh || article.description,
                venue: 'arXiv',
                date,
                category: article.categories?.join(' · '),
              }}
            />
          ))
        )}
      </Panel>
    </>
  )
}
