import { useState } from 'react'
import { Badge, Button, Checkbox, Dialog, EmptyState, TextField } from '@fastrd/ui-react'
import { ExternalLink, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { api, message, safeURL } from '../api'
import { useApp } from '../context'
import type { Author } from '../types'
import { ErrorMessage, LoginHint, PageHeading, Panel } from '../components/Common'
const defaultTags = [
  'Web Security',
  'System Security',
  'Cryptography',
  'Privacy',
  'ML/AI Security',
  'Network Security',
  'Software Security',
  'Hardware Security',
  'Usable Security',
  'LLM jailbreak',
  'TEE',
  '侧信道',
]
export default function Authors({ embedded = false }: { embedded?: boolean }) {
  const { profile, refresh, notify } = useApp()
  const [editing, setEditing] = useState<Author | null>(null),
    [open, setOpen] = useState(false),
    [newTag, setNewTag] = useState(''),
    [customTags, setCustomTags] = useState<string[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [fetching, setFetching] = useState(''),
    [confirm, setConfirm] = useState<Author | null>(null)
  function edit(author?: Author) {
    setError('')
    setEditing(
      author
        ? { ...author, tags: author.tags || author.research?.split(/[,，]/).filter(Boolean) || [] }
        : { id: crypto.randomUUID(), name: '', homepage: '', tags: [] },
    )
    setCustomTags(profile?.customTags || [])
    setOpen(true)
  }
  async function persist(authors: Author[], tags = profile?.customTags || []) {
    await api('api/content/authors', {
      method: 'PUT',
      body: JSON.stringify({ authors, customTags: tags }),
    })
    await refresh()
  }
  async function save() {
    if (!editing || !profile) return
    if (!editing.name.trim() || !safeURL(editing.homepage) || !editing.tags.length) {
      setError('请填写姓名、有效主页链接，并至少选择一个研究方向')
      return
    }
    setBusy(true)
    setError('')
    try {
      const author = { ...editing, name: editing.name.trim(), research: editing.tags.join(', ') }
      await persist(
        profile.authors.some((a) => a.id === author.id)
          ? profile.authors.map((a) => (a.id === author.id ? author : a))
          : [...profile.authors, author],
        customTags,
      )
      setOpen(false)
      notify('作者资料已保存')
      await fetchHome(author)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  async function fetchHome(author: Author) {
    setFetching(author.id)
    try {
      const parsed = await api<{
        title: string
        description: string
        papers: { url: string; title: string }[]
      }>('api/authors/preview', { method: 'POST', body: JSON.stringify({ url: author.homepage }) })
      const current = await api<{ authors: Author[]; customTags: string[] }>('api/content/authors')
      await persist(
        current.authors.map((a) =>
          a.id === author.id
            ? {
                ...a,
                fetchStatus: 'done',
                fetchSummary: parsed.description || parsed.title,
                lastFetchedAt: new Date().toISOString(),
                papers: parsed.papers,
              }
            : a,
        ),
        current.customTags,
      )
      notify(`已解析 ${author.name} 的主页，找到 ${parsed.papers.length} 个论文链接`)
    } catch (e) {
      notify(message(e))
    } finally {
      setFetching('')
    }
  }
  async function remove() {
    if (!profile || !confirm) return
    setBusy(true)
    try {
      await persist(profile.authors.filter((a) => a.id !== confirm.id))
      setConfirm(null)
    } catch (e) {
      notify(message(e))
    } finally {
      setBusy(false)
    }
  }
  function addTag() {
    const tag = newTag.trim().slice(0, 40)
    if (!tag || !editing) return
    setCustomTags((v) => Array.from(new Set([...v, tag])))
    setEditing({ ...editing, tags: Array.from(new Set([...editing.tags, tag])) })
    setNewTag('')
  }
  const content = (
    <Panel
      title="关注作者"
      action={
        profile && (
          <Button onClick={() => edit()}>
            <Plus size={13} />
            添加作者
          </Button>
        )
      }
    >
      {!profile ? (
        <LoginHint />
      ) : profile.authors.length === 0 ? (
        <EmptyState title="还没有关注作者">添加姓名、主页和研究方向，开始持续跟踪。</EmptyState>
      ) : (
        <>
          <div className="authors-head">
            <span>名称</span>
            <span>研究方向 / 主页</span>
            <span>操作</span>
          </div>
          {profile.authors.map((a) => (
            <article className="author-row" key={a.id}>
              <button className="author-edit" onClick={() => edit(a)}>
                <strong>{a.name}</strong>
                <span>
                  <span className="author-tags">
                    {(a.tags || a.research?.split(/[,，]/) || []).map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </span>
                  <small>{a.homepage}</small>
                  {a.fetchSummary && <small className="fetch-summary">{a.fetchSummary}</small>}
                </span>
              </button>
              <div className="row-actions">
                <a
                  href={safeURL(a.homepage)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`打开 ${a.name} 主页`}
                >
                  <ExternalLink size={14} />
                </a>
                <Button variant="icon" aria-label={`编辑 ${a.name}`} onClick={() => edit(a)}>
                  <Pencil size={14} />
                </Button>
                <Button
                  variant="icon"
                  aria-label={`抓取 ${a.name} 主页`}
                  loading={fetching === a.id}
                  onClick={() => fetchHome(a)}
                >
                  <RefreshCw size={14} />
                </Button>
                <Button variant="icon" aria-label={`删除 ${a.name}`} onClick={() => setConfirm(a)}>
                  <Trash2 size={14} />
                </Button>
              </div>
              {a.papers && a.papers.length > 0 && (
                <details className="author-papers">
                  <summary>{a.papers.length} 个论文链接</summary>
                  {a.papers.map((p) => (
                    <a key={p.url} href={safeURL(p.url)} target="_blank" rel="noreferrer">
                      {p.title || p.url}
                    </a>
                  ))}
                </details>
              )}
            </article>
          ))}
        </>
      )}
    </Panel>
  )
  return (
    <div id="authors">
      {!embedded && (
        <PageHeading title="关注作者" description="维护作者主页和研究方向，持续跟踪研究动态。" />
      )}
      {content}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        label={profile?.authors.some((a) => a.id === editing?.id) ? '编辑作者' : '新增作者'}
      >
        <form
          className="dialog-body"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <div className="dialog-title">
            <h2>{profile?.authors.some((a) => a.id === editing?.id) ? '编辑作者' : '新增作者'}</h2>
            <Button variant="icon" aria-label="关闭编辑" onClick={() => setOpen(false)}>
              <X size={15} />
            </Button>
          </div>
          <div className="form-grid">
            <label className="fastui-field">
              姓名
              <TextField
                autoFocus
                required
                maxLength={100}
                value={editing?.name || ''}
                onChange={(e) => editing && setEditing({ ...editing, name: e.target.value })}
              />
            </label>
            <label className="fastui-field">
              主页链接
              <TextField
                type="url"
                required
                placeholder="https://example.com"
                value={editing?.homepage || ''}
                onChange={(e) => editing && setEditing({ ...editing, homepage: e.target.value })}
              />
            </label>
          </div>
          <fieldset>
            <legend>研究方向</legend>
            <div className="tag-options">
              {Array.from(new Set([...defaultTags, ...customTags, ...(editing?.tags || [])])).map(
                (t) => (
                  <label key={t}>
                    <Checkbox
                      checked={editing?.tags.includes(t) || false}
                      onChange={(e) =>
                        editing &&
                        setEditing({
                          ...editing,
                          tags: e.target.checked
                            ? [...editing.tags, t]
                            : editing.tags.filter((v) => v !== t),
                        })
                      }
                    />
                    {t}
                  </label>
                ),
              )}
            </div>
            <div className="search-toolbar">
              <TextField
                aria-label="自定义标签"
                value={newTag}
                maxLength={40}
                placeholder="输入自定义方向"
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTag()
                  }
                }}
              />
              <Button onClick={addTag}>添加标签</Button>
            </div>
          </fieldset>
          <ErrorMessage error={error} />
          <div className="dialog-actions">
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="submit" variant="primary" loading={busy}>
              保存作者
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} label="删除作者">
        <div className="dialog-body">
          <h2>删除 {confirm?.name}</h2>
          <p>此作者将从关注列表移除。</p>
          <div className="dialog-actions">
            <Button onClick={() => setConfirm(null)}>取消</Button>
            <Button variant="danger" loading={busy} onClick={remove}>
              确认删除
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
