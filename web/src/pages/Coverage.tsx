import { useEffect, useState } from 'react'
import { Badge, Button, EmptyState, Select, Toolbar } from '@fastrd/ui-react'
import { useSearchParams } from 'react-router-dom'
import { api, message } from '../api'
import { useApp } from '../context'
import type { ConferenceCoverage } from '../types'
import { Busy, ErrorMessage, Metrics, PageHeading, Panel } from '../components/Common'

const stages: Record<string, string> = {
  'fetch-conf': '论文采集',
  'enrich-abstracts': '原始摘要补全',
  'summarize-conf': '分类与总结',
}
const states: Record<string, string> = {
  started: '已开始，未记录结束',
  completed: '已完成',
  failed: '失败',
}
const errors: Record<string, string> = {
  network: '网络请求失败',
  source_http: '来源 HTTP 响应失败',
  storage: '本地语料读写失败',
  model: '模型服务失败',
  processing: '来源校验或处理失败',
}
function date(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN') : '未记录'
}

export default function Coverage() {
  const { catalog } = useApp()
  const [params, setParams] = useSearchParams()
  const conference = params.get('conference') || ''
  const [rows, setRows] = useState<ConferenceCoverage[]>([])
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function load() {
    setBusy(true)
    setError('')
    try {
      const result = await api<{ conferences: ConferenceCoverage[] }>('api/coverage')
      setRows(result.conferences)
    } catch (error) {
      setError(message(error))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    load()
  }, [])
  const selected = rows.filter((row) => !conference || row.conference === conference)
  const sum = (key: 'papers' | 'abstracts' | 'summaries' | 'staleSummaries') =>
    selected.reduce((total, row) => total + row[key], 0)
  return (
    <>
      <PageHeading
        title="数据覆盖"
        action={
          <Button loading={busy} onClick={load}>
            刷新覆盖率
          </Button>
        }
      />
      <Metrics
        items={[
          { label: '已采集论文', value: sum('papers'), detail: '按论文身份去重' },
          { label: '有原始摘要', value: sum('abstracts'), detail: '包括已保存的补全结果' },
          { label: '有效总结', value: sum('summaries'), detail: '匹配当前原始材料' },
          { label: '待更新总结', value: sum('staleSummaries'), detail: '原始材料已发生变化' },
        ]}
      />
      <Toolbar label="覆盖范围">
        <label className="fastui-field">
          会议
          <Select
            aria-label="覆盖会议"
            value={conference}
            onChange={(event) =>
              setParams(event.target.value ? { conference: event.target.value } : {})
            }
          >
            <option value="">全部会议</option>
            {Object.entries(catalog?.conferences || {}).map(([id, name]) => (
              <option value={id} key={id}>
                {name}
              </option>
            ))}
          </Select>
        </label>
      </Toolbar>
      <ErrorMessage error={error} />
      {busy ? (
        <Busy />
      ) : !selected.length ? (
        <EmptyState title="当前范围暂无采集记录" />
      ) : (
        selected.map((row) => (
          <Panel
            key={`${row.conference}-${row.year}`}
            title={`${row.name} ${row.year}`}
            action={<Badge>{row.papers} 篇论文</Badge>}
          >
            <div data-testid="coverage-row" className="grid gap-4 p-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="grid gap-2">
                  原始摘要：{row.abstracts} / {row.papers}
                  <progress
                    className="fastui-progress w-full"
                    aria-label={`${row.name} ${row.year} 原始摘要`}
                    value={row.abstracts}
                    max={Math.max(row.papers, 1)}
                  />
                </label>
                <label className="grid gap-2">
                  有效总结：{row.summaries} / {row.papers}
                  <progress
                    className="fastui-progress w-full"
                    aria-label={`${row.name} ${row.year} 有效总结`}
                    value={row.summaries}
                    max={Math.max(row.papers, 1)}
                  />
                </label>
              </div>
              {row.staleSummaries > 0 && (
                <span>待更新总结：{row.staleSummaries} 篇，重新生成后才计入有效总结。</span>
              )}
              <div className="grid gap-1 text-[var(--fastui-muted)]">
                <span>最近数据更新：{date(row.updatedAt)}</span>
                <span>最近任务成功：{date(row.job?.lastSuccessAt)}</span>
                {row.job ? (
                  <>
                    <span>
                      最近任务：{stages[row.job.stage] || row.job.stage} ·{' '}
                      {states[row.job.state] || row.job.state}
                    </span>
                    {row.job.state === 'failed' && (
                      <span>
                        {errors[row.job.errorKind || ''] || '执行失败'}
                        {row.job.httpStatus ? `（HTTP ${row.job.httpStatus}）` : ''}
                        ；此前已保存进度仍保留。
                      </span>
                    )}
                  </>
                ) : (
                  <span>尚未记录任务状态</span>
                )}
              </div>
            </div>
          </Panel>
        ))
      )}
    </>
  )
}
