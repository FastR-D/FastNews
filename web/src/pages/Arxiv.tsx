import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState, Select, Toolbar } from '@fastrd/ui-react'
import { api, message } from '../api'
import { useApp } from '../context'
import type { NewsArticle } from '../types'
import { Busy, ErrorMessage, PageHeading, Pagination, Panel, PaperCard } from '../components/Common'

export default function Arxiv() {
  const { catalog } = useApp()
  const [params, setParams] = useSearchParams()
  const requestedDate = params.get('date') || ''
  const [resolvedDate, setResolvedDate] = useState('')
  const date = requestedDate || resolvedDate
  const category = params.get('category') || ''
  const requestedPage = Math.max(1, Math.floor(Number(params.get('page')) || 1))
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  function filter(key: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (value) next.set(key, value)
      else next.delete(key)
      if (key !== 'page') next.delete('page')
      if (key === 'date') next.delete('category')
      return next
    })
  }
  useEffect(() => {
    const abort = new AbortController()
    setBusy(true)
    setError('')
    setArticles([])
    api<{ date: string; articles: NewsArticle[] }>(
      `api/news?${new URLSearchParams({ source: 'arxiv', ...(requestedDate ? { date: requestedDate } : {}) })}`,
      {
        signal: abort.signal,
      },
    )
      .then((value) => {
        setResolvedDate(value.date)
        setArticles(value.articles)
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(message(error))
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false)
      })
    return () => abort.abort()
  }, [requestedDate])
  const categories = [...new Set(articles.flatMap((article) => article.categories || []))].sort()
  const filtered = articles.filter((article) => !category || article.categories?.includes(category))
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(filtered.length / 12)))
  return (
    <>
      <PageHeading
        title="arXiv 最新导读"
        description="按采集日期查看预印本，筛选论文领域，阅读摘要并进入 FastRead。"
      />
      <Panel title="每日论文">
        <Toolbar label="arXiv 筛选">
          <label className="fastui-field">
            采集日期
            <Select
              aria-label="采集日期"
              value={date}
              onChange={(event) => filter('date', event.target.value)}
            >
              <option value="" disabled>
                选择采集日期
              </option>
              {(catalog?.dates || []).map((day) => (
                <option key={day}>{day}</option>
              ))}
            </Select>
          </label>
          <label className="fastui-field">
            论文领域
            <Select
              aria-label="论文领域"
              value={category}
              onChange={(event) => filter('category', event.target.value)}
            >
              <option value="">全部领域</option>
              {categories.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </Select>
          </label>
          <span className="ml-auto text-[var(--fastui-muted)]">{filtered.length} 篇预印本</span>
        </Toolbar>
        <ErrorMessage error={error} />
        {busy ? (
          <Busy />
        ) : !filtered.length ? (
          <EmptyState title="当天暂无匹配的 arXiv 论文">
            选择其他日期或论文领域继续浏览。
          </EmptyState>
        ) : (
          filtered.slice((page - 1) * 12, page * 12).map((article) => (
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
        <Pagination
          page={page}
          total={filtered.length}
          size={12}
          onChange={(value) => filter('page', String(value))}
        />
      </Panel>
    </>
  )
}
