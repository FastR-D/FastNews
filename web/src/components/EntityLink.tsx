import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@fastrd/ui-react'
import { api, message, safeURL } from '../api'
import { useApp } from '../context'
import type { Entity, Paper } from '../types'

export function entityPath(entity: Entity, kind = 'author') {
  const path = `/${kind === 'institution' ? 'institutions' : 'authors'}/${encodeURIComponent(entity.name)}/`
  return entity.url ? `${path}?${new URLSearchParams({ ref: entity.url })}` : path
}
export function entityKey(entity: Entity, kind: string) {
  return `entity:${kind}:${entity.url || entity.orcid || entity.ror || entity.name.toLocaleLowerCase()}`
}
export function FollowEntity({
  entity,
  kind = 'author',
  bio = '',
}: {
  entity: Entity
  kind?: string
  bio?: string
}) {
  const { profile, refresh } = useApp()
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const id = entityKey(entity, kind)
  const followed = profile?.authors.some((a) => a.id === id)
  return (
    <>
      <Button
        disabled={!profile}
        aria-disabled={busy}
        onClick={async () => {
          if (!profile || busy) return
          setBusy(true)
          setError('')
          try {
            const latest = await api<{ authors: typeof profile.authors; customTags: string[] }>(
              'api/content/authors',
            )
            const next = latest.authors.some((a) => a.id === id)
              ? latest.authors.filter((a) => a.id !== id)
              : [
                  ...latest.authors,
                  {
                    id,
                    name: entity.name,
                    kind,
                    homepage: safeURL(entity.url) || '',
                    tags: [],
                    bio,
                  },
                ]
            await api('api/content/authors', {
              method: 'PUT',
              body: JSON.stringify({ authors: next, customTags: latest.customTags }),
            })
            await refresh()
          } catch (e) {
            setError(message(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? '保存中…' : followed ? '取消关注' : '关注'}
      </Button>
      {error && (
        <span role="alert" className="entity-error">
          {error}
        </span>
      )}
    </>
  )
}
export default function EntityLink({ entity, kind = 'author' }: { entity: Entity; kind?: string }) {
  const { profile } = useApp()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const anchor = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  function show() {
    clearTimeout(timer.current)
    const rect = anchor.current?.getBoundingClientRect()
    if (rect)
      setPosition({
        top:
          rect.bottom + 260 > window.innerHeight ? Math.max(12, rect.top - 260) : rect.bottom + 6,
        left: Math.max(16, Math.min(rect.left, window.innerWidth - 336)),
      })
    setOpen(true)
  }
  function hide() {
    timer.current = setTimeout(() => {
      if (!anchor.current?.contains(document.activeElement)) setOpen(false)
    }, 150)
  }
  useEffect(() => {
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, { passive: true })
    return () => {
      clearTimeout(timer.current)
      window.removeEventListener('scroll', close)
    }
  }, [])
  const saved = profile?.authors.find((a) => a.id === entityKey(entity, kind))
  const bio =
    saved?.bio || saved?.fetchSummary || entity.affiliations?.map((a) => a.name).join(' · ')
  return (
    <span
      ref={anchor}
      className="entity-link-wrap"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <Link className="entity-link" to={entityPath(entity, kind)}>
        {entity.name}
      </Link>
      {open && (
        <span
          className="entity-popover"
          style={position}
          onMouseEnter={() => clearTimeout(timer.current)}
          onMouseLeave={hide}
          role="group"
          aria-label={`${entity.name}简介`}
        >
          <strong>{entity.name}</strong>
          <span>
            {bio || (kind === 'institution' ? '查看机构资料与收录论文' : '查看作者资料与收录论文')}
          </span>
          <span className="entity-popover-actions">
            <FollowEntity entity={entity} kind={kind} bio={bio} />
            <Link to={entityPath(entity, kind)}>论文汇总 →</Link>
          </span>
        </span>
      )}
    </span>
  )
}
export function PaperPeople({ paper }: { paper: Paper }) {
  const people = paper.authors_list || []
  const associated = new Set(
    people.flatMap((person) => person.affiliations?.map((org) => org.name) || []),
  )
  const extraInstitutions = paper.institutions?.filter((org) => !associated.has(org.name)) || []
  return (
    <div className="paper-people">
      {!!people.length && (
        <div className="paper-authors">
          {people.map((person, i) => (
            <span className="paper-person" key={`${person.name}-${i}`}>
              <EntityLink entity={person} />
              {!!person.affiliations?.length && (
                <span className="paper-person-affiliations">
                  {' ('}
                  {person.affiliations.map((org, j) => (
                    <span key={`${org.name}-${j}`}>
                      {j > 0 && '; '}
                      <EntityLink entity={org} kind="institution" />
                    </span>
                  ))}
                  {')'}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
      {!people.length && (paper.author || paper.authors) && (
        <div className="paper-authors">{paper.author || paper.authors}</div>
      )}
      {!!extraInstitutions.length && (
        <div className="paper-institutions">
          {extraInstitutions.map((org, i) => (
            <EntityLink key={`${org.name}-${i}`} entity={org} kind="institution" />
          ))}
        </div>
      )}
    </div>
  )
}
