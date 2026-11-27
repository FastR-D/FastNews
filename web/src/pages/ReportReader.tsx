import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, Search, X, List } from 'lucide-react'
import { api, message, safeURL } from '../api'
import { ReadingButton, ReadingInput } from '../components/ReadingLayout'
import type { Report, Paper } from '../types'
import { Busy, ErrorMessage, PageHeading, PaperCard } from '../components/Common'
type DocumentNode = {
  catalogPaper?: Paper
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
  if (node.catalogPaper && node.tag === 'article')
    return (
      <div key={index} id={node.id} className="report-paper-anchor">
        <PaperCard paper={node.catalogPaper} />
      </div>
    )
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
function nodeText(node: DocumentNode): string {
  return [node.text || '', ...(node.children || []).map(nodeText)].join(' ')
}
function prepareNodes(nodes: DocumentNode[], prefix = 'report'): DocumentNode[] {
  return nodes.map((node, index) => ({
    ...node,
    id:
      node.id ||
      (['section', 'article', 'h2'].includes(node.tag || '') ? `${prefix}-${index}` : undefined),
    children: node.children && prepareNodes(node.children, `${prefix}-${index}`),
  }))
}
function filterNodes(nodes: DocumentNode[], query: string): DocumentNode[] {
  if (!query) return nodes
  return nodes.flatMap((node) => {
    if (node.tag === 'article') {
      const paper = node.catalogPaper
      const text = [
        nodeText(node),
        ...Object.values(node.paper || {}),
        paper?.title,
        paper?.title_zh,
        paper?.author,
        paper?.summary,
        paper?.authors,
        ...(paper?.authors_list || []).map((entity) => entity.name),
        ...(paper?.institutions || []).map((entity) => entity.name),
      ].join(' ')
      return text.toLocaleLowerCase().includes(query) ? [node] : []
    }
    if (node.tag === 'section') {
      const children = node.children || []
      const heading = children.find((child) => /^h[2-6]$/.test(child.tag || ''))
      if (heading && nodeText(heading).toLocaleLowerCase().includes(query)) return [node]
      const filtered = filterNodes(
        children.filter((child) => child !== heading && !!child.tag),
        query,
      )
      return filtered.length
        ? [{ ...node, children: [...(heading ? [heading] : []), ...filtered] }]
        : []
    }
    return nodeText(node).toLocaleLowerCase().includes(query) ? [node] : []
  })
}
function contents(nodes: DocumentNode[]): { id: string; title: string }[] {
  return nodes.flatMap((node) => {
    if (!node.id) return []
    const heading = node.children?.find((child) => /^h[2-6]$/.test(child.tag || ''))
    const title =
      node.catalogPaper?.title ||
      node.paper?.title ||
      (heading ? nodeText(heading) : node.tag === 'h2' ? nodeText(node) : '')
    return title ? [{ id: node.id, title }] : []
  })
}
export default function ReportReader() {
  const [params, setParams] = useSearchParams()
  const path = params.get('path') || ''
  const query = params.get('q') || ''
  const [result, setResult] = useState<{ report: Report; content: DocumentNode[] } | null>(null)
  const [error, setError] = useState('')
  const [active, setActive] = useState('')
  const [tocOpen, setTocOpen] = useState(false)
  const prepared = useMemo(() => prepareNodes(result?.content || []), [result])
  const filtered = useMemo(
    () => filterNodes(prepared, query.trim().toLocaleLowerCase()),
    [prepared, query],
  )
  const toc = useMemo(() => contents(filtered), [filtered])
  useEffect(() => {
    const abort = new AbortController()
    setResult(null)
    setError('')
    setTocOpen(false)
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
  useEffect(() => {
    const entries = toc
      .map((item) => document.getElementById(item.id))
      .filter((item): item is HTMLElement => !!item)
    function updateActive() {
      const item =
        [...entries].reverse().find((item) => item.getBoundingClientRect().top <= 180) || entries[0]
      setActive(item?.id || '')
    }
    updateActive()
    window.addEventListener('scroll', updateActive, { passive: true })
    return () => window.removeEventListener('scroll', updateActive)
  }, [toc])
  useEffect(() => {
    if (!result) return
    const id = window.location.hash.slice(1)
    if (id) document.getElementById(id)?.scrollIntoView()
  }, [result])
  function search(value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set('q', value)
    else next.delete('q')
    setParams(next, { replace: true, preventScrollReset: true })
  }
  function navigate(id: string) {
    setTocOpen(false)
    setActive(id)
    requestAnimationFrame(() =>
      document.getElementById(id)?.scrollIntoView({ behavior: 'instant' }),
    )
  }
  return (
    <div className="report-reader">
      <Link className="reading-action reading-action--quiet mb-5" to="/">
        <ArrowLeft size={16} />
        返回报告库
      </Link>
      <ErrorMessage error={error} />
      {!result && !error && <Busy />}
      {result && (
        <>
          <PageHeading title={result.report.title} />
          <div className="report-tools" role="search" aria-label="搜索报告内容">
            <Search size={18} aria-hidden="true" />
            <ReadingInput
              aria-label="搜索报告内容"
              placeholder="搜索标题、作者、单位或摘要…"
              value={query}
              onChange={(event) => search(event.target.value)}
            />
            {query && (
              <ReadingButton variant="quiet" aria-label="清除报告搜索" onClick={() => search('')}>
                <X size={16} />
              </ReadingButton>
            )}
            <ReadingButton
              variant="quiet"
              className="report-toc-toggle"
              aria-expanded={tocOpen}
              aria-controls="report-toc"
              onClick={() => setTocOpen(!tocOpen)}
            >
              <List size={16} />
              目录
            </ReadingButton>
          </div>
          <div className="report-layout">
            <aside className={`report-toc ${tocOpen ? 'is-open' : ''}`} id="report-toc">
              <h2>目录</h2>
              <nav aria-label="报告目录">
                {toc.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    aria-current={active === item.id ? 'location' : undefined}
                    onClick={() => navigate(item.id)}
                  >
                    {item.title}
                  </a>
                ))}
                {!toc.length && <p>暂无匹配章节</p>}
              </nav>
            </aside>
            <article className="report-document" data-testid="report-document">
              {filtered.length ? (
                filtered.map(renderNode)
              ) : (
                <div className="report-empty">
                  <h2>没有匹配的内容</h2>
                  <ReadingButton onClick={() => search('')}>清除搜索</ReadingButton>
                </div>
              )}
            </article>
          </div>
        </>
      )}
    </div>
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
