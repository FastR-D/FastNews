import { PaperPeople } from './EntityLink'
import { ReadingSurface } from './ReadingLayout'
import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Badge, Button, EmptyState, Loading, ListRow, Toolbar } from '@fastrd/ui-react'
import { ArrowUpRight, BookOpen, ChevronLeft, ChevronRight, FileText } from 'lucide-react'
import { api, message, safeURL } from '../api'
import type { Paper, Report } from '../types'
import { useApp } from '../context'

export function ErrorMessage({ error }: { error: string }) {
  return error ? (
    <Alert tone="danger" className="my-3 break-words">
      {error}
    </Alert>
  ) : null
}
export function PageHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="page-heading">
      <h1>{title}</h1>
      {action}
    </header>
  )
}
export function Panel({
  title,
  children,
  action,
  className = '',
}: {
  title: string
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <ReadingSurface
      className={`min-w-0 overflow-hidden mb-4 ${className}`}
      aria-labelledby={title ? id : undefined}
    >
      {(title || action) && (
        <header className="flex flex-wrap items-center gap-3 px-5 pt-5 pb-3">
          <h2 id={id} className="m-0 text-sm font-semibold">
            {title}
          </h2>
          <div className="ml-auto min-w-0 flex items-center gap-2">{action}</div>
        </header>
      )}
      {children}
    </ReadingSurface>
  )
}
export function LoginHint() {
  return (
    <EmptyState
      title="登录后管理个人内容"
      action={
        <Link className="reading-action" to="/login">
          进入账号页 <ArrowUpRight size={13} />
        </Link>
      }
    >
      研究印象、关注作者和私信按账号独立保存。
    </EmptyState>
  )
}
export function Busy() {
  return (
    <div className="p-8 flex justify-center">
      <Loading label="正在加载…" />
    </div>
  )
}
export function Pagination({
  page,
  total,
  size,
  onChange,
}: {
  page: number
  total: number
  size: number
  onChange: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / size))
  return (
    <Toolbar label="分页" className="justify-end">
      <span className="mr-auto">共 {total} 项</span>
      <Button aria-label="上一页" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft size={14} />
      </Button>
      {Array.from(
        { length: Math.min(5, pages) },
        (_, i) => Math.max(1, Math.min(page - 2, pages - 4)) + i,
      ).map((n) => (
        <Button
          key={n}
          aria-current={n === page ? 'page' : undefined}
          variant={n === page ? 'primary' : 'secondary'}
          onClick={() => onChange(n)}
        >
          {n}
        </Button>
      ))}
      <Button aria-label="下一页" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        <ChevronRight size={14} />
      </Button>
    </Toolbar>
  )
}
export function PaperCard({ paper }: { paper: Paper }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const href = safeURL(paper.link || paper.url)
  async function open() {
    setBusy(true)
    setError('')
    try {
      const result = await api<{ redirect: string }>('api/fastread', {
        method: 'POST',
        body: JSON.stringify({ ...paper, authors: paper.author || paper.authors }),
      })
      const target = safeURL(result.redirect)
      if (target) window.location.assign(target)
    } catch (error) {
      setError(message(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <article data-testid="paper-row" className="paper-card">
      <div className="paper-card-top">
        <div className="paper-meta">
          <Badge>
            {paper.category && paper.category !== 'Uncategorized'
              ? paper.category
              : paper.track === 'main'
                ? '主会论文'
                : '论文'}
          </Badge>
          <span>{[paper.year, paper.venue].filter(Boolean).join(' · ')}</span>
          {paper.cited_by !== undefined && <span>引用 {paper.cited_by}</span>}
          {paper.award && <Badge tone="warning">杰出论文</Badge>}
        </div>
        <div className="paper-actions">
          {href && (
            <a
              className="fastui-button fastui-button--quiet"
              href={href}
              target="_blank"
              rel="noreferrer"
            >
              阅读原文 <ArrowUpRight size={14} />
            </a>
          )}
          <Button loading={busy} onClick={open}>
            <BookOpen size={14} />
            跳转 FastRead
          </Button>
        </div>
      </div>
      <h3 className="paper-title">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {paper.title}
          </a>
        ) : (
          paper.title
        )}
      </h3>
      {paper.title_zh && <p className="paper-translation">{paper.title_zh}</p>}
      <PaperPeople paper={paper} />
      {!!paper.topics?.length && (
        <div className="paper-topics" aria-label="细分方向">
          {paper.topics.map((topic) => (
            <span
              key={topic.id}
              title={`${topic.basis === 'title' ? '标题候选' : '摘要/关键词识别'}：${topic.evidence}`}
            >
              {topic.label}
              {topic.basis === 'title' && <span aria-label="标题候选"> · 候选</span>}
            </span>
          ))}
        </div>
      )}
      {paper.summary && (
        <section className="paper-abstract" aria-label="摘要">
          <h4>{paper.summary_status === 'source' ? '原文摘要' : '摘要'}</h4>
          <p>{paper.summary}</p>
        </section>
      )}
      {paper.reason && <Alert tone="info">{paper.reason}</Alert>}
      <ErrorMessage error={error} />
    </article>
  )
}
export function ReportList({ reports }: { reports: Report[] }) {
  return (
    <div>
      {reports.length === 0 ? (
        <EmptyState title="暂无报告" />
      ) : (
        reports.map((report) => (
          <ListRow data-testid="report-row" className="flex-wrap" key={report.path}>
            <FileText size={17} className="shrink-0 text-[var(--fastui-muted)]" />
            <div className="flex-1 min-w-0">
              <h3 className="m-0 text-sm font-semibold break-words">
                <Link className="news-title" to={report.url}>
                  {report.title}
                </Link>
              </h3>
            </div>
          </ListRow>
        ))
      )}
    </div>
  )
}
export function Metrics({
  items,
}: {
  items: { label: string; value: number | string; detail?: string; icon?: ReactNode }[]
}) {
  return (
    <section className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6" aria-label="概览统计">
      {items.map((item) => (
        <ReadingSurface className="p-4 min-w-0" key={item.label}>
          <div className="flex items-center justify-between gap-2 text-[var(--fastui-muted)]">
            {item.label}
            {item.icon}
          </div>
          <strong className="block text-2xl font-semibold tabular-nums my-2">
            {typeof item.value === 'number' ? item.value.toLocaleString('zh-CN') : item.value}
          </strong>
        </ReadingSurface>
      ))}
    </section>
  )
}
export function CatalogState() {
  const { catalogLoading, catalogError } = useApp()
  if (catalogLoading) return <Busy />
  return (
    <EmptyState title={catalogError ? '资料库暂时无法加载' : '暂无可用资料'}>
      请稍后重试，或登录后查看研究资料。
    </EmptyState>
  )
}
