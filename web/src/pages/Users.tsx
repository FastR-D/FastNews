import { useEffect, useState } from 'react'
import { Button, Select, TextField, Toolbar } from '@fastrd/ui-react'
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
  const { profile, notify } = useApp()
  const [users, setUsers] = useState<User[]>([])
  const [form, setForm] = useState(blank)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const load = async () => setUsers(await api<User[]>('api/admin/users'))
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
      setForm(blank)
      setDeleting(false)
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
      <PageHeading title="用户管理" description="管理平台账号、登录凭据与管理员权限。" />
      <ErrorMessage error={error} />
      <Panel
        title="用户列表"
        action={
          <Button
            onClick={() => {
              setForm(blank)
              setDeleting(false)
            }}
          >
            创建用户
          </Button>
        }
      >
        <Toolbar label="用户筛选">
          <TextField
            aria-label="搜索用户"
            placeholder="搜索姓名或邮箱"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Toolbar>
        <div className="fastui-table-scroll">
          <table className="fastui-table w-full">
            <thead>
              <tr>
                <th>姓名</th>
                <th>邮箱</th>
                <th>角色</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users
                .filter((u) => `${u.email} ${u.name}`.toLowerCase().includes(query.toLowerCase()))
                .map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>{u.role === 'admin' ? '管理员' : '用户'}</td>
                    <td>{u.status === 'active' ? '启用' : '停用'}</td>
                    <td>
                      <Button
                        onClick={() => {
                          setForm({ ...u, password: '', reason: '' })
                          setDeleting(false)
                        }}
                      >
                        编辑
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title={form.id ? '编辑用户' : '创建用户'}>
        <form
          className="grid gap-4 p-4 sm:p-6"
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
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="user">用户</option>
              <option value="admin">管理员</option>
            </Select>
          </label>
          <label className="fastui-field">
            状态
            <Select
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
      </Panel>
    </>
  )
}
