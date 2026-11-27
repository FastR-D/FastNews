import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Dialog, EmptyState, Select } from '@fastrd/ui-react'
import { Play, RefreshCw, Square, ChevronDown, ChevronUp, Settings2, X } from 'lucide-react'
import { api, message } from '../api'
import { Link } from 'react-router-dom'
import { useApp } from '../context'
import { Busy, ErrorMessage, PageHeading, Panel } from '../components/Common'

type Source = {
  source: string
  name: string
  state: string
  fetched: number
  added: number
  stale: number
  error?: string
  transport?: string
}
type Run = {
  id: string
  selection: string
  trigger?: 'manual' | 'scheduled'
  status: string
  startedAt: string
  finishedAt?: string
  sources: Source[]
  error?: string
}
type Schedule = {
  enabled: boolean
  intervalHours: number
  source: string
  nextRunAt: string
  lastRunAt?: string
  error?: string
}
type Snapshot = {
  queue?: { id: string; source: string; name: string; state: string; requestedAt: string }[]
  schedule: Schedule
  schedulerRunning: boolean
  runs: Run[]
  sources: { id: string; name: string; channel: string }[]
  warning?: string
}
const labels: Record<string, string> = {
  running: '采集中',
  stopping: '正在停止',
  queued: '等待中',
  completed: '已完成',
  partial: '部分失败',
  failed: '失败',
  cancelled: '已停止',
  interrupted: '已中断',
  skipped: '已停用',
}
const groups: Record<string, string> = {
  all: '全部资讯信源',
  'all-research': '资讯与论文',
  papers: '全部论文会议',
  'papers-software': '软工会议 · Coding Agent',
  'papers-ml': 'AI 三大会',
  security: '安全研究',
  ai: 'AI 研究',
  arxiv: 'arXiv 论文',
}
function duration(start: string, end?: string) {
  const seconds = Math.max(
    0,
    Math.floor(((end ? Date.parse(end) : Date.now()) - Date.parse(start)) / 1000),
  )
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}
function Status({ value }: { value: string }) {
  return <span className={`task-status ${value}`}>{labels[value] || value}</span>
}
function SourceResults({ run }: { run: Run }) {
  const [showCompleted, setShowCompleted] = useState(false)
  const completed = run.sources.filter((entry) => entry.state === 'completed')
  const visible = run.sources.filter((entry) => entry.state !== 'completed')
  if (showCompleted) visible.push(...completed)
  return (
    <Panel
      title="信源结果"
      className="admin-panel"
      action={
        completed.length > 0 && (
          <Button
            variant="quiet"
            aria-expanded={showCompleted}
            aria-controls="collection-source-results"
            onClick={() => setShowCompleted((value) => !value)}
          >
            {showCompleted ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showCompleted ? '折叠' : '展开'}已完成（{completed.length}）
          </Button>
        )
      }
    >
      <div className="fastui-table-scroll" id="collection-source-results">
        <table className="fastui-table admin-table" aria-label="信源结果">
          <thead>
            <tr>
              <th>信源</th>
              <th>状态</th>
              <th>网络</th>
              <th>读取</th>
              <th>过期</th>
              <th>新增</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry) => (
              <tr key={entry.source}>
                <td>
                  <strong>{entry.name}</strong>
                  {entry.error && <p className="source-error">{entry.error}</p>}
                </td>
                <td>
                  <Status value={entry.state} />
                </td>
                <td>
                  {entry.transport === 'relay'
                    ? '新加坡'
                    : entry.transport === 'direct'
                      ? '直连'
                      : '—'}
                </td>
                <td>{entry.fetched}</td>
                <td>{entry.stale}</td>
                <td>{entry.added}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
function SchedulePanel({ data, reload }: { data: Snapshot; reload: () => Promise<void> }) {
  const { notify } = useApp()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(data.schedule)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const schedule = data.schedule
  const formatTime = (value?: string) =>
    value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未运行'
  async function save(value: Schedule) {
    setBusy(true)
    setError('')
    try {
      await api('api/admin/collection/schedule', {
        method: 'POST',
        body: JSON.stringify({
          enabled: value.enabled,
          intervalHours: value.intervalHours,
          source: value.source,
        }),
      })
      await reload()
      setOpen(false)
      notify(value.enabled ? '定时采集计划已保存' : '定时采集已暂停')
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Panel
        title="定时采集"
        action={
          <Button
            variant="quiet"
            onClick={() => {
              setDraft(schedule)
              setError('')
              setOpen(true)
            }}
          >
            <Settings2 size={15} />
            修改计划
          </Button>
        }
      >
        <div className="schedule-overview">
          <div>
            <span
              className={`task-status ${schedule.enabled && data.schedulerRunning ? 'completed' : 'cancelled'}`}
            >
              {!data.schedulerRunning ? '调度未启动' : schedule.enabled ? '已启用' : '已暂停'}
            </span>
            <strong>每 {schedule.intervalHours} 小时</strong>
            <span>
              {groups[schedule.source] ||
                data.sources.find((entry) => entry.id === schedule.source)?.name ||
                schedule.source}
            </span>
          </div>
          <div>
            <span>下次采集</span>
            <strong>
              {schedule.enabled && data.schedulerRunning ? formatTime(schedule.nextRunAt) : '—'}
            </strong>
            <span>上次定时采集：{formatTime(schedule.lastRunAt)}</span>
          </div>
          <Button
            variant="quiet"
            loading={busy}
            onClick={() => void save({ ...schedule, enabled: !schedule.enabled })}
          >
            {schedule.enabled ? '暂停定时采集' : '恢复定时采集'}
          </Button>
        </div>
        {!open && <ErrorMessage error={error || schedule.error || ''} />}
      </Panel>
      <Dialog
        open={open}
        onClose={() => {
          if (!busy) setOpen(false)
        }}
        label="采集计划"
      >
        <header className="admin-dialog-heading">
          <h2>采集计划</h2>
          <Button
            variant="icon"
            aria-label="关闭计划设置"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            <X size={16} />
          </Button>
        </header>
        <form
          className="admin-user-form grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void save(draft)
          }}
        >
          <label className="fastui-field">
            采集频率
            <Select
              aria-label="采集频率"
              value={draft.intervalHours}
              onChange={(event) =>
                setDraft({ ...draft, intervalHours: Number(event.target.value) })
              }
            >
              {[1, 3, 6, 12, 24, 48, 168].map((hours) => (
                <option key={hours} value={hours}>
                  每 {hours} 小时
                </option>
              ))}
            </Select>
          </label>
          <label className="fastui-field">
            定时采集范围
            <Select
              aria-label="定时采集范围"
              value={draft.source}
              onChange={(event) => setDraft({ ...draft, source: event.target.value })}
            >
              {Object.entries(groups).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
              <optgroup label="单个信源">
                {data.sources.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </optgroup>
            </Select>
          </label>
          <label className="fastui-field">
            计划状态
            <Select
              aria-label="计划状态"
              value={String(draft.enabled)}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.value === 'true' })}
            >
              <option value="true">启用</option>
              <option value="false">暂停</option>
            </Select>
          </label>
          <ErrorMessage error={error} />
          <div className="flex justify-end gap-2">
            <Button disabled={busy} onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              保存计划
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  )
}

