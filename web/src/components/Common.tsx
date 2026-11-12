import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  InspectorSection,
  Loading,
  ListRow,
  PanelHeader,
  Section,
  Toolbar,
} from '@fastrd/ui-react'
import { ArrowUpRight, BookOpen, Download, ChevronLeft, ChevronRight, FileText } from 'lucide-react'
import { api, asset, message, safeURL } from '../api'
import type { Paper, Report } from '../types'
import { useApp } from '../context'

export function ErrorMessage({ error }: { error: string }) {
  return error ? (
    <Alert tone="danger" className="my-3 break-words">
      {error}
    </Alert>
  ) : null
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
    <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        <span className="text-[var(--fastui-muted)] text-10px tracking-widest">
          RESEARCH WORKSPACE
        </span>
        <h1 className="fastui-heading text-xl sm:text-2xl mt-1 mb-2">{title}</h1>
        <p className="text-[var(--fastui-secondary)] m-0">{description}</p>
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
  const id = useId()
  return (
    <Section className={`min-w-0 overflow-hidden mb-4 ${className}`} aria-labelledby={id}>
      <PanelHeader>
        <h2 id={id}>{title}</h2>
        <div className="ml-auto min-w-0 flex items-center gap-2">{action}</div>
      </PanelHeader>
      {children}
    </Section>
  )
}
export function LoginHint() {
  return (
    <EmptyState
      title="登录后管理个人内容"
      action={
        <Link className="fastui-link inline-flex items-center gap-1" to="/login">
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
    <article
      data-testid="paper-row"
      className="min-w-0 p-4 grid gap-3 border-b border-b-solid border-b-[var(--fastui-border)]"
    >
      <div className="flex flex-wrap items-center gap-2 text-[var(--fastui-muted)]">
        <Badge>{paper.category || paper.source}</Badge>
        <span>{[paper.year, paper.venue].filter(Boolean).join(' · ')}</span>
        {paper.cited_by !== undefined && <span>引用 {paper.cited_by}</span>}
        {paper.award && <Badge tone="warning">杰出论文</Badge>}
      </div>
      <h3 className="fastui-heading m-0 text-sm break-words">
        {href ? (
          <a className="fastui-link no-underline" href={href} target="_blank" rel="noreferrer">
            {paper.title} <ArrowUpRight className="inline" size={12} />
          </a>
        ) : (
          paper.title
        )}
      </h3>
      {paper.title_zh && <p className="m-0">{paper.title_zh}</p>}
      {(paper.author || paper.authors) && (
        <p className="m-0 text-[var(--fastui-muted)] break-words">
          {paper.author || paper.authors}
        </p>
      )}
      {paper.summary && (
        <InspectorSection label="中文摘要">
          <p className="m-0 leading-loose">{paper.summary}</p>
        </InspectorSection>
      )}
      {paper.reason && <Alert tone="info">{paper.reason}</Alert>}
      <div>
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
        reports.map((report) => (
          <ListRow data-testid="report-row" className="flex-wrap" key={report.html}>
            <FileText size={17} className="shrink-0 text-[var(--fastui-muted)]" />
            <div className="flex-1 min-w-0">
              <h3 className="m-0 text-xs font-semibold break-words">
                <a
                  className="fastui-link no-underline"
                  href={asset(report.html)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {report.title} <ArrowUpRight className="inline" size={12} />
                </a>
              </h3>
              <p className="m-0 mt-1 text-11px text-[var(--fastui-muted)]">
                {(report.size / 1024).toFixed(1)} KB ·{' '}
                {new Date(report.updated).toLocaleDateString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                className="fastui-button fastui-button--xs no-underline"
                href={asset(report.html) + (download ? '?download=1' : '')}
                download={download || undefined}
                aria-label={`${download ? '下载' : '打开'} ${report.title} HTML`}
              >
                <Download size={12} />
                HTML
              </a>
              {report.pdf && (
                <a
                  className="fastui-button fastui-button--xs no-underline"
                  href={asset(report.pdf) + '?download=1'}
                  download
                  aria-label={`下载 ${report.title} PDF`}
                >
                  <Download size={12} />
                  PDF
                </a>
              )}
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
        <Section className="p-4 min-w-0" key={item.label}>
          <div className="flex items-center justify-between gap-2 text-[var(--fastui-muted)]">
            {item.label}
            {item.icon}
          </div>
          <strong className="block text-2xl font-semibold tabular-nums my-2">
            {typeof item.value === 'number' ? item.value.toLocaleString('zh-CN') : item.value}
          </strong>
          {item.detail && <small className="text-[var(--fastui-muted)]">{item.detail}</small>}
        </Section>
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
