'use client'

import { useEffect, useState } from 'react'
import { authenticatedFetch } from '@/lib/authenticated-fetch'
import { useAuth, type UserProfile } from './auth-context'
import { paginate, Pagination } from './pagination'

export function AdminUsers() {
  const { user, profile } = useAuth()
  const [users, setUsers] = useState<UserProfile[]>([])
  const [message, setMessage] = useState('')
  const [updating, setUpdating] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (!user || profile?.role !== 'admin') return
    authenticatedFetch(user, '/api/users', { cache: 'no-store' })
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Unable to load accounts.')
        setUsers(body.items || [])
      })
      .catch(reason => setMessage(`Could not load students: ${reason instanceof Error ? reason.message : 'Unknown error'}`))
  }, [profile?.role, user])

  async function changeRole(account: UserProfile, role: 'user' | 'organisation') {
    if (!user) return
    setUpdating(account.uid)
    try {
      const response = await authenticatedFetch(user, '/api/users', {
        method: 'PATCH',
        body: JSON.stringify({ userId: account.uid, role }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to update this role.')
      setUsers(current => current.map(item => item.uid === account.uid ? { ...item, role } : item))
      setMessage(`${account.email || account.uid} is now ${role === 'organisation' ? 'an institute' : 'a student'} account.`)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to update this role.')
    } finally {
      setUpdating('')
    }
  }

  const visibleUsers = paginate(users, page)
  if (profile?.role !== 'admin') return <section><h1 className="text-3xl font-black">Access denied</h1><p className="mt-3 text-slate-600">Only admins can manage student roles.</p></section>
  return <section className="mx-auto max-w-4xl"><p className="text-sm font-bold tracking-widest text-indigo-600">ADMINISTRATION</p><h1 className="mt-1 text-4xl font-black">Manage access</h1><p className="mt-3 text-slate-600">Promote registered students to institute accounts so they can create mock tests. Admin accounts are deliberately managed only in Firebase.</p>{message && <p className="mt-5 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-800">{message}</p>}<div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-bold tracking-wide text-slate-500"><span>ACCOUNT</span><span>ROLE</span></div>{visibleUsers.items.map(account => <div key={account.uid} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-slate-100 px-5 py-4 last:border-0"><div><p className="truncate font-semibold">{account.email || account.uid}</p><p className="mt-1 text-xs text-slate-500">{account.uid}</p></div>{account.role === 'admin' ? <span className="rounded-full bg-violet-100 px-3 py-1.5 text-sm font-bold text-violet-700">Admin</span> : <select value={account.role} disabled={updating === account.uid} onChange={event => void changeRole(account, event.target.value as 'user' | 'organisation')} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold capitalize outline-none focus:border-indigo-500 disabled:opacity-50"><option value="user">Student</option><option value="organisation">Institute</option></select>}</div>)}{users.length === 0 && <p className="p-6 text-slate-500">No registered students found.</p>}<Pagination page={visibleUsers.page} totalItems={users.length} onPageChange={setPage} itemLabel="students" /></div></section>
}
