import { useState } from 'react'
import { Alert, Badge, Button, Select, TextField } from '@fastrd/ui-react'
import { Sparkles } from 'lucide-react'
import { api, message } from '../api'
import { useApp } from '../context'
import type { Count, Generation, Stats } from '../types'
import { ErrorMessage, PageHeading, Panel, PaperCard } from '../components/Common'
const examples = ['LLM jailbreak', '侧信道', 'TEE', '提示注入', '模糊测试', '差分隐私']
function Bars({ title, rows }: { title: string; rows: Count[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <section className="min-w-0">
      <h3 className="fastui-heading my-2">{title}</h3>
      {rows.slice(0, 12).map((row) => (
        <div
          className="grid grid-cols-[minmax(70px,1fr)_minmax(60px,2fr)_70px] items-center gap-3 mb-2"
          key={row.label}
        >
          <span>{row.label}</span>
          <progress
            className="fastui-progress w-full"
            aria-label={`${title}：${row.label}`}
            value={row.count}
            max={max}
          />
          <small>
            {row.count} · {row.pct.toFixed(1)}%
          </small>
        </div>
      ))}
    </section>
  )
}
function Statistics({ stats }: { stats: Stats }) {
  return (
    <>
      <div className="grid gap-5">
        <Bars title="类别分布" rows={stats.by_category} />
        <Bars title="会场对照" rows={stats.by_conference} />
        <Bars title="年份覆盖" rows={stats.by_year} />
      </div>
      <div className="fastui-table-scroll">
        <table className="fastui-table w-full">
          <caption>会场、年份与样本统计</caption>
          <thead>
            <tr>
              <th>会场</th>
              <th>篇数</th>
              <th>占比</th>
              {stats.by_year.map((y) => (
                <th key={y.label}>{y.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.by_conference.map((c) => (
              <tr key={c.label}>
                <td>{c.label}</td>
                <td>{c.count}</td>
                <td>{c.pct.toFixed(1)}%</td>
                {stats.by_year.map((y) => (
                  <td key={y.label}>{c.years?.[y.label] || 0}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[var(--fastui-muted)]">
        数字仅来自本次本地统计。
        {stats.citation_coverage
          ? `有引用记录 ${stats.citation_coverage} 篇，记录引用总计 ${stats.citation_total}。`
          : '暂无引用次数记录。'}
        {stats.distinguished_count > 0 && `杰出论文 ${stats.distinguished_count} 篇。`}
      </p>
    </>
  )
}
export default function Generate({ kind }: { kind: 'field-briefing' | 'summary-brief' }) {
  const { catalog, profile } = useApp()
  const [query, setQuery] = useState(''),
    [source, setSource] = useState(kind === 'summary-brief' ? 'top-conf' : 'all'),
    [category, setCategory] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<Generation | null>(null)
  const isSummary = kind === 'summary-brief'
  async function run(value = query) {
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const v = await api<Generation>(`api/${kind}`, {
        method: 'POST',
        body: JSON.stringify({
          query: value,
          source,
          category,
          impression: profile?.impression.text || '',
          limit: 12,
        }),
      })
      setResult(v)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageHeading
        title={isSummary ? '总结汇报' : '领域导读'}
        description={
          isSummary
            ? '基于顶会中文摘要，生成有证据支撑的数据实证简报。'
            : '结合顶会中文摘要与近期 arXiv，分类综述研究现状并推荐高相关论文。'
        }
      />
      <Panel
        title={isSummary ? '生成实证简报' : '探索研究方向'}
        action={<Badge>{catalog?.papers || '—'} 篇本地论文</Badge>}
      >
        <form
          className="grid gap-4 p-4 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault()
            run()
          }}
        >
          <label className="fastui-field">
            研究方向
            <TextField
              aria-label="研究方向"
              placeholder={
                isSummary
                  ? '留空生成四大顶会全景，或使用研究印象'
                  : '输入方向，例如 LLM jailbreak；留空使用研究印象'
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={4000}
            />
          </label>
          <div className="grid sm:grid-cols-3 gap-3 p-3">
            <label className="fastui-field">
              语料来源
              <Select
                aria-label="语料来源"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="all">顶会 + 近期 arXiv</option>
                <option value="top-conf">安全顶会</option>
                <option value="arxiv">近期 arXiv</option>
              </Select>
            </label>
            <label className="fastui-field">
              研究类别
              <Select
                aria-label="研究类别"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">全部类别</option>
                {catalog?.categories.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </label>
            <div className="flex items-end">
              <Button variant="primary" loading={busy} type="submit">
                <Sparkles size={14} />
                {busy ? '正在生成…' : isSummary ? '生成简报' : '生成导读'}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(isSummary ? ['四大顶会全景', ...examples] : examples).map((q) => (
              <Button
                key={q}
                size="xs"
                disabled={busy}
                onClick={() => {
                  setQuery(q)
                  run(q)
                }}
              >
                {q}
              </Button>
            ))}
          </div>
          {profile?.impression.text && (
            <p className="text-[var(--fastui-muted)]">
              已结合个人研究印象：{profile.impression.text.slice(0, 120)}
            </p>
          )}
          <ErrorMessage error={error} />
          {busy && (
            <p className="text-[var(--fastui-muted)]" role="status">
              正在召回证据并生成内容，请稍候…
            </p>
          )}
        </form>
      </Panel>
      {result && (
        <div className="grid gap-4 mt-5">
          {result.warning && <Alert tone="warning">{result.warning}</Alert>}
          {result.briefing && (
            <Panel title={result.briefing.field_zh || result.query}>
              <article className="grid gap-5 p-4 sm:p-6 leading-loose break-words">
                <section>
                  <h3 className="fastui-heading my-2">综述范围</h3>
                  <p>{result.briefing.scope}</p>
                </section>
                {result.briefing.categories.map((c, i) => (
                  <section key={`${c.name}-${i}`}>
                    <h3 className="fastui-heading my-2">
                      <span className="mr-2">{i + 1}</span>
                      {c.name}
                    </h3>
                    {c.consensus && (
                      <p>
                        <strong>共识 </strong>
                        {c.consensus}
                      </p>
                    )}
                    {c.developments && (
                      <p>
                        <strong>发展与比较 </strong>
                        {c.developments}
                      </p>
                    )}
                    {c.gaps && (
                      <p>
                        <strong>不足 </strong>
                        {c.gaps}
                      </p>
                    )}
                    <div className="grid gap-2">
                      {c.paper_ids.map((id) => {
                        const p = result.papers.find((p) => p.id === id)
                        return p ? (
                          <a
                            className="fastui-link"
                            key={id}
                            href={`#paper-${result.papers.indexOf(p)}`}
                          >
                            {p.title}
                          </a>
                        ) : null
                      })}
                    </div>
                  </section>
                ))}
                <section>
                  <h3 className="fastui-heading my-2">研究空白与局限</h3>
                  <p>{result.briefing.gaps}</p>
                  <p>{result.briefing.limitations}</p>
                </section>
              </article>
            </Panel>
          )}
          {result.brief && (
            <Panel title={result.brief.title || result.query}>
              <article className="grid gap-6 p-4 sm:p-6 leading-loose break-words">
                <header className="grid gap-3">
                  <small>{result.brief.kicker}</small>
                  <h2 className="fastui-heading my-2">{result.brief.hook || result.brief.title}</h2>
                  <p>{result.brief.subtitle}</p>
                  <p>{result.brief.lead}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{result.stats?.year_span}</Badge>
                    <Badge>{result.stats?.sample_size} 篇有效样本</Badge>
                  </div>
                </header>
                <section>
                  <h3 className="fastui-heading my-2">01 · Overview</h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    {result.brief.findings?.map((f, i) => (
                      <article key={i}>
                        <h4 className="fastui-heading my-2">
                          ({i + 1}) {f.title}
                        </h4>
                        <p>{f.body}</p>
                      </article>
                    ))}
                  </div>
                </section>
                <section>
                  <h3 className="fastui-heading my-2">02 · 数据口径</h3>
                  <p>{result.brief.method || result.coverage}</p>
                </section>
                <section>
                  <h3 className="fastui-heading my-2">03 · 会场、年份与类别</h3>
                  {result.stats && <Statistics stats={result.stats} />}
                </section>
                {result.brief.questions?.map((q) => (
                  <section key={q.qid}>
                    <h3 className="fastui-heading my-2">
                      {q.qid} · {q.question}
                    </h3>
                    <p>{q.answer}</p>
                  </section>
                ))}
              </article>
            </Panel>
          )}
          {result.surveys && result.surveys.length > 0 && (
            <Panel title="相关综述与 SoK" action={<Badge>{result.surveys.length} 篇</Badge>}>
              {result.surveys.map((p) => (
                <PaperCard key={p.id} paper={p} />
              ))}
            </Panel>
          )}
          <Panel title="高相关论文推荐" action={<Badge>{result.papers.length} 篇</Badge>}>
            {result.papers.map((p, i) => (
              <div id={`paper-${i}`} key={p.id}>
                <PaperCard paper={p} />
              </div>
            ))}
          </Panel>
          {result.brief && (
            <Panel title="局限与讨论">
              <article className="grid gap-5 p-4 sm:p-6 leading-loose break-words">
                <p>{result.brief.limitations}</p>
                {result.brief.discussion?.map((d, i) => (
                  <section key={i}>
                    <h3 className="fastui-heading my-2">{d.title}</h3>
                    <p>{d.body}</p>
                  </section>
                ))}
              </article>
            </Panel>
          )}
          <p className="text-[var(--fastui-muted)]">{result.coverage}</p>
        </div>
      )}
    </>
  )
}
