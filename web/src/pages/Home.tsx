import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@fastrd/ui-react'
import { ArrowRight, ArrowUpRight, BookOpen, Mail, Sparkles, TrendingUp } from 'lucide-react'
import { useApp } from '../context'
import { api, message } from '../api'
import type { NewsArticle, Paper } from '../types'
import { CatalogState, ErrorMessage, PageHeading } from '../components/Common'
import { entityPath } from '../components/EntityLink'

type Updates = { date: string; articles: NewsArticle[] }
export default function Home({ onEditImpression }: { onEditImpression: () => void }) {
  const { catalog, profile } = useApp()
  const [updates, setUpdates] = useState<Updates>({ date: '', articles: [] })
  const [newsError, setNewsError] = useState('')
  const [loading, setLoading] = useState(true)
  const [inbox, setInbox] = useState<Paper[]>([])
  const [inboxError, setInboxError] = useState('')
  useEffect(() => {
    if (!catalog) return
    const abort = new AbortController()
    setLoading(true)
    api<Updates>('api/news?source=articles&preview=3', { signal: abort.signal })
      .then(setUpdates)
      .catch((e) => {
        if (!abort.signal.aborted) setNewsError(message(e))
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => abort.abort()
  }, [catalog])
  useEffect(() => {
    setInbox([])
    if (!profile?.userId) return
    const abort = new AbortController()
    api<{ items: Paper[] }>('api/content/inbox', { signal: abort.signal })
      .then((value) =>
        setInbox(
          [...value.items]
            .sort((a, b) =>
              (b.receivedAt || b.date || '').localeCompare(a.receivedAt || a.date || ''),
            )
            .slice(0, 2),
        ),
      )
      .catch((e) => {
        if (!abort.signal.aborted) setInboxError(message(e))
      })
    return () => abort.abort()
  }, [profile?.userId])
  if (!catalog) return <CatalogState />
  const reports = [...catalog.reports].sort((a, b) => b.updated.localeCompare(a.updated))
  const top = reports.filter((r) => r.kind === 'top-conf').slice(0, 3)
  const weekly = reports.find((r) => r.kind === 'secnews')
  const authors = [...(profile?.authors || [])]
    .sort((a, b) => (b.lastFetchedAt || '').localeCompare(a.lastFetchedAt || ''))
    .slice(0, 3)
  const updatesURL = `/updates/${updates.date ? `?date=${updates.date}` : ''}`
  return (
    <>
      <PageHeading title="研究工作台" />
      <div className="home-grid">
        <section className="home-card home-card--reports" aria-labelledby="home-reports-title">
          <header className="home-card-heading">
            <h2 id="home-reports-title">顶会报告</h2>
            <Link className="reading-action" to="/top-conf/">
              浏览论文 <ArrowRight size={14} />
            </Link>
          </header>
          <div className="home-updates">
            {top.length ? (
              top.map((report) => (
                <Link className="home-update" key={report.path} to={report.url}>
                  <span className="home-update-mark">
                    <BookOpen size={18} />
                  </span>
                  <span className="home-update-copy">
                    <strong>{report.title}</strong>
                    <span>最新报告{report.updated ? ` · ${report.updated.slice(0, 10)}` : ''}</span>
                  </span>
                  <ArrowUpRight size={16} />
                </Link>
              ))
            ) : (
              <p className="home-empty">报告生成后，会在这里展示最新内容。</p>
            )}
          </div>
          <nav className="home-card-actions" aria-label="报告与论文入口">
            <Link className="reading-action" to="/top-conf/">
              顶会论文
            </Link>
            {weekly && (
              <Link className="reading-action" to={weekly.url}>
                资讯周报 <ArrowUpRight size={14} />
              </Link>
            )}
            <Link className="reading-action" to="/arxiv/">
              arXiv 导读
            </Link>
          </nav>
        </section>
        <section className="home-card" aria-labelledby="home-news-title">
          <header className="home-card-heading">
            <h2 id="home-news-title">最新快讯</h2>
            {updates.date && <time>{updates.date}</time>}
          </header>
          <ErrorMessage error={newsError} />
          <div className="home-updates">
            {loading ? (
              <p className="home-empty" role="status">
                正在获取最新资讯…
              </p>
            ) : updates.articles.length ? (
              updates.articles.map((article) => (
                <Link
                  className="home-update"
                  key={article._id || article.link}
                  to={`/updates/?${new URLSearchParams({ date: updates.date, article: article._id || article.link })}`}
                >
                  <span className="home-update-copy">
                    <strong>{article.title_zh || article.title}</strong>
                    <span>
                      {article.source_name || article.source}
                      {article.published ? ` · ${article.published.slice(0, 10)}` : ''}
                    </span>
                  </span>
                  <ArrowUpRight size={16} />
                </Link>
              ))
            ) : (
              !newsError && <p className="home-empty">暂无新资讯，可以先浏览信源。</p>
            )}
          </div>
          <nav className="home-card-actions" aria-label="资讯入口">
            <Link className="reading-action" to={updatesURL}>
              查看全部资讯 <ArrowRight size={14} />
            </Link>
            <Link className="reading-action" to="/sources/">
              发现信源
            </Link>
            <Link className="reading-action" to="/trends/">
              研究趋势 <TrendingUp size={14} />
            </Link>
          </nav>
        </section>
        <section className="home-card" aria-labelledby="home-authors-title">
          <header className="home-card-heading">
            <h2 id="home-authors-title">关注作者</h2>
            <Link className="reading-action" to="/following/">
              管理关注 <ArrowRight size={14} />
            </Link>
          </header>
          <div className="home-updates">
            {authors.length ? (
              authors.map((author) => (
                <Link
                  className="home-update"
                  key={author.id}
                  to={entityPath({ name: author.name, url: author.homepage }, author.kind)}
                >
                  <span className="home-avatar" aria-hidden="true">
                    {Array.from(author.name).slice(0, 1)}
                  </span>
                  <span className="home-update-copy">
                    <strong>{author.name}</strong>
                    <span className="home-clamp">
                      {author.papers?.[0]?.title ||
                        author.fetchSummary ||
                        author.bio ||
                        author.research ||
                        author.tags?.join(' · ') ||
                        '查看研究主页与论文'}
                    </span>
                  </span>
                  <ArrowUpRight size={16} />
                </Link>
              ))
            ) : (
              <div className="home-empty">
                <h3>从感兴趣的研究者开始</h3>
                <p>关注作者后，在这里查看主页更新和近期论文。</p>
                <Link className="reading-action" to="/following/">
                  添加关注 <ArrowRight size={14} />
                </Link>
              </div>
            )}
          </div>
          <nav className="home-card-actions" aria-label="作者研究入口">
            <Link className="reading-action" to="/following/">
              作者动态
            </Link>
            <Link className="reading-action" to="/top-conf/">
              从论文发现作者
            </Link>
          </nav>
        </section>
        <section className="home-card home-card--personal" aria-labelledby="home-personal-title">
          <header className="home-card-heading">
            <h2 id="home-personal-title">我的研究</h2>
            <Link className="reading-action" to="/inbox/">
              查看今日私信 <ArrowRight size={14} />
            </Link>
          </header>
          <ErrorMessage error={inboxError} />
          <div className="home-updates">
            {inbox.length ? (
              inbox.map((paper) => (
                <Link className="home-update" key={paper.id} to="/inbox/">
                  <span className="home-update-mark">
                    <Mail size={18} />
                  </span>
                  <span className="home-update-copy">
                    <strong>{paper.title_zh || paper.title}</strong>
                    <span>
                      {paper.read ? '论文推荐' : '未读推荐'}
                      {paper.date ? ` · ${paper.date}` : ''}
                    </span>
                  </span>
                  <ArrowUpRight size={16} />
                </Link>
              ))
            ) : (
              <div className="home-empty">
                <h3>继续你的研究方向</h3>
                <p className="home-clamp">
                  {profile?.impression.text || '补充研究兴趣，接收相关论文推荐。'}
                </p>
                {profile ? (
                  <Button onClick={onEditImpression} variant="secondary">
                    编辑研究印象
                  </Button>
                ) : (
                  <Link className="reading-action" to="/login">
                    登录并完善印象
                  </Link>
                )}
              </div>
            )}
          </div>
          <nav className="home-card-actions" aria-label="个人研究入口">
            <Link className="reading-action" to="/brief/">
              领域导读 <Sparkles size={14} />
            </Link>
            <Link className="reading-action" to="/summary/">
              总结汇报
            </Link>
            {profile && (
              <Button variant="quiet" onClick={onEditImpression}>
                研究印象
              </Button>
            )}
          </nav>
        </section>
      </div>
    </>
  )
}
