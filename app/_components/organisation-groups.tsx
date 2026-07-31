'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { authenticatedFetch } from '@/lib/authenticated-fetch'
import { useAuth } from './auth-context'
import { ExamResolver } from './exam-resolver'
import { SearchPicker } from './search-picker'
import { GroupDashboardModal } from './exam-dashboard'
import { paginate, Pagination } from './pagination'
import type { MockTest, Submission } from './test-types'
import type { ExamCatalogEntry, ExamSelectionStatus } from '@/lib/exam-catalog'
import type { OrganizationMembershipRole } from '@/lib/membership'

type Member = { userId: string; userEmail: string; status?: 'accepted' | 'pending' | 'declined'; memberRole?: OrganizationMembershipRole }
type Exam = ExamCatalogEntry
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
  const [addingExam, setAddingExam] = useState(false)
  const [newExamName, setNewExamName] = useState('')
  const [resolvingExam, setResolvingExam] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null)
  const [page, setPage] = useState(1)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const organizationId = profile?.organizationId
    if (!user || !allowed || !organizationId) return
    let active = true
    void Promise.all([
      authenticatedFetch(user, `/api/memberships?organizationId=${organizationId}`, { cache: 'no-store' }),
      authenticatedFetch(user, '/api/exams?scope=catalog', { cache: 'no-store' }),
      authenticatedFetch(user, '/api/test-submissions', { cache: 'no-store' }),
      authenticatedFetch(user, `/api/groups?organizationId=${organizationId}`, { cache: 'no-store' }),
    ]).then(async responses => {
      const payloads = await Promise.all(responses.map(response => response.json()))
      const failed = responses.findIndex(response => !response.ok)
      if (failed >= 0) throw new Error(payloads[failed].error || 'Unable to load batches.')
      if (!active) return
      const memberItems = (payloads[0].items || []) as { userId: string; email: string; name?: string; status: string; role: OrganizationMembershipRole }[]
      setMembers(memberItems.filter(item => item.userId !== user.uid && item.status === 'accepted' && item.role === 'student').map(item => ({
        userId: item.userId,
        userEmail: item.email,
        status: 'accepted',
        memberRole: item.role,
      })))
      setUserNames(Object.fromEntries(memberItems.map(item => [item.userId, item.name?.trim() || ''])))
      setExams((payloads[1].items || []) as Exam[])
      setSubmissions(((payloads[2].items || []) as Submission[]).map(item => typeof item.submittedAt === 'string'
        ? { ...item, submittedAt: { toDate: () => new Date(item.submittedAt as string) } }
        : item))
      setGroups(((payloads[3].items || []) as Group[]).sort((a, b) => a.name.localeCompare(b.name)))
    }).catch(reason => {
      if (active) setMessage(reason instanceof Error ? reason.message : 'Unable to load batches.')
    })
    return () => { active = false }
  }, [allowed, profile?.organizationId, user])

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
  const resetForm = () => { setEditingId(null); setName(''); setGoalId(''); setAddingExam(false); setNewExamName(''); setSelected([]); setFormOpen(false) }
  const beginEdit = (group: Group) => { setEditingId(group.id); setName(group.name); setGoalId(group.targetExamId || ''); setAddingExam(false); setNewExamName(''); setSelected(group.members.map(member => member.userId)); setFormOpen(true); setMessage('') }

  function applyResolvedExam(exam: ExamCatalogEntry, status: ExamSelectionStatus) {
    setExams(current => current.some(item => item.id === exam.id) ? current : [...current, exam])
    setGoalId(exam.id)
    setAddingExam(false)
    setMessage(status === 'created' ? `Created and selected ${exam.name}.` : `Selected ${exam.name}.`)
  }

  async function selectCatalogExam(examId: string) {
    if (!user) return
    if (!examId) {
      setGoalId('')
      setAddingExam(false)
      return
    }
    const exam = exams.find(item => item.id === examId)
    if (!exam) return
    setResolvingExam(true)
    setMessage('')
    try {
      const response = await authenticatedFetch(user, '/api/exams/resolve', {
        method: 'POST',
        body: JSON.stringify({ selectionId: exam.id }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to select this exam.')
      applyResolvedExam(body.exam as ExamCatalogEntry, 'selected')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to select this exam.')
    } finally {
      setResolvingExam(false)
    }
  }

  async function saveGroup(event: FormEvent) {
    event.preventDefault()
    if (!user || !name.trim() || (!editingId && !selected.length)) { setMessage(editingId ? 'Enter a batch name.' : 'Enter a batch name and choose at least one joined student.'); return }
    setSaving(true); setMessage('')
    try {
      const organizationId = profile?.organizationId
      if (!organizationId) throw new Error('Institute profile unavailable.')
      const response = await authenticatedFetch(user, '/api/groups', {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          id: editingId || undefined,
          organizationId,
          name: name.trim(),
          targetExamId: examMap.get(goalId)?.id || null,
          memberIds: selected,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to save batch.')
      const refreshed = await authenticatedFetch(user, `/api/groups?organizationId=${organizationId}`, { cache: 'no-store' })
      setGroups(((await refreshed.json()).items || []).sort((a: Group, b: Group) => a.name.localeCompare(b.name)))
      setMessage(editingId ? 'Batch updated.' : 'Batch created.')
      resetForm()
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to save batch.') } finally { setSaving(false) }
  }
  async function deleteGroup() {
    if (!deleteTarget || deleteConfirmation !== deleteTarget.name) return
    setDeleting(true); setMessage('')
    try {
      const response = await authenticatedFetch(user!, `/api/groups?id=${deleteTarget.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to delete batch.')
      const deletedName = deleteTarget.name
      setGroups(current => current.filter(group => group.id !== deleteTarget.id))
      setDeleteTarget(null); setDeleteConfirmation(''); resetForm(); setMessage(`Batch “${deletedName}” deleted.`)
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to delete batch.') } finally { setDeleting(false) }
  }
  const visibleGroups = paginate(groups, page)
  if (!allowed) return <section><h1 className="text-3xl font-black">Access denied</h1><p className="mt-3 text-slate-600">Only institute accounts can manage batches.</p></section>
  return <section className="mx-auto max-w-6xl"><p className="text-sm font-bold tracking-widest text-indigo-600">INSTITUTE</p><h1 className="mt-1 text-4xl font-black">Student batches</h1><p className="mt-3 text-slate-600">Create reusable batches and set an exam goal to measure their progress.</p>
    {!formOpen && <CreateGroupHeader open={() => setFormOpen(true)} />}
    {formOpen && <form onSubmit={saveGroup} className="relative mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/70 sm:p-7"><div className="relative flex items-center gap-4 border-b border-slate-200 pb-6"><span className="grid h-14 w-14 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><GroupIcon className="h-7 w-7" /></span><div><h2 className="text-2xl font-black">{editingId ? 'Edit batch' : 'Create batch'}</h2><p className="mt-1 text-sm text-slate-600">Build a reusable batch of joined students</p></div><button disabled={saving || (!editingId && !members.length)} className="ml-auto rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : editingId ? 'Save changes' : 'Create batch'}</button></div><div className="mt-7 grid gap-5 md:grid-cols-2"><FormLabel label="Batch name"><input value={name} onChange={event => setName(event.target.value)} required placeholder="e.g. July batch" className="group-input" /></FormLabel><div><FormLabel label="Exam goal"><SearchPicker value={goalId} options={[{ id: '', label: 'No exam goal' }, ...exams.map(exam => ({ id: exam.id, label: exam.name, detail: [...new Set([exam.primaryAlias, ...exam.aliases])].filter(alias => alias && alias !== exam.name).join(', ') || undefined }))]} onChange={option => void selectCatalogExam(option.id)} onCreate={query => { setNewExamName(query); setAddingExam(true) }} createLabel="Create exam" placeholder="Search the exam catalog" disabled={resolvingExam} /></FormLabel>{addingExam && <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-slate-900">Create a new exam</p><p className="mt-1 text-xs text-slate-500">Catalog matches are checked before a new exam can be created.</p></div><button type="button" onClick={() => setAddingExam(false)} className="text-sm font-bold text-indigo-700">Cancel</button></div><ExamResolver key={newExamName} initialName={newExamName} autoFocus autoResolveInitialName onResolved={applyResolvedExam} /></div>}</div></div><StudentSelector members={members} userNames={userNames} selected={selected} onChange={setSelected} /><div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-200 pt-5">{editingId ? <button type="button" onClick={() => { const group = groups.find(item => item.id === editingId); if (group) { setDeleteTarget(group); setDeleteConfirmation('') } }} className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-3 text-sm font-bold text-rose-700 hover:bg-rose-100">Delete batch</button> : <span />}<button type="button" onClick={resetForm} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700">Cancel</button></div></form>}
    {message && <p className="mt-5 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-800">{message}</p>}<section className="mt-8"><h2 className="text-2xl font-black">Your batches</h2><p className="mt-1 text-sm text-slate-500">Open a batch dashboard to review only that batch&apos;s progress.</p><div className="mt-5 space-y-4">{visibleGroups.items.map(group => <GroupCard key={group.id} group={group} open={() => setOpenedGroup(group)} />)}{!groups.length && <p className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-500">No batches created yet.</p>}<Pagination page={visibleGroups.page} totalItems={groups.length} onPageChange={setPage} itemLabel="batches" className="rounded-xl border border-slate-200 bg-white" /></div></section>{openedGroup && <GroupDashboardModal group={{ ...openedGroup, members: openedGroup.members.map(member => ({ ...member, userName: userNames[member.userId] })) }} submissions={submissions} tests={tests} edit={() => { beginEdit(openedGroup); setOpenedGroup(null) }} close={() => setOpenedGroup(null)} />}{deleteTarget && <DeleteGroupDialog group={deleteTarget} confirmation={deleteConfirmation} setConfirmation={setDeleteConfirmation} deleting={deleting} confirm={() => void deleteGroup()} close={() => { if (!deleting) { setDeleteTarget(null); setDeleteConfirmation('') } }} />}</section>
}

function StudentSelector({
  members,
  userNames,
  selected,
  onChange,
}: {
  members: Member[]
  userNames: Record<string, string>
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const selectedIds = useMemo(() => new Set(selected), [selected])
  const normalizedQuery = query.trim().toLowerCase()
  const students = useMemo(() => members
    .map(member => ({
      ...member,
      name: userNames[member.userId] || member.userEmail,
    }))
    .filter(member => `${member.name} ${member.userEmail}`.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => {
      if (!normalizedQuery) {
        const selectionOrder = Number(selectedIds.has(b.userId)) - Number(selectedIds.has(a.userId))
        if (selectionOrder) return selectionOrder
      }
      return a.name.localeCompare(b.name)
    }), [members, normalizedQuery, selectedIds, userNames])
  const visibleIds = students.map(student => student.userId)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id))

  function toggle(id: string) {
    onChange(selectedIds.has(id) ? selected.filter(item => item !== id) : [...selected, id])
  }

  function toggleVisible() {
    if (allVisibleSelected) {
      const visible = new Set(visibleIds)
      onChange(selected.filter(id => !visible.has(id)))
      return
    }
    onChange([...new Set([...selected, ...visibleIds])])
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <p className="text-sm font-bold text-slate-800">Batch students</p>
          <p className="mt-0.5 text-xs text-slate-500">Search the joined-student roster and select everyone who belongs in this batch.</p>
        </div>
        <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-black text-indigo-700">{selected.length} selected</span>
      </div>
      <div className="flex flex-col gap-3 border-b border-slate-200 p-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search by student name or email"
          aria-label="Search joined students"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
        <div className="flex shrink-0 gap-2">
          <button type="button" disabled={!visibleIds.length} onClick={toggleVisible} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 disabled:opacity-40">
            {allVisibleSelected ? 'Unselect results' : normalizedQuery ? 'Select results' : 'Select all'}
          </button>
          <button type="button" disabled={!selected.length} onClick={() => onChange([])} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-40">
            Clear
          </button>
        </div>
      </div>
      <div className="max-h-72 overflow-auto p-2">
        {students.map(student => {
          const checked = selectedIds.has(student.userId)
          const displayName = userNames[student.userId] || student.userEmail
          const initial = displayName.trim().charAt(0).toUpperCase() || '?'
          return (
            <label key={student.userId} className={`mb-1 flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors last:mb-0 ${checked ? 'border-indigo-200 bg-indigo-50' : 'border-transparent bg-white hover:border-slate-200'}`}>
              <input type="checkbox" checked={checked} onChange={() => toggle(student.userId)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black ${checked ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{initial}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-900">{displayName}</span>
                {displayName !== student.userEmail && <span className="mt-0.5 block truncate text-xs text-slate-500">{student.userEmail}</span>}
              </span>
              {checked && <span className="text-xs font-bold text-indigo-700">Selected</span>}
            </label>
          )
        })}
        {!students.length && <div className="px-4 py-8 text-center"><p className="text-sm font-semibold text-slate-700">{members.length ? 'No students match this search.' : 'No joined students available.'}</p><p className="mt-1 text-xs text-slate-500">{members.length ? 'Try a different name or email.' : 'Students will appear here after joining the institute.'}</p></div>}
      </div>
    </div>
  )
}

function DeleteGroupDialog({ group, confirmation, setConfirmation, deleting, confirm, close }: { group: Group; confirmation: string; setConfirmation: (value: string) => void; deleting: boolean; confirm: () => void; close: () => void }) {
  const matches = confirmation === group.name
  return <div role="dialog" aria-modal="true" aria-labelledby="delete-group-title" className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/50 p-4" onMouseDown={close}>
    <form onSubmit={event => { event.preventDefault(); if (matches && !deleting) confirm() }} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onMouseDown={event => event.stopPropagation()}>
      <span className="grid h-12 w-12 place-items-center rounded-full bg-rose-100 text-rose-700"><TrashIcon /></span>
      <h2 id="delete-group-title" className="mt-5 text-2xl font-black text-slate-950">Delete batch?</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">This permanently deletes the batch and its member list. Type <strong className="text-slate-900">{group.name}</strong> to confirm.</p>
      <label className="mt-5 block text-sm font-bold text-slate-800">Batch name<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" placeholder={group.name} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100" /></label>
      {confirmation && !matches && <p className="mt-2 text-sm font-medium text-rose-600">The batch name does not match.</p>}
      <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-5"><button type="button" disabled={deleting} onClick={close} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 disabled:opacity-50">Cancel</button><button disabled={!matches || deleting} className="rounded-xl bg-rose-600 px-5 py-3 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40">{deleting ? 'Deleting…' : 'Delete batch'}</button></div>
    </form>
  </div>
}

function GroupCard({ group, open }: { group: Group; open: () => void }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60 sm:p-6">
    <div className="grid gap-5 lg:grid-cols-[minmax(15rem,1.25fr)_minmax(13rem,1fr)_minmax(15rem,1.15fr)_auto] lg:items-center lg:gap-0">
      <div className="min-w-0 lg:pr-6">
        <p className="truncate text-lg font-black text-slate-900">{group.name}</p>
        <p className="mt-1 text-sm text-slate-500">Institute batch</p>
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
        <button type="button" onClick={open} aria-label={`Open dashboard for ${group.name}`} title="Batch dashboard" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"><InfoIcon /></button>
      </div>
    </div>
  </article>
}

function CreateGroupHeader({ open }: { open: () => void }) { return <div className="mt-7 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/70"><div className="flex items-center gap-4"><span className="grid h-14 w-14 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><GroupIcon className="h-7 w-7" /></span><div><h2 className="text-2xl font-black">Create batch</h2><p className="mt-1 text-sm text-slate-600">Build a reusable batch of joined students</p></div><button type="button" onClick={open} className="ml-auto rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white">Create batch</button></div></div> }
function FormLabel({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-bold text-slate-800"><span className="mb-2 block">{label}</span>{children}</label> }
function GroupIcon({ className }: { className: string }) { return <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5a3 3 0 0 1 0 6M21 20v-1a6 6 0 0 0-3.5-5.5" /></svg> }
function ExamGoalIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-5 9 5-9 5-9-5Z" /><path d="M7 12v5c3 2 7 2 10 0v-5M21 9v6" /></svg> }
function InfoIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg> }
function TrashIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg> }
