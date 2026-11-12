import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, ChartNoAxesCombined, Mail, Users } from 'lucide-react'
import { useApp } from '../context'
import { api, safeURL } from '../api'
import type { NewsArticle } from '../types'
import { Busy, PageHeading, Panel, ReportList } from '../components/Common'
import Authors from './Authors'
export default function Home() {
  const { catalog, profile } = useApp()
  const [news, setNews] = useState<NewsArticle[]>([])
  useEffect(() => {
    if (catalog?.dates[0])
      api<{ articles: NewsArticle[] }>(`api/news?date=${catalog.dates[0]}`)
        .then((v) => setNews(v.articles))
        .catch(() => {})
  }, [catalog?.dates[0]])
  if (!catalog) return <Busy />
  const top = catalog.reports.filter((r) => r.kind === 'top-conf'),
    weekly = catalog.reports.filter((r) => r.kind === 'secnews')
  const gateways = [
    {
      to: '/field-briefing/',
      title: '领域导读',
      desc: '分类综述研究现状，并推荐高相关论文。',
      icon: <BookOpen />,
      meta: `${catalog.papers} 篇本地论文`,
    },
    {
      to: '/summary-brief/',
      title: '总结汇报',
      desc: '基于顶会摘要生成数据实证简报与会场对照。',
      icon: <ChartNoAxesCombined />,
      meta: `${catalog.topPapers} 篇顶会摘要`,
    },
    {
      to: '/inbox/',
      title: '私信',
      desc: '每天优先推送关注作者的论文，其次参考研究印象。',
      icon: <Mail />,
      meta: '每天一篇 · 持续跟踪',
    },
    {
      to: '/authors',
      title: '关注作者',
      desc: '维护作者主页和研究方向，方便持续跟踪。',
      icon: <Users />,
      meta: `${profile?.authors.length || 0} 位作者`,
    },
  ]
  return (
    <>
      <PageHeading
        title="安全研究报告工作台"
        description="集中访问会议报告和安全周报，并维护感兴趣作者列表。"
        action={
          <details className="today-card">
            <summary>
              <span className="today-new">NEW</span>
              <span>最新快讯</span>
              <strong>{catalog.dates[0] || '暂无资讯'}</strong>
              <small>{news.length} 条新鲜出炉 · 点击展开</small>
            </summary>
            <div className="today-popover">
              <strong>当天头条</strong>
              {news.slice(0, 6).map((n) => (
                <a key={n._id} href={safeURL(n.link)} target="_blank" rel="noreferrer">
                  {n.title_zh || n.title}
                </a>
              ))}
              <Link to={`/secnews/?date=${catalog.dates[0]}`}>
                前往当天资讯界面 <ArrowRight size={12} />
              </Link>
            </div>
          </details>
        }
      />
      <section className="stats" aria-label="概览统计">
        {[
          [catalog.reports.length, '已生成报告'],
          [catalog.topPapers, '已总结论文'],
          [profile?.authors.length || 0, '关注作者'],
        ].map(([n, label]) => (
          <div className="stat" key={label}>
            <strong>{Number(n).toLocaleString()}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>
      <div className="workspace">
        <Panel
          title="安全资讯周报"
          action={
            <Link to="/secnews/">
              查看资讯 <ArrowRight size={12} />
            </Link>
          }
        >
          <ReportList reports={weekly} />
        </Panel>
        <Panel
          title="顶会报告"
          action={
            <Link to="/top-conf/">
              全部论文 <ArrowRight size={12} />
            </Link>
          }
        >
          <ReportList reports={top.slice(0, 4)} />
        </Panel>
        <Panel title="研究入口" className="workspace-wide">
          {gateways.map((g) => (
            <Link className="gateway-row" key={g.to} to={g.to}>
              <span className="gateway-icon">{g.icon}</span>
              <span>
                <strong>{g.title}</strong>
                <p>{g.desc}</p>
                <small>{g.meta}</small>
              </span>
              <ArrowRight size={16} />
            </Link>
          ))}
        </Panel>
        <div className="workspace-wide">
          <Authors embedded />
        </div>
        <Panel title="报告下载" className="workspace-wide">
          <ReportList reports={catalog.reports} download />
        </Panel>
      </div>
    </>
  )
}
