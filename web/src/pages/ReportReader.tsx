import { createElement, useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download, BookOpen } from 'lucide-react'
import { api, asset, message, safeURL } from '../api'
import { ReadingButton } from '../components/ReadingLayout'
import type { Report } from '../types'
import { Busy, ErrorMessage, PageHeading } from '../components/Common'
type DocumentNode = {
  paper?: Record<string, string>
  tag?: string
  text?: string
  id?: string
  href?: string
  children?: DocumentNode[]
}
const allowed = new Set(
  'p h2 h3 h4 h5 h6 ul ol li strong b em i code pre blockquote table thead tbody tr th td a br hr details summary article section'.split(
    ' ',
  ),
)
function renderNode(node: DocumentNode, index: number): ReactNode {
  if (!node.tag) return node.text || ''
  if (!allowed.has(node.tag)) return null
  const href = node.href?.startsWith('#report-') ? node.href : safeURL(node.href)
  const props = {
    key: index,
    id: node.id,
    ...(node.tag === 'a'
      ? { href, ...(href?.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {}) }
      : {}),
  }
  if (node.tag === 'br' || node.tag === 'hr') return createElement(node.tag, props)
  return createElement(
    node.tag,
    props,
    ...(node.children || []).map(renderNode),
    node.paper ? <ReportPaperAction key="read" paper={node.paper} /> : null,
  )
}
export default function ReportReader() {
  const [params] = useSearchParams()
  const path = params.get('path') || ''
  const [result, setResult] = useState<{ report: Report; content: DocumentNode[] } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    setResult(null)
    setError('')
    api<{ report: Report; content: DocumentNode[] }>(
      `api/report?${new URLSearchParams({ path })}`,
      { signal: abort.signal },
    )
      .then(setResult)
      .catch((e) => {
        if (!abort.signal.aborted) setError(message(e))
      })
    return () => abort.abort()
  }, [path])
  return (
    <>
      <Link className="reading-action reading-action--quiet mb-5" to="/">
        <ArrowLeft size={16} />
        返回报告库
      </Link>
      <ErrorMessage error={error} />
      {!result && !error && <Busy />}
      {result && (
        <>
          <PageHeading
            title={result.report.title}
            action={
              result.report.pdf && (
                <a
                  className="reading-action"
                  href={asset(result.report.pdf) + '?download=1'}
                  download
                >
                  <Download size={16} />
                  PDF
                </a>
              )
            }
          />
          <article className="report-document" data-testid="report-document">
            {result.content.map(renderNode)}
          </article>
        </>
      )}
    </>
  )
}

function ReportPaperAction({ paper }: { paper: Record<string, string> }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <div className="mt-4">
      <ReadingButton
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            const result = await api<{ redirect: string }>('api/fastread', {
              method: 'POST',
              body: JSON.stringify(paper),
            })
            const url = safeURL(result.redirect)
            if (url) window.location.assign(url)
          } catch (e) {
            setError(message(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <BookOpen size={15} />
        {busy ? '正在打开…' : '阅读论文'}
      </ReadingButton>
      <ErrorMessage error={error} />
    </div>
  )
}
