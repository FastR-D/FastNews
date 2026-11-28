import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ReadingButton as Button, ReadingSurface as Section, SourceMark } from './ReadingLayout'
import { ArrowLeft, ArrowRight, ExternalLink, Type } from 'lucide-react'
import { safeURL } from '../api'
import type { NewsArticle } from '../types'

export const newsChannels: Record<string, string> = {
  security: '安全资讯',
  ai: 'AI 资讯',
}
export function articleScore(a: NewsArticle) {
  const score = a.recommendation_score ?? a.importance ?? a.score
  return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 10
    ? score
    : null
}
export function articleDate(value?: string) {
  if (!value) return '发布时间未提供'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
}
export function ArticleMeta({ article }: { article: NewsArticle }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[var(--fastui-muted)]">
      <SourceMark category={article.channel} />
      <span className="source-pill">{newsChannels[article.channel || ''] || '资讯'}</span>
      <span>{article.source_name || article.source}</span>
      <time title={article.published}>{articleDate(article.published)}</time>
    </div>
  )
}

export function NewsReader({
  article,
  onClose,
  onNext,
  position,
}: {
  article: NewsArticle
  onClose: () => void
  onNext?: () => void
  position: string
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const [large, setLarge] = useState(() => {
    try {
      return localStorage.getItem('fastnews-reading-large') !== 'false'
    } catch {
      return true
    }
  })
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0 })
  }, [article._id])
  const body = article.summary_zh || article.description
  return (
    <div className="max-w-210 mx-auto" data-testid="news-reader">
      <div className="flex flex-wrap gap-3 items-center justify-between mb-6">
        <Button variant="quiet" onClick={onClose}>
          <ArrowLeft size={16} />
          返回资讯列表
        </Button>
        <Button
          variant="quiet"
          aria-pressed={large}
          onClick={() => {
            setLarge(!large)
            try {
              localStorage.setItem('fastnews-reading-large', String(!large))
            } catch {
              /* optional preference */
            }
          }}
        >
          <Type size={16} />
          舒适字号
        </Button>
      </div>
      <Section className="px-5 py-7 sm:px-12 sm:py-10">
        <ArticleMeta article={article} />
        <h1
          ref={heading}
          tabIndex={-1}
          className="outline-none text-2xl sm:text-3xl font-semibold leading-snug tracking-tight break-words my-6"
        >
          {article.title_zh || article.title}
        </h1>
        {article.title_zh && (
          <p className="text-base leading-relaxed text-[var(--fastui-muted)] break-words">
            {article.title}
          </p>
        )}
        {article.author && (
          <p className="text-sm break-words text-[var(--fastui-secondary)]">
            作者 · {article.author}
          </p>
        )}
        <div className="border-t border-t-solid border-t-[var(--fastui-border)] mt-7 pt-7">
          <p className="text-xs tracking-widest text-[var(--fastui-muted)] mb-5">
            {article.summary_zh ? 'AI 导读 · 请结合原文阅读' : '来源摘要 · 完整内容见原文'}
          </p>
          <div
            className={`${large ? 'text-lg leading-9' : 'text-base leading-8'} text-[var(--fastui-text)] break-words whitespace-pre-wrap`}
          >
            {body ? (
              body
                .split(/\n\s*\n/)
                .filter(Boolean)
                .map((paragraph, i) => (
                  <p key={i} className="mt-0 mb-6">
                    {paragraph}
                  </p>
                ))
            ) : (
              <p>该来源尚未提供摘要，可以前往原文阅读。</p>
            )}
          </div>
          {article.score_reason && (
            <p className="p-4 bg-[var(--fastui-chrome)] leading-relaxed text-sm">
              推荐依据 · {article.score_reason}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 mt-8 pt-6 border-t border-t-solid border-t-[var(--fastui-border)]">
          <a
            className="reading-action reading-action--primary"
            href={safeURL(article.link)}
            target="_blank"
            rel="noreferrer"
          >
            前往原文 <ExternalLink size={14} />
          </a>
          <Link
            className="reading-action"
            to={`/sources/?q=${encodeURIComponent(article.source_name || article.source)}`}
          >
            了解这个信源
          </Link>
        </div>
      </Section>
      <div className="flex items-center justify-between gap-4 py-6 text-[var(--fastui-muted)]">
        <span className="text-sm">{position}</span>
        {onNext && (
          <Button onClick={onNext}>
            下一篇 <ArrowRight size={15} />
          </Button>
        )}
      </div>
    </div>
  )
}
