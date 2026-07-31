'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { authenticatedFetch } from '@/lib/authenticated-fetch'
import { useAuth, type UserProfile } from './auth-context'

type GroupMember = { userId: string; userEmail: string }
type Group = { id: string; name: string; members: GroupMember[] }

export function AssignTest({ testId }: { testId: string }) {
  const { user, profile } = useAuth()
  const [email, setEmail] = useState('')
  const [matches, setMatches] = useState<UserProfile[]>([])
  const [accounts, setAccounts] = useState<UserProfile[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [groupId, setGroupId] = useState('')
  const [deadline, setDeadline] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState('')
  const organizationId = profile?.organizationId || ''
  const allowed = profile?.role === 'admin' || profile?.role === 'organisation' || profile?.membershipRole === 'teacher'
  const selectedTest = useMemo(() => testId, [testId])

  useEffect(() => {
    if (!user || !allowed || !organizationId) return
    authenticatedFetch(user, `/api/assignments?organizationId=${encodeURIComponent(organizationId)}`, { cache: 'no-store' })
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Unable to load assignment options.')
        setGroups(body.groups || [])
        setAccounts((body.users || []).filter((account: UserProfile) => account.membershipRole !== 'owner'))
      })
      .catch(reason => setMessage(`Could not load batches: ${reason instanceof Error ? reason.message : 'Unknown error'}`))
  }, [allowed, organizationId, user])

  function deadlineDate() {
    const value = new Date(deadline)
    if (!deadline || value <= new Date()) { setMessage('Choose a future deadline.'); return null }
    return value
  }
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = email.trim().toLowerCase()
    if (!value) return
    setMatches(accounts.filter(account => account.email.toLowerCase().includes(value)))
  }
  async function assign(targetType: 'group' | 'user', targetId: string, label: string) {
    const date = deadlineDate()
    if (!user || !date || !organizationId) return
    setSaving(targetId)
    try {
      const response = await authenticatedFetch(user, '/api/assignments', {
        method: 'POST',
        body: JSON.stringify({
          organizationId,
          name: `Assigned mock test · ${label}`,
          testId: selectedTest,
          targetType,
          targetId,
          startAt: new Date().toISOString(),
          deadline: date.toISOString(),
          maxAttempts: 1,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to assign this test.')
      setMessage(`Assigned to ${label}.`)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to assign this test.')
    } finally {
      setSaving('')
    }
  }
  async function assignGroup() {
    const group = groups.find(item => item.id === groupId)
    if (!group) { setMessage('Choose a batch.'); return }
    if (!group.members.length) { setMessage('This batch has no members.'); return }
    await assign('group', group.id, `${group.members.length} student${group.members.length === 1 ? '' : 's'} in ${group.name}`)
  }

  if (!allowed) return <section><h1 className="text-3xl font-black">Access denied</h1></section>
  if (!organizationId) return <section className="mx-auto max-w-3xl"><Link href="/manage/tests" className="text-sm font-bold text-indigo-600">← Manage tests</Link><h1 className="mt-5 text-4xl font-black">Assign mock test</h1><p className="mt-5 rounded-xl bg-amber-50 p-4 text-amber-800">Select an institute before assigning this test.</p></section>
  return <section className="mx-auto max-w-3xl"><Link href="/manage/tests" className="text-sm font-bold text-indigo-600">← Manage tests</Link><h1 className="mt-5 text-4xl font-black">Assign mock test</h1><p className="mt-2 text-slate-600">Choose a deadline, then assign this test to one student or an institute batch.</p><label className="mt-7 block max-w-sm text-sm font-bold">Deadline<input value={deadline} onChange={event => setDeadline(event.target.value)} type="datetime-local" required className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label><div className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-5"><h2 className="font-bold text-indigo-950">Assign to a batch</h2><p className="mt-1 text-sm text-indigo-800">Batches contain joined students from your institute.</p><div className="mt-4 flex flex-col gap-3 sm:flex-row"><select value={groupId} onChange={event => setGroupId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-indigo-200 bg-white px-3 py-2.5"><option value="">Select a batch</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name} ({group.members.length})</option>)}</select><button disabled={saving === groupId || !groups.length} onClick={() => void assignGroup()} className="rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white disabled:opacity-50">{saving === groupId ? 'Assigning…' : 'Assign batch'}</button></div>{groups.length === 0 && <p className="mt-3 text-sm text-indigo-800">Create a batch from Manage students first.</p>}</div>{message && <p className="mt-5 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-800">{message}</p>}<div className="mt-7 border-t border-slate-200 pt-6"><h2 className="text-lg font-bold">Assign one student</h2><form onSubmit={search} className="mt-3 flex flex-col gap-3 sm:flex-row"><input value={email} onChange={event => setEmail(event.target.value)} type="search" placeholder="Search student email" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3" /><button className="rounded-xl bg-slate-800 px-5 py-3 font-bold text-white">Search</button></form>{matches.map(account => <div key={account.uid} className="mt-4 flex flex-col items-stretch gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"><span className="min-w-0 break-all font-semibold sm:break-normal">{account.email}</span><button disabled={saving === account.uid} onClick={() => void assign('user', account.uid, account.email)} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{saving === account.uid ? 'Assigning…' : 'Assign'}</button></div>)}</div></section>
}
