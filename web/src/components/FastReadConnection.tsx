import { useEffect, useState } from 'react'
import { Badge, Button, TextField } from '@fastrd/ui-react'
import { api, message } from '../api'
import { ErrorMessage, Panel } from './Common'

export default function FastReadConnection() {
  const [connected, setConnected] = useState(false)
  const [connectURL, setConnectURL] = useState('')
  const [connectionMode, setConnectionMode] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    api<{ connected: boolean; mode?: string; connect_url?: string }>(
      'api/integrations/fastread/token',
    )
      .then((value) => {
        setConnected(value.connected)
        setConnectionMode(value.mode || 'manual')
        setConnectURL(value.connect_url || '')
      })
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
      setConnectionMode('manual')
      setCopied(false)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel
      title="FastRead 联动"
      action={
        <Badge>
          {connected ? (connectionMode === 'cas' ? 'CAS 已连接' : '已授权连接') : '尚未连接'}
        </Badge>
      }
    >
      <div className="grid gap-4 p-4 sm:p-6">
        <p>
          将 FastRead
          中所选论文提炼出的研究方向同步到当前账号的个人印象，供领域导读和相关工作检索使用。
        </p>
        <p className="text-[var(--fastui-muted)]">
          两端认证同一 CAS 账号后，在 FastRead 设置中一键连接。也可使用手动连接码。
        </p>
        {connectURL && (
          <a className="fastui-link" href={connectURL} target="_blank" rel="noreferrer">
            通过 CAS 连接 FastRead
          </a>
        )}
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