export default function Processes() {
  const { profile, notify, retryCatalog } = useApp()
  const [data, setData] = useState<Snapshot | null>(null)
  const [source, setSource] = useState('all')
  const [error, setError] = useState('')
  const [pollError, setPollError] = useState('')
  const requestVersion = useRef(0)
  const previousActive = useRef(false)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++requestVersion.current
    const next = await api<Snapshot>('api/admin/collection', { signal })
    if (version === requestVersion.current) {
      setData(next)
      setPollError('')
    }
  }, [])
  useEffect(() => {
    if (profile?.role !== 'admin') return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        await load(abort.signal)
      } catch (e) {
        if (!abort.signal.aborted) setPollError(message(e))
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, 2500)
    }
    void poll()
    return () => {
      abort.abort()
      clearTimeout(timer)
    }
  }, [profile?.role, load])
  const active = data?.runs.find((run) => ['running', 'stopping'].includes(run.status))
  useEffect(() => {
    if (previousActive.current && !active) retryCatalog()
    previousActive.current = !!active
  }, [active?.id, active?.status, retryCatalog])

  if (profile?.role !== 'admin') return <ErrorMessage error="需要管理员权限" />
  async function action(cancelID?: string) {
    setBusy(true)
    setError('')
    try {
      const run = await api<Run>(`api/admin/collection${cancelID ? `/${cancelID}/cancel` : ''}`, {
        method: 'POST',
        body: JSON.stringify(cancelID ? {} : { source }),
      })
      setSelected(run.id)
      await load()
      notify(cancelID ? '正在停止采集' : '采集已启动')
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const detail =
    selected === 'closed' ? undefined : data?.runs.find((run) => run.id === selected) || active
  const completed =
    active?.sources.filter((entry) => !['running', 'queued'].includes(entry.state)).length || 0
  return (
    <>
      <PageHeading
        title="进程管理"
        action={
          <Button
            variant="quiet"
            loading={refreshing}
            onClick={async () => {
              setRefreshing(true)
              try {
                await load()
              } catch (e) {
                setError(message(e))
              } finally {
                setRefreshing(false)
              }
            }}
          >
            <RefreshCw size={15} />
            刷新
          </Button>
        }
      />
      <ErrorMessage error={error || pollError || data?.warning || ''} />
      {data?.schedule && <SchedulePanel data={data} reload={load} />}
      <Panel title="手动采集">
        <form
          className="collection-controls"
          onSubmit={(e) => {
            e.preventDefault()
            void action()
          }}
        >
          <label className="fastui-field">
            采集范围
            <Select
              aria-label="采集范围"
              value={source}
              disabled={!!active || busy}
              onChange={(e) => setSource(e.target.value)}
            >
              {Object.entries(groups).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
              {!!data?.sources.length && (
                <optgroup label="单个信源">
                  {data.sources.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </label>
          <Button
            type="submit"
            variant="primary"
            disabled={!!active || !data}
            loading={busy && !active}
          >
            <Play size={15} />
            开始采集
          </Button>
          {active && (
            <Button
              type="button"
              variant="danger"
              loading={busy}
              disabled={active.status === 'stopping'}
              onClick={() => void action(active.id)}
            >
              <Square size={14} />
              停止采集
            </Button>
          )}
        </form>
        {active && (
          <div className="collection-progress" role="status">
            <div>
              <Status value={active.status} />
              <span>
                {completed} / {active.sources.length} 个信源 · 新增{' '}
                {active.sources.reduce((sum, entry) => sum + entry.added, 0)} 条
              </span>
            </div>
            <progress aria-label="采集进度" value={completed} max={active.sources.length} />
          </div>
        )}
      </Panel>
      {!!data?.queue?.length && (
        <Panel title="采集队列" className="admin-panel">
          <div className="fastui-table-scroll">
            <table className="fastui-table admin-table" aria-label="采集队列">
              <thead>
                <tr>
                  <th>信源</th>
                  <th>状态</th>
                  <th>加入时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.queue.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link
                        className="fastui-link"
                        to={`/sources/?q=${encodeURIComponent(item.name)}`}
                      >
                        {item.name}
                      </Link>
                    </td>
                    <td>{item.state === 'needs_configuration' ? '待接入采集接口' : '等待采集'}</td>
                    <td>{new Date(item.requestedAt).toLocaleString('zh-CN', { hour12: false })}</td>
                    <td>
                      <Button
                        variant="quiet"
                        onClick={async () => {
                          try {
                            await api('api/admin/collection/queue/remove', {
                              method: 'POST',
                              body: JSON.stringify({ id: item.id }),
                            })
                            await load()
                          } catch (e) {
                            setError(message(e))
                          }
                        }}
                      >
                        移出队列
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      <Panel title="采集任务" className="admin-panel">
        {!data ? (
          <Busy />
        ) : !data.runs.length ? (
          <EmptyState title="暂无采集任务" />
        ) : (
          <div className="fastui-table-scroll">
            <table className="fastui-table admin-table" aria-label="采集任务">
              <thead>
                <tr>
                  <th>采集范围</th>
                  <th>触发方式</th>
                  <th>状态</th>
                  <th>开始时间</th>
                  <th>耗时</th>
                  <th>新增</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((run) => (
                  <tr key={run.id} aria-selected={detail?.id === run.id}>
                    <td>
                      <strong>
                        {groups[run.selection] ||
                          data.sources.find((entry) => entry.id === run.selection)?.name ||
                          run.selection}
                      </strong>
                    </td>
                    <td>{run.trigger === 'scheduled' ? '定时采集' : '手动采集'}</td>
                    <td>
                      <Status value={run.status} />
                    </td>
                    <td>{new Date(run.startedAt).toLocaleString('zh-CN', { hour12: false })}</td>
                    <td>{duration(run.startedAt, run.finishedAt)}</td>
                    <td>{run.sources.reduce((sum, entry) => sum + entry.added, 0)}</td>
                    <td>
                      <Button
                        variant="quiet"
                        aria-expanded={detail?.id === run.id}
                        onClick={() => setSelected(detail?.id === run.id ? 'closed' : run.id)}
                      >
                        {detail?.id === run.id ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                        详情
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {detail && <SourceResults key={detail.id} run={detail} />}
    </>
  )
}
