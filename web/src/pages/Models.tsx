import { ButtonTabs } from '../components/ButtonTabs'
import { useEffect, useState } from 'react'
import { Button, Dialog, EmptyState, Select, TextField } from '@fastrd/ui-react'
import { Check, FlaskConical, Pencil, Plus, Trash2, X } from 'lucide-react'
import { api, message } from '../api'
import { useApp } from '../context'
import { Busy, ErrorMessage, PageHeading } from '../components/Common'

type Model = {
  id: string
  name: string
  kind: string
  baseUrl: string
  model: string
  apiKey?: string
  hasKey: boolean
  clearKey?: boolean
  temperature: number
  maxTokens: number
  timeoutSeconds: number
}
type Settings = {
  revision: number
  default: string
  profiles: Model[]
  assignments: Record<string, string>
}
type Scene = { id: string; name: string; kind: string; offline: string }
type Data = {
  settings: Settings
  scenes: Scene[]
  environment: Record<string, { model: string; enabled: boolean }>
}
const blank = (): Model => ({
  id: crypto.randomUUID(),
  name: '',
  kind: 'chat',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  apiKey: '',
  hasKey: false,
  temperature: 0.3,
  maxTokens: 10000,
  timeoutSeconds: 90,
})

export default function Models() {
  const { profile, notify } = useApp()
  const [data, setData] = useState<Data>()
  const [settings, setSettings] = useState<Settings>()
  const [tab, setTab] = useState('scenes')
  const [form, setForm] = useState<Model>()
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState(false)
  useEffect(() => {
    if (profile?.role !== 'admin') return
    const abort = new AbortController()
    api<Data>('api/admin/models', { signal: abort.signal })
      .then((result) => {
        setData(result)
        setSettings(result.settings)
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(message(e))
      })
    return () => abort.abort()
  }, [profile?.role])
  if (profile?.role !== 'admin') return <ErrorMessage error="需要管理员权限" />
  async function save(next: Settings) {
    setBusy(true)
    setError('')
    setFormError('')
    try {
      const saved = await api<Settings>('api/admin/models', {
        method: 'PUT',
        body: JSON.stringify(next),
      })
      setSettings(saved)
      setData((old) => old && { ...old, settings: saved })
      setForm(undefined)
      notify('模型配置已保存，后续请求与采集任务将使用新配置')
    } catch (e) {
      if (form) setFormError(message(e))
      else setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  async function test() {
    setTesting(true)
    setTested(false)
    setFormError('')
    try {
      await api('api/admin/models/test', { method: 'POST', body: JSON.stringify(form) })
      setTested(true)
    } catch (e) {
      setFormError(message(e))
    } finally {
      setTesting(false)
    }
  }
  function edit(model: Model) {
    setForm({ ...model, apiKey: '' })
    setFormError('')
    setTested(false)
  }
  function change(patch: Partial<Model>) {
    setForm((old) => old && { ...old, ...patch })
    setTested(false)
  }
  const dirty = settings && data && JSON.stringify(settings) !== JSON.stringify(data.settings)
  const envLabel = (kind: string) =>
    data?.environment[kind]?.enabled
      ? `服务器默认 · ${data.environment[kind].model}`
      : '服务器默认 · 本地处理'
  return (
    <>
      <PageHeading
        title="大模型配置"
        action={
          <Button
            variant="primary"
            disabled={!settings || busy || testing}
            onClick={() => edit(blank())}
          >
            <Plus size={16} />
            添加模型
          </Button>
        }
      />
      <ErrorMessage error={error} />
      {!data || !settings ? (
        !error && <Busy />
      ) : (
        <>
          <div className="model-tabs">
            <ButtonTabs
              label="大模型配置"
              tabs={[
                { id: 'scenes', label: '场景分配', controls: 'model-panel' },
                { id: 'connections', label: '模型连接', controls: 'model-panel' },
              ]}
              activeId={tab}
              onSelect={setTab}
            />
          </div>
          <div id="model-panel" role="tabpanel" aria-labelledby={tab}>
            {tab === 'scenes' ? (
              <>
                <section className="model-default model-card">
                  <label className="fastui-field">
                    默认聊天模型
                    <Select
                      aria-label="默认聊天模型"
                      value={settings.default}
                      disabled={busy}
                      onChange={(e) => setSettings({ ...settings, default: e.target.value })}
                    >
                      <option value="">{envLabel('chat')}</option>
                      {settings.profiles
                        .filter((m) => m.kind === 'chat')
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} · {m.model}
                          </option>
                        ))}
                    </Select>
                  </label>
                  <Button
                    variant="primary"
                    loading={busy}
                    disabled={!dirty}
                    onClick={() => save(settings)}
                  >
                    保存分配
                  </Button>
                </section>
                <div className="model-grid">
                  {data.scenes.map((scene) => {
                    const assigned = settings.assignments[scene.id] || ''
                    const effective = assigned || (scene.kind === 'chat' ? settings.default : '')
                    const model = settings.profiles.find((m) => m.id === effective)
                    const enabled =
                      effective !== 'disabled' && (model || data.environment[scene.kind]?.enabled)
                    return (
                      <section className="model-card model-scene" key={scene.id}>
                        <div className="model-card-heading">
                          <h2>{scene.name}</h2>
                          <span className={`model-status ${enabled ? 'is-active' : ''}`}>
                            {enabled ? '模型处理' : '本地处理'}
                          </span>
                        </div>
                        <Select
                          aria-label={`${scene.name}模型`}
                          value={assigned}
                          disabled={busy}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              assignments: { ...settings.assignments, [scene.id]: e.target.value },
                            })
                          }
                        >
                          <option value="">
                            {scene.kind === 'chat' ? '使用默认聊天模型' : envLabel('embedding')}
                          </option>
                          <option value="disabled">{scene.offline}</option>
                          {settings.profiles
                            .filter((m) => m.kind === scene.kind)
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name} · {m.model}
                              </option>
                            ))}
                        </Select>
                        <p className="model-effective">
                          {enabled
                            ? model
                              ? `${model.name} / ${model.model}`
                              : envLabel(scene.kind)
                            : scene.offline}
                        </p>
                      </section>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="model-grid">
                {settings.profiles.length === 0 ? (
                  <EmptyState title="添加第一个模型连接" />
                ) : (
                  settings.profiles.map((m) => {
                    const used =
                      settings.default === m.id ||
                      Object.values(settings.assignments).includes(m.id)
                    return (
                      <section className="model-card" key={m.id}>
                        <div className="model-card-heading">
                          <h2>{m.name}</h2>
                          <span className="model-status">
                            {m.kind === 'chat' ? '聊天模型' : '向量模型'}
                          </span>
                        </div>
                        <p className="model-name">{m.model}</p>
                        <p className="model-effective">{m.baseUrl}</p>
                        <div className="model-card-footer">
                          <span className="model-status">{m.hasKey ? '密钥已配置' : '无密钥'}</span>
                          <div className="flex gap-1">
                            <Button
                              variant="quiet"
                              disabled={busy}
                              aria-label={`编辑 ${m.name}`}
                              onClick={() => edit(m)}
                            >
                              <Pencil size={14} />
                              编辑
                            </Button>
                            <Button
                              variant="quiet"
                              disabled={busy || used}
                              title={used ? '先解除默认模型或场景分配' : '删除未使用的连接'}
                              aria-label={`删除 ${m.name}`}
                              onClick={() =>
                                save({
                                  ...settings,
                                  profiles: settings.profiles.filter((p) => p.id !== m.id),
                                })
                              }
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>
                      </section>
                    )
                  })
                )}
              </div>
            )}
          </div>
        </>
      )}
      <Dialog
        open={!!form}
        onClose={() => {
          if (!busy && !testing) setForm(undefined)
        }}
        label="模型连接"
      >
        {form && (
          <>
            <header className="admin-dialog-heading">
              <h2>模型连接</h2>
              <Button
                variant="icon"
                aria-label="关闭模型编辑"
                disabled={busy || testing}
                onClick={() => setForm(undefined)}
              >
                <X size={16} />
              </Button>
            </header>
            <ErrorMessage error={formError} />
            <form
              className="model-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (settings)
                  save({
                    ...settings,
                    profiles: [...settings.profiles.filter((m) => m.id !== form.id), form],
                  })
              }}
            >
              <fieldset disabled={busy || testing} className="model-fields">
                <label className="fastui-field">
                  连接名称
                  <TextField
                    required
                    maxLength={120}
                    value={form.name}
                    onChange={(e) => change({ name: e.target.value })}
                  />
                </label>
                <label className="fastui-field">
                  模型类型
                  <Select
                    aria-label="模型类型"
                    value={form.kind}
                    onChange={(e) => change({ kind: e.target.value })}
                  >
                    <option value="chat">聊天模型</option>
                    <option value="embedding">向量模型</option>
                  </Select>
                </label>
                <label className="fastui-field model-wide">
                  API 地址
                  <TextField
                    required
                    type="url"
                    placeholder="https://api.openai.com/v1"
                    value={form.baseUrl}
                    onChange={(e) => change({ baseUrl: e.target.value })}
                  />
                </label>
                <label className="fastui-field model-wide">
                  模型名称
                  <TextField
                    required
                    placeholder="填写服务商的模型 ID"
                    value={form.model}
                    onChange={(e) => change({ model: e.target.value })}
                  />
                </label>
                <label className="fastui-field model-wide">
                  API 密钥
                  <TextField
                    type="password"
                    autoComplete="new-password"
                    disabled={form.clearKey}
                    placeholder={form.hasKey ? '已保存，留空保持原密钥' : '无鉴权服务可留空'}
                    value={form.apiKey || ''}
                    onChange={(e) => change({ apiKey: e.target.value })}
                  />
                </label>
                {form.hasKey && (
                  <label className="model-wide flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!form.clearKey}
                      onChange={(e) => change({ clearKey: e.target.checked, apiKey: '' })}
                    />
                    清除已保存的密钥
                  </label>
                )}
                {form.kind === 'chat' && (
                  <>
                    <label className="fastui-field">
                      温度
                      <TextField
                        type="number"
                        required
                        min={0}
                        max={2}
                        step={0.1}
                        value={form.temperature}
                        onChange={(e) => change({ temperature: Number(e.target.value) })}
                      />
                    </label>
                    <label className="fastui-field">
                      输出上限（tokens）
                      <TextField
                        type="number"
                        required
                        min={128}
                        max={128000}
                        value={form.maxTokens}
                        onChange={(e) => change({ maxTokens: Number(e.target.value) })}
                      />
                    </label>
                  </>
                )}
                <label className="fastui-field">
                  超时（秒）
                  <TextField
                    type="number"
                    required
                    min={5}
                    max={300}
                    value={form.timeoutSeconds}
                    onChange={(e) => change({ timeoutSeconds: Number(e.target.value) })}
                  />
                </label>
              </fieldset>
              <div className="model-form-footer">
                <Button type="button" loading={testing} disabled={busy} onClick={test}>
                  {tested ? <Check size={15} /> : <FlaskConical size={15} />}
                  {tested ? '连接成功' : '测试连接'}
                </Button>
                <Button type="submit" variant="primary" loading={busy} disabled={testing}>
                  保存连接
                </Button>
              </div>
            </form>
          </>
        )}
      </Dialog>
    </>
  )
}
