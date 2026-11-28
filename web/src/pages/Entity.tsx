import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Button, TextField } from '@fastrd/ui-react'
import { ArrowLeft, ArrowUpRight, RefreshCw } from 'lucide-react'
import { api, message, safeURL } from '../api'
import { useApp } from '../context'
import type { Entity, Paper } from '../types'
import { Busy, ErrorMessage, PageHeading, Pagination, Panel, PaperCard } from '../components/Common'
import EntityLink, { entityKey, FollowEntity } from '../components/EntityLink'

type Result = {
  entity: Entity
  kind: string
  match: string
  affiliations: Entity[]
  papers: Paper[]
  total: number
}
type Preview = {
  title: string
  description: string
  source: string
  fetchedAt: string
  profiles: { title: string; url: string }[]
  papers: { title: string; url: string }[]
}
export default function EntityPage({ kind: requestedKind }: { kind: string }) {
  const [params] = useSearchParams()
  const route = useParams()
  const { profile, refresh, notify } = useApp()
  const name = route.name || '',
    ref = params.get('ref') || ''
  const [data, setData] = useState<Result | null>(null),
    [error, setError] = useState(''),
    [page, setPage] = useState(1)
  const [url, setURL] = useState(ref),
    [preview, setPreview] = useState<Preview | null>(null),
    [fetching, setFetching] = useState(false),
    [previewError, setPreviewError] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    setData(null)
    setError('')
    setPage(1)
    setPreview(null)
    setURL(ref)
    setPreviewError('')
    api<Result>(`api/entities?${new URLSearchParams({ name, kind: requestedKind, ref })}`, {
      signal: abort.signal,
    })
      .then(setData)
      .catch((e) => {
        if (!abort.signal.aborted) setError(message(e))
      })
    return () => abort.abort()
  }, [name, requestedKind, ref])
  const kind = data?.kind || requestedKind
  useEffect(() => {
    setFetching(false)
    if (!ref || !safeURL(ref)) return
    const abort = new AbortController()
    setFetching(true)
    api<Preview>('api/authors/preview', {
      method: 'POST',
      body: JSON.stringify({ url: ref }),
      signal: abort.signal,
    })
      .then(setPreview)
      .catch((e) => {
        if (!abort.signal.aborted) setPreviewError(message(e))
      })
      .finally(() => {
        if (!abort.signal.aborted) setFetching(false)
      })
    return () => abort.abort()
  }, [ref])
  const entity = data?.entity || { name, url: ref }
  const saved = profile?.authors.find((a) => a.id === entityKey(entity, kind))
  async function fetchProfile() {
    if (!safeURL(url)) {
      setPreviewError('请输入公开主页、ORCID 或 ROR 记录链接')
      return
    }
    setFetching(true)
    setPreviewError('')
    try {
      setPreview(
        await api<Preview>('api/authors/preview', {
          method: 'POST',
          body: JSON.stringify({ url }),
        }),
      )
    } catch (e) {
      setPreviewError(message(e))
    } finally {
      setFetching(false)
    }
  }
  async function saveProfile() {
    if (!profile || !preview) return
    setFetching(true)
    setPreviewError('')
    try {
      const latest = await api<{ authors: typeof profile.authors; customTags: string[] }>(
        'api/content/authors',
      )
      const id = entityKey(entity, kind)
      const record = {
        ...latest.authors.find((a) => a.id === id),
        id,
        name: entity.name,
        kind,
        homepage: preview.source,
        tags: saved?.tags || [],
        bio: preview.description,
        fetchSummary: preview.description,
        lastFetchedAt: preview.fetchedAt,
        papers: preview.papers,
      }
      await api('api/content/authors', {
        method: 'PUT',
        body: JSON.stringify({
          authors: [...latest.authors.filter((a) => a.id !== id), record],
          customTags: latest.customTags,
        }),
      })
      await refresh()
      notify('资料已保存')
    } catch (e) {
      setPreviewError(message(e))
    } finally {
      setFetching(false)
    }
  }
  return (
    <>
      <Link className="reading-action reading-action--quiet mb-5" to="/top-conf/">
        <ArrowLeft size={16} />
        论文库
      </Link>
      <PageHeading
        title={name || (kind === 'institution' ? '机构' : '作者')}
        action={
          <FollowEntity entity={entity} kind={kind} bio={preview?.description || saved?.bio} />
        }
      />
      <ErrorMessage error={error} />
      {!data && !error && <Busy />}
      {data && (
        <div className="entity-page-grid">
          <aside>
            <Panel title={kind === 'institution' ? '机构资料' : '作者资料'}>
              <div className="entity-profile-body">
                {data.match === 'name' && kind === 'author' && (
                  <p className="entity-match-note">按姓名收录，可能包含同名记录。</p>
                )}
                {!!data.affiliations.length && (
                  <div className="paper-institutions">
                    {data.affiliations.map((org) => (
                      <EntityLink key={org.name} entity={org} kind="institution" />
                    ))}
                  </div>
                )}
                {(preview?.description || saved?.bio || saved?.fetchSummary) && (
                  <p className="entity-bio">
                    {preview?.description || saved?.bio || saved?.fetchSummary}
                  </p>
                )}
                <div className="entity-resource-links">
                  {safeURL(entity.url) && (
                    <a href={safeURL(entity.url)} target="_blank" rel="noreferrer">
                      来源资料 <ArrowUpRight size={14} />
                    </a>
                  )}
                  <a
                    href={
                      kind === 'institution'
                        ? `https://ror.org/search?query=${encodeURIComponent(name)}`
                        : `https://orcid.org/orcid-search/search?searchQuery=${encodeURIComponent(name)}`
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {kind === 'institution' ? 'ROR 机构检索' : 'ORCID 学者检索'}{' '}
                    <ArrowUpRight size={14} />
                  </a>
                  {kind === 'author' && (
                    <a
                      href={`https://dblp.org/search/author?q=${encodeURIComponent(name)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      DBLP <ArrowUpRight size={14} />
                    </a>
                  )}
                  {preview?.profiles
                    ?.filter((link) => safeURL(link.url))
                    .map((link, i) => (
                      <a key={i} href={safeURL(link.url)} target="_blank" rel="noreferrer">
                        {link.title} <ArrowUpRight size={14} />
                      </a>
                    ))}
                </div>
                <form
                  className="entity-source-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void fetchProfile()
                  }}
                >
                  <label className="fastui-field">
                    公开资料链接
                    <TextField
                      aria-label="公开资料链接"
                      placeholder={
                        kind === 'institution' ? '官网或 ROR 链接' : '个人官网或 ORCID 链接'
                      }
                      type="url"
                      value={url}
                      onChange={(e) => setURL(e.target.value)}
                    />
                  </label>
                  <Button type="submit" disabled={fetching}>
                    <RefreshCw size={14} />
                    {fetching ? '读取中…' : '读取简介'}
                  </Button>
                </form>
                <ErrorMessage error={previewError} />
                {preview && (
                  <div className="entity-extracted">
                    <strong>{preview.title}</strong>
                    <Button disabled={fetching} onClick={saveProfile}>
                      {saved ? '保存资料' : '关注并保存资料'}
                    </Button>
                    <a href={safeURL(preview.source)} target="_blank" rel="noreferrer">
                      资料来源 · {new Date(preview.fetchedAt).toLocaleDateString('zh-CN')}
                    </a>
                    {!!preview.papers.length && (
                      <details>
                        <summary>官网论文链接（{preview.papers.length}）</summary>
                        {preview.papers
                          .filter((link) => safeURL(link.url))
                          .map((link, i) => (
                            <a key={i} href={safeURL(link.url)} target="_blank" rel="noreferrer">
                              {link.title || link.url}
                            </a>
                          ))}
                      </details>
                    )}
                  </div>
                )}
              </div>
            </Panel>
          </aside>
          <section>
            <Panel title={`收录论文 · ${data.total}`}>
              {data.papers.slice((page - 1) * 12, page * 12).map((p) => (
                <PaperCard key={p.id} paper={p} />
              ))}
              {!data.total && <p className="p-5">暂无可关联的论文。</p>}
              <Pagination page={page} total={data.total} size={12} onChange={setPage} />
            </Panel>
          </section>
        </div>
      )}
    </>
  )
}
