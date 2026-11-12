import { useEffect, useState } from 'react'
import { Badge, Button, TextField } from '@fastrd/ui-react'
import { api, message } from '../api'
import { ErrorMessage, Panel } from './Common'

export default function FastReadConnection() {
  const [connected, setConnected] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    api<{ connected: boolean }>('api/integrations/fastread/token')
      .then((value) => setConnected(value.connected))
      .catch((e) => setError(message(e)))
  }, [])
  async function update(method: 'POST' | 'DELETE') {
    setBusy(true)
    setError('')
    try {
      const value = await api<{ connected: boolean; token?: string }>(
        'api/integrations/fastread/token',
        { method, body: '{}' },
      )
      setConnected(value.connected)
      setToken(value.token || '')
      setCopied(false)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title="FastRead 联动" action={<Badge>{connected ? '已授权连接' : '尚未连接'}</Badge>}>
      <div className="grid gap-4 p-4 sm:p-6">
        <p>
          将 FastRead
          中所选论文提炼出的研究方向同步到当前账号的个人印象，供领域导读和相关工作检索使用。
        </p>
        <p className="text-[var(--fastui-muted)]">
          生成连接码后，复制到 FastRead 设置中的 FastNews
          连接。连接码只在生成时显示；重新生成会替换旧连接码。
        </p>
        <ErrorMessage error={error} />
        {token && (
          <label className="fastui-field">
            FastRead 连接码
            <TextField
              value={token}
              readOnly
              autoComplete="off"
              onFocus={(e) => e.target.select()}
            />
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(token)
                  setCopied(true)
                } catch {
                  setError('请选中连接码并复制')
                }
              }}
            >
              {copied ? '已复制' : '复制连接码'}
            </Button>
          </label>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={busy} onClick={() => update('POST')}>
            {connected ? '重新生成连接码' : '生成连接码'}
          </Button>
          {connected && (
            <Button variant="danger" disabled={busy} onClick={() => update('DELETE')}>
              撤销连接
            </Button>
          )}
        </div>
      </div>
    </Panel>
  )
}
