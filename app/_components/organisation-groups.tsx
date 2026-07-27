'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from './auth-context'
import { SearchPicker } from './search-picker'
import { GroupDashboardModal } from './exam-dashboard'
import { paginate, Pagination } from './pagination'
import type { MockTest, Submission } from './test-types'

type Member = { userId: string; userEmail: string; status?: 'accepted' | 'pending' | 'declined' }
type Exam = { id: string; name: string }
type Group = { id: string; name: string; targetExamId?: string; targetExamName?: string; members: Member[] }

export function OrganisationGroups() {
  const { user, profile } = useAuth()
  const allowed = profile?.role === 'organisation'
  const [members, setMembers] = useState<Member[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [exams, setExams] = useState<Exam[]>([])
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [userNames, setUserNames] = useState<Record<string, string>>({})
  const [openedGroup, setOpenedGroup] = useState<Group | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [goalId, setGoalId] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null)
  const [page, setPage] = useState(1)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { if (!user || !allowed) return; return onSnapshot(query(collection(db, 'organisationInvites'), where('organisationId', '==', user.uid)), snapshot => setMembers(snapshot.docs.map(item => item.data() as Member).filter(item => item.status === 'accepted'))) }, [allowed, user])
  useEffect(() => { if (!user || !allowed) return; return onSnapshot(collection(db, 'examCatalog'), snapshot => setExams(snapshot.docs.map(item => ({ id: item.id, name: item.data().name as string })).filter(item => item.name).sort((a, b) => a.name.localeCompare(b.name)))) }, [allowed, user])
  useEffect(() => { if (!user || !allowed) return; return onSnapshot(query(collection(db, 'submissions'), where('organisationIds', 'array-contains', user.uid)), snapshot => setSubmissions(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as Submission))) }, [allowed, user])
  useEffect(() => { if (!user || !allowed) return; void getDocs(collection(db, 'users')).then(snapshot => setUserNames(Object.fromEntries(snapshot.docs.map(item => [item.id, (item.data().name as string | undefined)?.trim() || ''])))).catch(() => setUserNames({})) }, [allowed, user])
  useEffect(() => {
    if (!user || !allowed) return
    return onSnapshot(query(collection(db, 'organisationGroups'), where('organisationId', '==', user.uid)), async snapshot => {
      try {
        const loaded = await Promise.all(snapshot.docs.map(async item => ({ id: item.id, name: item.data().name as string, targetExamId: item.data().targetExamId as string | undefined, targetExamName: item.data().targetExamName as string | undefined, members: (await getDocs(collection(item.ref, 'members'))).docs.map(member => member.data() as Member) })))
        setGroups(loaded.sort((a, b) => a.name.localeCompare(b.name)))
      } catch { setMessage('Unable to load groups.') }
    })
  }, [allowed, user])

  const examMap = useMemo(() => new Map(exams.map(exam => [exam.id, exam])), [exams])
  const tests = useMemo(() => [...new Map(submissions.map(item => [item.testId, {
    id: item.testId,
    title: item.testTitle,
    exam: item.testExam,
    examId: item.testExamId,
    category: item.testCategory,
    description: '',
    durationMinutes: 0,
    createdBy: '',
    visibility: 'public' as const,
  } satisfies MockTest])).values()], [submissions])
  const selectedMembers = members.filter(member => selected.includes(member.userId))
  const resetForm = () => { setEditingId(null); setName(''); setGoalId(''); setSelected([]); setFormOpen(false) }
  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  const beginEdit = (group: Group) => { setEditingId(group.id); setName(group.name); setGoalId(group.targetExamId || ''); setSelected(group.members.map(member => member.userId)); setFormOpen(true); setMessage('') }

  async function saveGroup(event: FormEvent) {
    event.preventDefault()
    if (!user || !name.trim() || (!editingId && !selected.length)) { setMessage(editingId ? 'Enter a group name.' : 'Enter a group name and choose at least one joined user.'); return }
    setSaving(true); setMessage('')
    try {
      const exam = examMap.get(goalId)
      if (!editingId) {
        const ref = doc(collection(db, 'organisationGroups'))
        await setDoc(ref, { organisationId: user.uid, name: name.trim(), targetExamId: exam?.id || null, targetExamName: exam?.name || null, createdBy: user.uid, createdAt: serverTimestamp() })
        const batch = writeBatch(db)
        members.filter(member => selected.includes(member.userId)).forEach(member => batch.set(doc(ref, 'members', member.userId), { userId: member.userId, userEmail: member.userEmail, addedAt: serverTimestamp() }))
        await batch.commit(); setMessage('Group created.')
      } else {
        const group = groups.find(item => item.id === editingId)
        if (!group) throw new Error('That group is no longer available.')
        const ref = doc(db, 'organisationGroups', editingId)
        await updateDoc(ref, { name: name.trim(), targetExamId: exam?.id || null, targetExamName: exam?.name || null, updatedAt: serverTimestamp() })
        const existing = new Set(group.members.map(member => member.userId)); const batch = writeBatch(db)
        group.members.filter(member => !selected.includes(member.userId)).forEach(member => batch.delete(doc(ref, 'members', member.userId)))
        members.filter(member => selected.includes(member.userId) && !existing.has(member.userId)).forEach(member => batch.set(doc(ref, 'members', member.userId), { userId: member.userId, userEmail: member.userEmail, addedAt: serverTimestamp() }))
        await batch.commit(); setMessage('Group updated.')
      }
      resetForm()
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to save group.') } finally { setSaving(false) }
  }
  async function deleteGroup() {
    if (!deleteTarget || deleteConfirmation !== deleteTarget.name) return
    setDeleting(true); setMessage('')
    try {
      const ref = doc(db, 'organisationGroups', deleteTarget.id)
      const batch = writeBatch(db)
      const memberSnapshot = await getDocs(collection(ref, 'members'))
      memberSnapshot.docs.forEach(member => batch.delete(member.ref))
      batch.delete(ref)
      await batch.commit()
      const deletedName = deleteTarget.name
      setDeleteTarget(null); setDeleteConfirmation(''); resetForm(); setMessage(`Group “${deletedName}” deleted.`)
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to delete group.') } finally { setDeleting(false) }
  }
  const visibleGroups = paginate(groups, page)
  if (!allowed) return <section><h1 className="text-3xl font-black">Access denied</h1><p className="mt-3 text-slate-600">Only institute accounts can manage groups.</p></section>
  return <section className="mx-auto max-w-6xl"><p className="text-sm font-bold tracking-widest text-indigo-600">INSTITUTE</p><h1 className="mt-1 text-4xl font-black">User groups</h1><p className="mt-3 text-slate-600">Create reusable groups and set an exam goal to measure their progress.</p>
    {!formOpen && <CreateGroupHeader open={() => setFormOpen(true)} />}
    {formOpen && <form onSubmit={saveGroup} className="relative mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/70 sm:p-7"><div className="relative flex items-center gap-4 border-b border-slate-200 pb-6"><span className="grid h-14 w-14 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><GroupIcon className="h-7 w-7" /></span><div><h2 className="text-2xl font-black">{editingId ? 'Edit group' : 'Create group'}</h2><p className="mt-1 text-sm text-slate-600">Build a reusable group of joined users</p></div><button disabled={saving || (!editingId && !members.length)} className="ml-auto rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : editingId ? 'Save changes' : 'Create group'}</button></div><div className="mt-7 grid gap-5 md:grid-cols-2"><FormLabel label="Group name"><input value={name} onChange={event => setName(event.target.value)} required placeholder="e.g. July batch" className="group-input" /></FormLabel><FormLabel label="Exam goal"><SearchPicker value={goalId} options={[{ id: '', label: 'No exam goal' }, ...exams.map(exam => ({ id: exam.id, label: exam.name }))]} onChange={option => setGoalId(option.id)} placeholder="Search exams" /></FormLabel></div><div className="mt-6"><FormLabel label="Group users"><SearchPicker value="" options={members.map(member => ({ id: member.userId, label: userNames[member.userId] || member.userEmail, detail: userNames[member.userId] ? member.userEmail : undefined })).sort((a, b) => a.label.localeCompare(b.label))} onChange={option => toggle(option.id)} placeholder="Search users by name or email" /></FormLabel><div className="mt-3 max-h-64 divide-y overflow-auto rounded-xl border border-slate-200">{selectedMembers.map(member => <div key={member.userId} className="flex items-center justify-between gap-3 px-4 py-3"><div><p className="font-semibold">{userNames[member.userId] || member.userEmail}</p><p className="mt-1 text-xs text-slate-500">{member.userEmail}</p></div><button type="button" onClick={() => toggle(member.userId)} className="text-sm font-bold text-rose-600">Remove</button></div>)}{!selectedMembers.length && <p className="p-4 text-sm text-slate-500">Search above to add joined users to this group.</p>}</div></div><div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-200 pt-5">{editingId ? <button type="button" onClick={() => { const group = groups.find(item => item.id === editingId); if (group) { setDeleteTarget(group); setDeleteConfirmation('') } }} className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-3 text-sm font-bold text-rose-700 hover:bg-rose-100">Delete group</button> : <span />}<button type="button" onClick={resetForm} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700">Cancel</button></div></form>}
    {message && <p className="mt-5 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-800">{message}</p>}<section className="mt-8"><h2 className="text-2xl font-black">Your groups</h2><p className="mt-1 text-sm text-slate-500">Open a group dashboard to review only that group&apos;s progress.</p><div className="mt-5 space-y-4">{visibleGroups.items.map(group => <GroupCard key={group.id} group={group} open={() => setOpenedGroup(group)} />)}{!groups.length && <p className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-500">No groups created yet.</p>}<Pagination page={visibleGroups.page} totalItems={groups.length} onPageChange={setPage} itemLabel="groups" className="rounded-xl border border-slate-200 bg-white" /></div></section>{openedGroup && <GroupDashboardModal group={{ ...openedGroup, members: openedGroup.members.map(member => ({ ...member, userName: userNames[member.userId] })) }} submissions={submissions} tests={tests} edit={() => { beginEdit(openedGroup); setOpenedGroup(null) }} close={() => setOpenedGroup(null)} />}{deleteTarget && <DeleteGroupDialog group={deleteTarget} confirmation={deleteConfirmation} setConfirmation={setDeleteConfirmation} deleting={deleting} confirm={() => void deleteGroup()} close={() => { if (!deleting) { setDeleteTarget(null); setDeleteConfirmation('') } }} />}</section>
}

function DeleteGroupDialog({ group, confirmation, setConfirmation, deleting, confirm, close }: { group: Group; confirmation: string; setConfirmation: (value: string) => void; deleting: boolean; confirm: () => void; close: () => void }) {
  const matches = confirmation === group.name
  return <div role="dialog" aria-modal="true" aria-labelledby="delete-group-title" className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/50 p-4" onMouseDown={close}>
    <form onSubmit={event => { event.preventDefault(); if (matches && !deleting) confirm() }} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onMouseDown={event => event.stopPropagation()}>
      <span className="grid h-12 w-12 place-items-center rounded-full bg-rose-100 text-rose-700"><TrashIcon /></span>
      <h2 id="delete-group-title" className="mt-5 text-2xl font-black text-slate-950">Delete group?</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">This permanently deletes the group and its member list. Type <strong className="text-slate-900">{group.name}</strong> to confirm.</p>
      <label className="mt-5 block text-sm font-bold text-slate-800">Group name<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" placeholder={group.name} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100" /></label>
      {confirmation && !matches && <p className="mt-2 text-sm font-medium text-rose-600">The group name does not match.</p>}
      <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-5"><button type="button" disabled={deleting} onClick={close} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 disabled:opacity-50">Cancel</button><button disabled={!matches || deleting} className="rounded-xl bg-rose-600 px-5 py-3 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40">{deleting ? 'Deleting…' : 'Delete group'}</button></div>
    </form>
  </div>
}

function GroupCard({ group, open }: { group: Group; open: () => void }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60 sm:p-6">
    <div className="grid gap-5 lg:grid-cols-[minmax(15rem,1.25fr)_minmax(13rem,1fr)_minmax(15rem,1.15fr)_auto] lg:items-center lg:gap-0">
      <div className="min-w-0 lg:pr-6">
        <p className="truncate text-lg font-black text-slate-900">{group.name}</p>
        <p className="mt-1 text-sm text-slate-500">Institute group</p>
      </div>
      <div className="flex min-w-0 items-center gap-3 border-t border-slate-100 pt-5 lg:border-l lg:border-t-0 lg:px-6 lg:py-0">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-indigo-100 bg-indigo-50 text-indigo-600"><GroupIcon className="h-6 w-6" /></span>
        <div className="min-w-0"><p className="font-bold text-slate-900">{group.members.length}</p><p className="mt-1 text-sm text-slate-500">Member{group.members.length === 1 ? '' : 's'}</p></div>
      </div>
      <div className="flex min-w-0 items-center gap-3 border-t border-slate-100 pt-5 lg:border-l lg:border-t-0 lg:px-6 lg:py-0">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-violet-100 bg-violet-50 text-violet-600"><ExamGoalIcon /></span>
        <div className="min-w-0"><p className="text-sm text-slate-500">Exam goal</p><p className="mt-1 truncate font-bold text-slate-900">{group.targetExamName || 'Not set'}</p></div>
      </div>
      <div className="border-t border-slate-100 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <button type="button" onClick={open} aria-label={`Open dashboard for ${group.name}`} title="Group dashboard" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"><InfoIcon /></button>
      </div>
    </div>
  </article>
}

function CreateGroupHeader({ open }: { open: () => void }) { return <div className="mt-7 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/70"><div className="flex items-center gap-4"><span className="grid h-14 w-14 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><GroupIcon className="h-7 w-7" /></span><div><h2 className="text-2xl font-black">Create group</h2><p className="mt-1 text-sm text-slate-600">Build a reusable group of joined users</p></div><button type="button" onClick={open} className="ml-auto rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white">Create group</button></div></div> }
function FormLabel({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-bold text-slate-800"><span className="mb-2 block">{label}</span>{children}</label> }
function GroupIcon({ className }: { className: string }) { return <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5a3 3 0 0 1 0 6M21 20v-1a6 6 0 0 0-3.5-5.5" /></svg> }
function ExamGoalIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-5 9 5-9 5-9-5Z" /><path d="M7 12v5c3 2 7 2 10 0v-5M21 9v6" /></svg> }
function InfoIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg> }
function TrashIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg> }
