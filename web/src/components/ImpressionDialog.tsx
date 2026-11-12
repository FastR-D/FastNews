import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Dialog, TextArea } from '@fastrd/ui-react'
import { X } from 'lucide-react'
import { api, message } from '../api'
import { useApp } from '../context'
import { ErrorMessage } from './Common'

export default function ImpressionDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { profile, refresh, notify } = useApp()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) {
      setText(profile?.impression.text || '')
      setError('')
    }
  }, [open, profile?.impression.text])
  async function save() {
    setSaving(true)
    setError('')
    try {
      await api('api/content/impression', { method: 'PUT', body: JSON.stringify({ text }) })
      await refresh()
      onClose()
      notify('研究印象已保存')
    } catch (error) {
      setError(message(error))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open={open} onClose={onClose} label="个人印象">
      <form
        className="fastui-modal-body"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="fastui-heading my-2">个人印象</h2>
          <Button variant="icon" aria-label="关闭个人印象" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        {profile ? (
          <>
            <p className="text-[var(--fastui-muted)]">
              描述你的研究方向和关注问题，让导读与每日论文更贴近你的研究。
            </p>
            <label className="fastui-field">
              研究印象
              <TextArea
                aria-label="研究印象"
                autoFocus
                value={text}
                maxLength={4000}
                onChange={(event) => setText(event.target.value)}
                rows={8}
              />
            </label>
            <span className="text-[var(--fastui-muted)] text-xs text-right">
              {Array.from(text).length} / 4000
            </span>
            <ErrorMessage error={error} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={onClose}>取消</Button>
              <Button type="submit" variant="primary" loading={saving}>
                保存印象
              </Button>
            </div>
          </>
        ) : (
          <p>
            <Link className="fastui-link" to="/login" onClick={onClose}>
              请先登录 FastNews 账号
            </Link>
          </p>
        )}
      </form>
    </Dialog>
  )
}
