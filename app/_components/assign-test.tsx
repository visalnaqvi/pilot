'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { Timestamp, collection, doc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth, type UserProfile } from './auth-context'

type GroupMember = { userId: string; userEmail: string }
type Group = { id: string; name: string; members: GroupMember[] }

export function AssignTest({ testId }: { testId: string }) {
  const { user, profile } = useAuth()
  const [email, setEmail] = useState('')
  const [matches, setMatches] = useState<UserProfile[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [groupId, setGroupId] = useState('')
  const [deadline, setDeadline] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState('')
  const allowed = profile?.role === 'admin' || profile?.role === 'organisation'

  useEffect(() => {
    if (!user || profile?.role !== 'organisation') return
    let active = true
    getDocs(query(collection(db, 'organisationGroups'), where('organisationId', '==', user.uid))).then(async (snapshot) => {
      const loaded = await Promise.all(snapshot.docs.map(async (item) => ({ id: item.id, name: item.data().name as string, members: (await getDocs(collection(item.ref, 'members'))).docs.map((member) => member.data() as GroupMember) })))
      if (active) setGroups(loaded.sort((a, b) => a.name.localeCompare(b.name)))
    }).catch((reason) => { if (active) setMessage(`Could not load groups: ${reason.message}`) })
    return () => { active = false }
  }, [profile?.role, user])

  function deadlineDate() {
    const value = new Date(deadline)
    if (!deadline || value <= new Date()) { setMessage('Choose a future deadline.'); return null }
    return value
  }
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = email.trim().toLowerCase()
    if (!value) return
    try {
      const snapshot = await getDocs(query(collection(db, 'users'), where('email', '>=', value), where('email', '<=', `${value}\uf8ff`)))
      setMatches(snapshot.docs.map((item) => item.data() as UserProfile).filter((account) => account.role === 'user'))
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to search users.') }
  }
  async function assign(account: UserProfile) {
    const date = deadlineDate()
    if (!user || !date) return
    setSaving(account.uid)
    try {
      await setDoc(doc(db, 'testAssignments', `${testId}_${account.uid}`), { testId, userId: account.uid, userEmail: account.email, assignedBy: user.uid, deadline: Timestamp.fromDate(date), createdAt: serverTimestamp() })
      setMessage(`Assigned to ${account.email}.`)
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to assign this test.') } finally { setSaving('') }
  }
  async function assignGroup() {
    const date = deadlineDate()
    const group = groups.find((item) => item.id === groupId)
    if (!user || !date || !group) { if (!group) setMessage('Choose a group.'); return }
    if (group.members.length === 0) { setMessage('This group has no members.'); return }
    setSaving('group')
    try {
      for (let index = 0; index < group.members.length; index += 450) {
        const batch = writeBatch(db)
        group.members.slice(index, index + 450).forEach((member) => batch.set(doc(db, 'testAssignments', `${testId}_${member.userId}`), { testId, userId: member.userId, userEmail: member.userEmail, assignedBy: user.uid, deadline: Timestamp.fromDate(date), createdAt: serverTimestamp() }))
        await batch.commit()
      }
      setMessage(`Assigned to ${group.members.length} user${group.members.length === 1 ? '' : 's'} in ${group.name}.`)
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to assign this group.') } finally { setSaving('') }
  }

  if (!allowed) return <section><h1 className="text-3xl font-black">Access denied</h1></section>
  return <section className="mx-auto max-w-3xl"><Link href="/manage/tests" className="text-sm font-bold text-indigo-600">← Manage tests</Link><h1 className="mt-5 text-4xl font-black">Assign mock test</h1><p className="mt-2 text-slate-600">Choose a deadline, then assign this test to one user or an institute group.</p><label className="mt-7 block max-w-sm text-sm font-bold">Deadline<input value={deadline} onChange={(event) => setDeadline(event.target.value)} type="datetime-local" required className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label>{profile?.role === 'organisation' && <div className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-5"><h2 className="font-bold text-indigo-950">Assign to a group</h2><p className="mt-1 text-sm text-indigo-800">Groups contain joined users from your institute.</p><div className="mt-4 flex flex-col gap-3 sm:flex-row"><select value={groupId} onChange={(event) => setGroupId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-indigo-200 bg-white px-3 py-2.5"><option value="">Select a group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name} ({group.members.length})</option>)}</select><button disabled={saving === 'group' || groups.length === 0} onClick={assignGroup} className="rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white disabled:opacity-50">{saving === 'group' ? 'Assigning…' : 'Assign group'}</button></div>{groups.length === 0 && <p className="mt-3 text-sm text-indigo-800">Create a group from Manage users first.</p>}</div>}{message && <p className="mt-5 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-800">{message}</p>}<div className="mt-7 border-t border-slate-200 pt-6"><h2 className="text-lg font-bold">Assign one user</h2><form onSubmit={search} className="mt-3 flex flex-col gap-3 sm:flex-row"><input value={email} onChange={(event) => setEmail(event.target.value)} type="search" placeholder="Search user email" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3" /><button className="rounded-xl bg-slate-800 px-5 py-3 font-bold text-white">Search</button></form>{matches.map((account) => <div key={account.uid} className="mt-4 flex flex-col items-stretch gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"><span className="min-w-0 break-all font-semibold sm:break-normal">{account.email}</span><button disabled={saving === account.uid} onClick={() => assign(account)} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{saving === account.uid ? 'Assigning…' : 'Assign'}</button></div>)}</div></section>
}
