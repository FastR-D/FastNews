import { useEffect, useState } from 'react'
import { Button, Dialog, Select, TextField, Toolbar, EmptyState } from '@fastrd/ui-react'
import { Plus, RefreshCw, Pencil, X } from 'lucide-react'
import { api, message } from '../api'
import { useApp } from '../context'
import { ErrorMessage, PageHeading, Panel } from '../components/Common'

type User = { id: string; email: string; name: string; role: string; status: string }
const blank = {
  id: '',
  email: '',
  name: '',
  role: 'user',
  status: 'active',
  password: '',
  reason: '',
}
export default function Users() {
  const { profile, notify, refresh } = useApp()
  const [users, setUsers] = useState<User[]>([])
  const [form, setForm] = useState(blank)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const load = async () => {
    setLoading(true)
    try {
      setUsers(await api<User[]>('api/admin/users'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (profile?.role === 'admin') load().catch((e) => setError(message(e)))
  }, [profile?.role])
  if (profile?.role !== 'admin') return <ErrorMessage error="需要管理员权限" />
  async function save(remove = false) {
    setBusy(true)
    setError('')
    try {
      await api(`api/admin/users${form.id ? `/${form.id}` : ''}`, {
        method: remove ? 'DELETE' : form.id ? 'PATCH' : 'POST',
        body: JSON.stringify(form),
      })
      setEditing(false)
      setForm(blank)
      setDeleting(false)
      if (form.id === profile?.userId) {
        await refresh()
        return
      }
      await load()
      notify(remove ? '用户已删除' : '用户已保存')
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageHeading
        title="用户管理"
        action={
          <Button
            variant="primary"
            onClick={() => {
              setForm(blank)
              setDeleting(false)
              setError('')
              setEditing(true)
            }}
          >
            <Plus size={16} />
            创建用户
          </Button>
        }
      />
      {!editing && <ErrorMessage error={error} />}
      <Panel title="" className="admin-panel">
        <Toolbar label="用户筛选" className="admin-toolbar">
          <TextField
            aria-label="搜索用户"
            placeholder="搜索姓名或邮箱"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button
            variant="quiet"
            loading={loading}
            onClick={() => {
              setError('')
              load().catch((e) => setError(message(e)))
            }}
          >
            <RefreshCw size={15} />
            刷新
          </Button>
        </Toolbar>
        <div className="fastui-table-scroll">
          <table className="fastui-table admin-table w-full" aria-label="用户列表">
            <thead>
              <tr>
                <th>用户</th>
                <th>角色</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users
                .filter((u) =>
                  `${u.email} ${u.name}`.toLowerCase().includes(query.trim().toLowerCase()),
                )
                .map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="admin-person">
                        <span className="admin-avatar" aria-hidden="true">
                          {(u.name || u.email).slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <strong>{u.name || u.email}</strong>
                          <span className="admin-email">{u.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="admin-role">{u.role === 'admin' ? '管理员' : '用户'}</span>
                    </td>
                    <td>
                      <span
                        className={`task-status ${u.status === 'active' ? 'completed' : 'cancelled'}`}
                      >
                        {u.status === 'active' ? '启用' : '停用'}
                      </span>
                    </td>
                    <td>
                      <Button
                        variant="quiet"
                        aria-label={`编辑 ${u.name || u.email}`}
                        onClick={() => {
                          setForm({ ...u, password: '', reason: '' })
                          setEditing(true)
                          setError('')
                          setDeleting(false)
                        }}
                      >
                        <Pencil size={14} />
                        编辑
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!loading &&
          !users.filter((u) =>
            `${u.email} ${u.name}`.toLowerCase().includes(query.trim().toLowerCase()),
          ).length && <EmptyState title={query ? '没有匹配的用户' : '暂无用户'} />}
      </Panel>
      <Dialog
        open={editing}
        onClose={() => {
          if (!busy) setEditing(false)
        }}
        label={form.id ? '编辑用户' : '创建用户'}
      >
        <header className="admin-dialog-heading">
          <h2>{form.id ? '编辑用户' : '创建用户'}</h2>
          <Button
            variant="icon"
            aria-label="关闭编辑"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            <X size={16} />
          </Button>
        </header>
        <ErrorMessage error={error} />
        <form
          className="admin-user-form grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save(deleting)
          }}
        >
          <label className="fastui-field">
            邮箱
            <TextField
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label className="fastui-field">
            姓名
            <TextField
              maxLength={120}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="fastui-field">
            {form.id ? '重置密码（留空保持）' : '初始密码'}
            <TextField
              type="password"
              autoComplete="new-password"
              required={!form.id}
              minLength={12}
              maxLength={256}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <label className="fastui-field">
            角色
            <Select
              aria-label="角色"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="user">用户</option>
              <option value="admin">管理员</option>
            </Select>
          </label>
          <label className="fastui-field">
            状态
            <Select
              aria-label="状态"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="active">启用</option>
              <option value="disabled">停用</option>
            </Select>
          </label>
          <label className="fastui-field">
            操作原因
            <TextField
              required
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </label>
          {deleting && (
            <p role="alert">删除后此用户将无法登录，现有会话会失效。确认删除 {form.email}？</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={busy} onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button type="submit" variant={deleting ? 'danger' : 'primary'} loading={busy}>
              {deleting ? '确认删除' : '保存'}
            </Button>
            {form.id && form.id !== profile.userId && (
              <Button type="button" disabled={busy} onClick={() => setDeleting(!deleting)}>
                {deleting ? '取消删除' : '删除用户'}
              </Button>
            )}
          </div>
        </form>
      </Dialog>
    </>
  )
}
