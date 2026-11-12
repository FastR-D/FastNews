import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Badge, Button, EmptyState, Loading } from '@fastrd/ui-react'
import { ArrowUpRight, BookOpen, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import { api, asset, message, safeURL } from '../api'
import type { Paper, Report } from '../types'
export function ErrorMessage({ error }: { error: string }) {
  return error ? <Alert tone="danger">{error}</Alert> : null
}
export function PageHeading({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
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
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
export function LoginHint() {
  return (
    <EmptyState
      title="登录后管理个人内容"
      action={
        <Link className="text-link" to="/login">
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
    <div className="loading-wrap">
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
    <nav className="pagination" aria-label="分页">
      <span>共 {total} 项</span>
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
    </nav>
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
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="paper-row">
      <h3>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {paper.title}
            <ArrowUpRight size={12} />
          </a>
        ) : (
          paper.title
        )}
        {paper.award && <Badge tone="warning">杰出论文</Badge>}
      </h3>
      {paper.title_zh && <p className="paper-zh">{paper.title_zh}</p>}
      {paper.summary && <p className="paper-summary">{paper.summary}</p>}
      {paper.reason && <p className="paper-reason">{paper.reason}</p>}
      <div className="paper-meta">
        <Badge>{paper.category || paper.source}</Badge>
        <span>{[paper.year, paper.venue].filter(Boolean).join(' · ')}</span>
        {paper.cited_by !== undefined && <span>引用 {paper.cited_by}</span>}
        <span className="paper-author">{paper.author || paper.authors}</span>
      </div>
      <div className="row-actions">
        <Button size="xs" loading={busy} onClick={open}>
          <BookOpen size={13} />
          跳转 FastRead
        </Button>
      </div>
      <ErrorMessage error={error} />
    </article>
  )
}
export function ReportList({
  reports,
  download = false,
}: {
  reports: Report[]
  download?: boolean
}) {
  return (
    <div>
      {reports.length === 0 ? (
        <EmptyState title="暂无报告" />
      ) : (
        reports.map((r) => (
          <article className="report-row" key={r.html}>
            <div>
              <h3>
                <a href={asset(r.html)} target="_blank" rel="noreferrer">
                  {r.title}
                  <ArrowUpRight size={12} />
                </a>
              </h3>
              <p className="muted">
                {(r.size / 1024).toFixed(1)} KB · {new Date(r.updated).toLocaleDateString('zh-CN')}
              </p>
            </div>
            <div className="row-actions">
              <a
                className="file-link"
                href={asset(r.html) + (download ? '?download=1' : '')}
                download={download || undefined}
              >
                <Download size={12} />
                HTML
              </a>
              {r.pdf && (
                <a className="file-link" href={asset(r.pdf) + '?download=1'} download>
                  <Download size={12} />
                  PDF
                </a>
              )}
            </div>
          </article>
        ))
      )}
    </div>
  )
}
