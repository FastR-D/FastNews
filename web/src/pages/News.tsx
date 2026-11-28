import CollectionDate from '../components/CollectionDate'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EmptyState } from '@fastrd/ui-react'
import {
  ReadingButton as Button,
  ReadingSurface as Section,
  ReadingTabs as SegmentedControl,
  ReadingSelect as Select,
  ReadingInput as TextField,
  ReadingHeader,
} from '../components/ReadingLayout'
import {
  ArrowRight,
  BookOpen,
  ExternalLink,
  Library,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { api, message, safeURL } from '../api'
import { useApp } from '../context'
import type { NewsArticle } from '../types'
import { Busy, ErrorMessage, Pagination, Panel, ReportList } from '../components/Common'
import NewsArchive from '../components/NewsArchive'
import { ArticleMeta, articleScore, NewsReader, newsChannels } from '../components/NewsReading'

const pageSize = 20
export default function News() {
  const { catalog } = useApp()
  const [params, setParams] = useSearchParams()
  const requestedDate = params.get('date') || ''
  const kind = newsChannels[params.get('channel') || ''] ? params.get('channel')! : 'all'
  const publisher = params.get('publisher') || ''
  const q = params.get('q') || ''
  const order = params.get('sort') === 'latest' ? 'latest' : 'recommended'
  const showAll = params.get('view') === 'all'
  const page = Math.max(1, Math.floor(Number(params.get('page')) || 1))
  const reading = params.get('article') || ''
  const [query, setQuery] = useState(q)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [resolvedDate, setResolvedDate] = useState('')
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const date = requestedDate || resolvedDate
  useEffect(() => setQuery(q), [q])
  useEffect(() => {
    const abort = new AbortController()
    setBusy(true)
    setError('')
    setArticles([])
    api<{ date: string; articles: NewsArticle[] }>(
      `api/news?${new URLSearchParams({ source: kind === 'all' ? 'articles' : kind, ...(requestedDate ? { date: requestedDate } : {}) })}`,
      { signal: abort.signal },
    )
      .then((v) => {
        setResolvedDate(v.date)
        setArticles(v.articles)
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(message(e))
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false)
      })
    return () => abort.abort()
  }, [requestedDate, kind, retry])
  function update(values: Record<string, string>) {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.delete('page')
      next.delete('article')
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value)
        else next.delete(key)
      }
      return next
    })
  }
  const sources = useMemo(
    () =>
      [...new Map(articles.map((a) => [a.source, a.source_name || a.source])).entries()].sort(
        (a, b) => a[1].localeCompare(b[1]),
      ),
    [articles],
  )
  const filtered = useMemo(
    () =>
      articles
        .filter(
          (a) =>
            (!publisher || a.source === publisher) &&
            (!q ||
              [a.title, a.title_zh, a.summary_zh, a.description, a.source_name].some((value) =>
                value?.toLocaleLowerCase().includes(q.toLocaleLowerCase()),
              )),
        )
        .sort(
          (a, b) =>
            (order === 'recommended' ? (articleScore(b) ?? -1) - (articleScore(a) ?? -1) : 0) ||
            (Date.parse(b.published || '') || 0) - (Date.parse(a.published || '') || 0),
        ),
    [articles, publisher, q, order],
  )
  const scored = filtered.filter((a) => articleScore(a) !== null)
  const recommended = order === 'recommended' && scored.length ? scored : filtered
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)))
  const visible = showAll
    ? filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : recommended.slice(0, 10)
  const active = articles.find((a) => (a._id || a.link) === reading)
  const readingIndex = filtered.findIndex((a) => (a._id || a.link) === reading)
  const readerURL = (a: NewsArticle) => {
    const next = new URLSearchParams(params)
    // Pin the archive day so a saved reading link remains stable tomorrow.
    if (date) next.set('date', date)
    next.set('article', a._id || a.link)
    return `?${next}`
  }
  const closeReader = () =>
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.delete('article')
      return next
    })
  const openNext = () => {
    const next = filtered[readingIndex + 1]
    if (next) setParams(readerURL(next).slice(1))
  }
  if (reading && !busy && active)
    return (
      <NewsReader
        article={active}
        onClose={closeReader}
        onNext={readingIndex >= 0 && readingIndex < filtered.length - 1 ? openNext : undefined}
        position={
          readingIndex >= 0 ? `${readingIndex + 1} / ${filtered.length} 篇` : '当前归档文章'
        }
      />
    )

  return (
    <div className="page-content">
      <ReadingHeader
        title="研究资讯"
        action={
          <Link className="reading-action" to="/sources/">
            <Library size={16} />
            信源目录
          </Link>
        }
      />
      <Section className="mb-5 p-4 sm:p-5 flex flex-col gap-4">
        <div className="overflow-x-auto pb-1">
          <SegmentedControl
            label="资讯频道"
            options={[
              { value: 'all', label: '全部' },
              ...Object.entries(newsChannels).map(([value, label]) => ({ value, label })),
            ]}
            value={kind}
            onChange={(value) =>
              update({ channel: value === 'all' ? '' : value, publisher: '', view: '' })
            }
          />
        </div>
        <form
          role="search"
          aria-label="资讯搜索与筛选"
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            update({ q: query.trim(), view: 'all' })
          }}
        >
          <div className="flex flex-1 gap-2 min-w-0">
            <TextField
              className="flex-1 min-w-0"
              aria-label="搜索资讯"
              placeholder="搜索标题、摘要或来源…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button type="submit" aria-label="搜索资讯结果">
              <Search size={16} />
            </Button>
          </div>
          <Button
            type="button"
            className="sm:hidden"
            aria-label="展开资讯筛选"
            aria-expanded={filtersOpen}
            aria-controls="news-filters"
            onClick={() => setFiltersOpen((value) => !value)}
          >
            <SlidersHorizontal size={16} />
          </Button>
        </form>
        <div
          id="news-filters"
          className={`${filtersOpen ? 'flex' : 'hidden'} sm:flex flex-wrap items-center gap-3`}
        >
          <CollectionDate value={date} onChange={(value) => update({ date: value, view: '' })} />
          <Select
            className="min-w-0 max-w-full"
            aria-label="资讯来源"
            value={publisher}
            onChange={(e) => update({ publisher: e.target.value, view: 'all' })}
          >
            <option value="">全部来源</option>
            {publisher && !sources.some(([id]) => id === publisher) && (
              <option value={publisher}>{publisher}（当日无记录）</option>
            )}
            {sources.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
          <Select
            className="min-w-0 max-w-full"
            aria-label="资讯排序"
            value={order}
            onChange={(e) => update({ sort: e.target.value })}
          >
            <option value="recommended">优先推荐</option>
            <option value="latest">最新发布</option>
          </Select>
        </div>
        {(q || publisher) && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--fastui-muted)]">
            <span>
              筛选结果 {q && ` · ${q}`}{' '}
              {publisher && ` · ${sources.find(([id]) => id === publisher)?.[1] || publisher}`}
            </span>
            <Button variant="quiet" onClick={() => update({ q: '', publisher: '' })}>
              清除筛选
            </Button>
          </div>
        )}
      </Section>
      <ErrorMessage error={error} />
      {error && <Button onClick={() => setRetry((n) => n + 1)}>重新加载资讯</Button>}
      {reading && !busy && !active && !error && (
        <EmptyState
          title="归档中未找到这篇资讯"
          action={<Button onClick={closeReader}>返回资讯列表</Button>}
        />
      )}
      <div className="grid min-[1200px]:grid-cols-[minmax(0,1fr)_248px] gap-5 items-start">
        <section className="min-w-0" aria-label="资讯列表">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-base font-semibold m-0">
                {date ? `${date} · 每日资讯` : '每日资讯'}
              </h2>
            </div>
            <Button variant="quiet" onClick={() => update({ view: showAll ? '' : 'all' })}>
              {showAll ? '精选资讯' : '全部资讯'}
            </Button>
          </div>
          {busy ? (
            <Busy />
          ) : (
            !error &&
            (visible.length ? (
              <>
                <Section className="px-4 sm:px-6">
                  {visible.map((article, index) => (
                    <article
                      key={article._id || article.link}
                      data-testid="news-row"
                      className="py-5 sm:py-6 border-b border-b-solid border-b-[var(--fastui-border)] last:border-b-0 min-w-0"
                    >
                      <ArticleMeta article={article} />
                      <h3
                        className={`${index === 0 && !showAll ? 'text-lg sm:text-xl' : 'text-base sm:text-lg'} font-semibold leading-snug tracking-tight my-3 break-words`}
                      >
                        <Link className="news-title" to={readerURL(article)}>
                          {article.title_zh || article.title}
                        </Link>
                      </h3>
                      <p className="m-0 text-sm leading-6 text-[var(--fastui-secondary)] break-words line-clamp-3">
                        {article.summary_zh ||
                          article.description ||
                          '摘要暂缺，前往原文了解详情。'}
                      </p>
                      <div className="flex flex-wrap items-center justify-between gap-3 mt-4 text-xs text-[var(--fastui-muted)]">
                        <span title={article.score_reason}>
                          {articleScore(article) === null
                            ? ''
                            : `价值 ${articleScore(article)!.toFixed(1)}`}
                          {article.summary_zh ? ' · AI 导读' : ''}
                        </span>
                        <div className="flex items-center gap-4">
                          <Link className="reading-action" to={readerURL(article)}>
                            <BookOpen size={13} />
                            阅读导读
                          </Link>
                          <a
                            className="reading-action"
                            href={safeURL(article.link)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            原文 <ExternalLink size={12} />
                          </a>
                        </div>
                      </div>
                    </article>
                  ))}
                </Section>
                {showAll ? (
                  <Pagination
                    page={currentPage}
                    total={filtered.length}
                    size={pageSize}
                    onChange={(n) => {
                      update({ page: String(n) })
                      document
                        .querySelector('[aria-label="资讯列表"]')
                        ?.scrollIntoView({ block: 'start' })
                    }}
                  />
                ) : (
                  filtered.length > visible.length && (
                    <div className="py-6 text-center">
                      <Button onClick={() => update({ view: 'all' })}>
                        浏览全部 {filtered.length} 条 <ArrowRight size={14} />
                      </Button>
                    </div>
                  )
                )}
              </>
            ) : (
              <EmptyState title={q || publisher ? '没有匹配的资讯' : '当天暂无资讯'}>
                {q || publisher
                  ? '试试其他关键词或来源，或切换采集日期。'
                  : '可以切换日期或频道继续阅读。'}
              </EmptyState>
            ))
          )}
        </section>
        <aside className="min-w-0 min-[1200px]:sticky min-[1200px]:top-20" aria-label="阅读导航">
          <NewsArchive
            date={date}
            dates={catalog?.dates || []}
            onSelect={(day) => update({ date: day, view: '' })}
          />
          <Panel title="资讯周报">
            <ReportList
              reports={(catalog?.reports.filter((r) => r.kind === 'secnews') || []).slice(0, 3)}
            />
          </Panel>
        </aside>
      </div>
    </div>
  )
}
