import { useEffect, useState } from 'react'
import { Button, EmptyState } from '@fastrd/ui-react'
import { api, message } from '../api'
import { useApp } from '../context'
import type { Paper } from '../types'
import { Busy, ErrorMessage, LoginHint, PageHeading, Panel, PaperCard } from '../components/Common'
export default function Inbox() {
  const { profile, refresh } = useApp()
  const [items, setItems] = useState<Paper[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function load() {
    setBusy(true)
    setError('')
    try {
      const v = await api<{ items: Paper[] }>('api/content/inbox')
      setItems(v.items)
      const readIds = v.items.filter((i) => !i.read).map((i) => i.id)
      if (readIds.length) {
        await api('api/content/inbox', { method: 'PUT', body: JSON.stringify({ readIds }) })
        await refresh()
      }
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (profile?.userId) load()
  }, [profile?.userId])
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const current = items.filter((i) => i.date === today),
    older = items.filter((i) => i.date !== today)
  return (
    <>
      <PageHeading
        title="私信"
        description="每天一篇研究论文。优先关注作者，再结合研究印象与标签推荐。"
        action={
          profile && (
            <Button onClick={load} loading={busy}>
              刷新
            </Button>
          )
        }
      />
      {!profile ? (
        <LoginHint />
      ) : busy ? (
        <Busy />
      ) : (
        <>
          <ErrorMessage error={error} />
          <Panel title="今日推送">
            {current.length ? (
              current.map((p) => <PaperCard key={p.id} paper={p} />)
            ) : (
              <EmptyState title="今日暂无推送">补充研究印象或关注作者，帮助匹配论文。</EmptyState>
            )}
          </Panel>
          {older.length > 0 && (
            <Panel title="历史私信">
              {older.map((p) => (
                <div key={p.id}>
                  <p className="inbox-date">{p.date}</p>
                  <PaperCard paper={p} />
                </div>
              ))}
            </Panel>
          )}
        </>
      )}
    </>
  )
}
