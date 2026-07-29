'use client'

import { type FormEvent, useEffect, useMemo, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  daysForTimetableEntry,
  timetableEntryOverlaps,
  timetableWeekdayOrder,
  timetableWeekdays,
  type TimetableEntry,
  type TimetableInput,
} from '@/lib/timetable'
import { useAuth } from './auth-context'
import { TimetableEditor as InteractiveTimetableEditor } from './timetable-editor'

type DateValue = { toDate: () => Date }
type Member = { userId: string; userName?: string; userEmail: string; status?: string }
type DirectoryUser = { name?: string; email?: string; role?: string }
type Group = { id: string; name: string; members: Member[] }
type DraftTimetable = TimetableInput & {
  id: string
  organisationId: string
  organisationName: string
  timeZone: string
  publishedRevision?: number
  updatedAt?: DateValue
}
export type PublishedTimetable = TimetableInput & {
  id: string
  organisationId: string
  organisationName: string
  timeZone: string
  status: 'active' | 'archived'
  revision: number
  assignedUserIds: string[]
  audienceNames?: string[]
  publishedAt?: DateValue
  archivedAt?: DateValue | null
}

const emptyEntry = (id = 'class-1'): TimetableEntry => ({
  id,
  subject: '',
  weekdays: [1],
  startTime: '09:00',
  endTime: '10:00',
  teacher: '',
  location: '',
  meetingUrl: '',
  notes: '',
})

const emptyInput = (): TimetableInput => ({
  name: '',
  effectiveFrom: '',
  effectiveTo: '',
  selectedUserIds: [],
  selectedGroupIds: [],
  entries: [],
})

export function TimetableDashboard() {
  const { user, profile } = useAuth()
  const role = profile?.role
  const canManage = role === 'organisation'
  const canView = canManage || role === 'user'
  const [drafts, setDrafts] = useState<DraftTimetable[]>([])
  const [published, setPublished] = useState<PublishedTimetable[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [directory, setDirectory] = useState<Record<string, DirectoryUser>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [input, setInput] = useState<TimetableInput>(() => emptyInput())
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [message, setMessage] = useState('')
  const [openedEntry, setOpenedEntry] = useState<{ entry: TimetableEntry; timetable: PublishedTimetable | DraftTimetable } | null>(null)

  useEffect(() => {
    if (!user || !canManage) return
    return onSnapshot(
      query(collection(db, 'timetableDrafts'), where('organisationId', '==', user.uid)),
      snapshot => setDrafts(snapshot.docs
        .map(document => ({ id: document.id, ...document.data() }) as DraftTimetable)
        .sort((first, second) => first.name.localeCompare(second.name))),
      reason => setMessage(`Could not load timetable drafts: ${reason.message}`),
    )
  }, [canManage, user])

  useEffect(() => {
    if (!user || !canView) return
    const source = canManage
      ? query(collection(db, 'timetables'), where('organisationId', '==', user.uid))
      : query(collection(db, 'timetables'), where('assignedUserIds', 'array-contains', user.uid))
    return onSnapshot(
      source,
      snapshot => setPublished(snapshot.docs
        .map(document => ({ id: document.id, ...document.data() }) as PublishedTimetable)
        .sort((first, second) => first.name.localeCompare(second.name))),
      reason => setMessage(`Could not load published timetables: ${reason.message}`),
    )
  }, [canManage, canView, user])

  useEffect(() => {
    if (!user || !canManage) return
    return onSnapshot(
      query(collection(db, 'organisationInvites'), where('organisationId', '==', user.uid)),
      snapshot => setMembers(snapshot.docs
        .map(document => document.data() as Member)
        .filter(member => member.status === 'accepted')),
      reason => setMessage(`Could not load institute students: ${reason.message}`),
    )
  }, [canManage, user])

  useEffect(() => {
    if (!user || !canManage) return
    return onSnapshot(collection(db, 'users'), snapshot => {
      setDirectory(Object.fromEntries(snapshot.docs.map(document => [
        document.id,
        document.data() as DirectoryUser,
      ])))
    }, reason => setMessage(`Could not load student names: ${reason.message}`))
  }, [canManage, user])

  useEffect(() => {
    if (!user || !canManage) return
    return onSnapshot(
      query(collection(db, 'organisationGroups'), where('organisationId', '==', user.uid)),
      snapshot => {
        void Promise.all(snapshot.docs.map(async document => {
          const groupMembers = await getDocs(collection(document.ref, 'members'))
          return {
            id: document.id,
            name: String(document.data().name || 'Batch'),
            members: groupMembers.docs.map(member => member.data() as Member),
          }
        })).then(items => setGroups(items.sort((first, second) => first.name.localeCompare(second.name))))
          .catch(() => setMessage('Could not load institute batches.'))
      },
      reason => setMessage(`Could not load institute batches: ${reason.message}`),
    )
  }, [canManage, user])

  const activeTimetables = published.filter(timetable => timetable.status === 'active')
  const conflictCount = useMemo(() => crossTimetableConflicts(activeTimetables), [activeTimetables])
  const resolvedMembers = useMemo(() => members.map(member => ({
    ...member,
    userName: directory[member.userId]?.name || member.userName,
    userEmail: directory[member.userId]?.email || member.userEmail,
  })).sort((first, second) => memberName(first).localeCompare(memberName(second))), [directory, members])
  const assigneeIds = useMemo(() => new Set([
    ...input.selectedUserIds,
    ...groups
      .filter(group => input.selectedGroupIds.includes(group.id))
      .flatMap(group => group.members.map(member => member.userId)),
  ]), [groups, input.selectedGroupIds, input.selectedUserIds])

  if (!canView) return <section><h1 className="text-3xl font-black">Access denied</h1></section>

  function openNew() {
    setEditingId(null)
    setInput(emptyInput())
    setMessage('')
    setFormOpen(true)
  }

  function openDraft(draft: DraftTimetable) {
    setEditingId(draft.id)
    setInput({
      name: draft.name,
      effectiveFrom: draft.effectiveFrom,
      effectiveTo: draft.effectiveTo,
      selectedUserIds: [...draft.selectedUserIds],
      selectedGroupIds: [...draft.selectedGroupIds],
      entries: draft.entries.map(entry => ({
        ...entry,
        weekdays: daysForTimetableEntry(entry),
        weekday: undefined,
      })),
    })
    setMessage('')
    setFormOpen(true)
  }

  async function api(path: string, method: string, body?: unknown) {
    if (!user) throw new Error('Authentication required.')
    const response = await fetch(path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        authorization: `Bearer ${await user.getIdToken()}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const payload = await response.json().catch(() => ({})) as { error?: string; timetableId?: string; changed?: boolean }
    if (!response.ok) throw new Error(payload.error || 'Unable to save the timetable.')
    return payload
  }

  function clientValidation() {
    if (!input.name.trim() || !input.effectiveFrom || !input.effectiveTo) return 'Add a name and effective date range.'
    if (input.effectiveTo < input.effectiveFrom) return 'The end date must be on or after the start date.'
    if (!assigneeIds.size) return 'Select at least one batch or student.'
    if (!input.entries.length || input.entries.some(entry => !entry.subject.trim())) return 'Every class needs a subject.'
    if (input.entries.some(entry => !daysForTimetableEntry(entry).length)) return 'Select at least one day for every class.'
    if (input.entries.some(entry => entry.endTime <= entry.startTime)) return 'Every class must end after it starts.'
    if (timetableEntryOverlaps(input.entries).length) return 'Class times cannot overlap within this timetable.'
    return ''
  }

  async function persistDraft() {
    const validation = clientValidation()
    if (validation) throw new Error(validation)
    const payload = {
      ...input,
      name: input.name.trim(),
      entries: input.entries.map(entry => ({
        ...entry,
        subject: entry.subject.trim(),
        teacher: entry.teacher?.trim() || '',
        location: entry.location?.trim() || '',
        meetingUrl: entry.meetingUrl?.trim() || '',
        notes: entry.notes?.trim() || '',
      })),
    }
    const result = editingId
      ? await api(`/api/timetables/${editingId}`, 'PATCH', payload)
      : await api('/api/timetables', 'POST', payload)
    if (!editingId && result.timetableId) setEditingId(result.timetableId)
    return result.timetableId || editingId!
  }

  async function saveDraft(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      await persistDraft()
      setMessage('Timetable draft saved.')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to save the timetable.')
    } finally {
      setSaving(false)
    }
  }

  async function publishDraft() {
    setPublishing(true)
    setMessage('')
    try {
      const id = await persistDraft()
      const result = await api(`/api/timetables/${id}/publish`, 'POST')
      setMessage(result.changed === false ? 'This timetable is already up to date.' : 'Timetable published. Students can now see the updated schedule.')
      setFormOpen(false)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to publish the timetable.')
    } finally {
      setPublishing(false)
    }
  }

  async function archiveTimetable(timetable: PublishedTimetable) {
    if (!window.confirm(`Archive ${timetable.name}? Students will be notified and future reminders will stop.`)) return false
    setMessage('')
    try {
      await api(`/api/timetables/${timetable.id}/archive`, 'POST')
      setMessage('Timetable archived. Future morning reminders have been stopped.')
      return true
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to archive the timetable.')
      return false
    }
  }

  return <section>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-black tracking-[0.18em] text-indigo-600">WEEKLY SCHEDULE</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">{canManage ? 'Institute timetables' : 'Your timetables'}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          {canManage ? 'Build privately, publish when ready, and send students one morning agenda on class days.' : 'Your institute’s published classes, teachers, rooms, and meeting links.'}
        </p>
      </div>
      {canManage && <button type="button" onClick={openNew} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white hover:bg-indigo-700">+ New timetable</button>}
    </header>

    {message && <p className={`mt-5 rounded-xl p-3 text-sm font-semibold ${/unable|cannot|could not|must|needs|invalid/i.test(message) ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{message}</p>}
    {conflictCount > 0 && <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">Schedule warning: {conflictCount} class overlap{conflictCount === 1 ? '' : 's'} exist across different timetables. These are allowed, but the affected schedules should be reviewed.</p>}

    {canManage && <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {drafts.map(draft => {
        const live = published.find(timetable => timetable.id === draft.id)
        return <article key={draft.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="font-black text-slate-950">{draft.name}</h2><p className="mt-1 text-xs text-slate-500">{draft.effectiveFrom} – {draft.effectiveTo}</p></div>
            <StatusBadge status={live?.status || 'draft'} />
          </div>
          <p className="mt-4 text-sm text-slate-600">{draft.entries.length} weekly class{draft.entries.length === 1 ? '' : 'es'} · {draft.selectedGroupIds.length} batch{draft.selectedGroupIds.length === 1 ? '' : 's'} · {draft.selectedUserIds.length} direct student{draft.selectedUserIds.length === 1 ? '' : 's'}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={() => openDraft(draft)} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-indigo-700">Edit</button>
          </div>
        </article>
      })}
      {!drafts.length && <div className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center md:col-span-2 xl:col-span-3"><p className="font-black text-slate-800">No timetable drafts yet</p><p className="mt-1 text-sm text-slate-500">Create a weekly timetable, select its students, then publish it.</p></div>}
    </div>}

    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-black tracking-widest text-indigo-600">PUBLISHED VIEW</p><h2 className="mt-1 text-xl font-black">Weekly timetable</h2></div>
        <p className="text-xs font-semibold text-slate-500">{activeTimetables.length} active timetable{activeTimetables.length === 1 ? '' : 's'}</p>
      </div>
      <WeeklySchedule timetables={activeTimetables} open={(entry, timetable) => setOpenedEntry({ entry, timetable })} />
    </section>

    {formOpen && <InteractiveTimetableEditor
      editing={Boolean(editingId)}
      input={input}
      groups={groups}
      members={resolvedMembers}
      assigneeCount={assigneeIds.size}
      saving={saving}
      publishing={publishing}
      canArchive={published.some(timetable => timetable.id === editingId && timetable.status === 'active')}
      setInput={setInput}
      save={saveDraft}
      publish={() => void publishDraft()}
      archive={() => {
        const active = published.find(timetable => timetable.id === editingId && timetable.status === 'active')
        if (!active) return
        void archiveTimetable(active).then(archived => {
          if (archived) setFormOpen(false)
        })
      }}
      close={() => setFormOpen(false)}
    />}
    {openedEntry && <EntryDetails {...openedEntry} close={() => setOpenedEntry(null)} />}
  </section>
}

export function LegacyTimetableEditor(props: {
  editing: boolean
  input: TimetableInput
  groups: Group[]
  members: Member[]
  assigneeCount: number
  saving: boolean
  publishing: boolean
  canArchive: boolean
  setInput: (value: TimetableInput | ((current: TimetableInput) => TimetableInput)) => void
  updateEntry: (id: string, patch: Partial<TimetableEntry>) => void
  save: (event: FormEvent) => void
  publish: () => void
  archive: () => void
  close: () => void
}) {
  const toggle = (field: 'selectedUserIds' | 'selectedGroupIds', id: string) => {
    props.setInput(current => ({
      ...current,
      [field]: current[field].includes(id)
        ? current[field].filter(value => value !== id)
        : [...current[field], id],
    }))
  }
  return <div role="dialog" aria-modal="true" aria-labelledby="timetable-editor-title" className="fixed inset-0 z-[60] bg-slate-950/55 p-3 sm:p-6" onMouseDown={props.close}>
    <form onSubmit={props.save} onMouseDown={event => event.stopPropagation()} className="mx-auto flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-7">
        <div><p className="text-xs font-black tracking-widest text-indigo-600">{props.editing ? 'EDIT DRAFT' : 'NEW TIMETABLE'}</p><h2 id="timetable-editor-title" className="mt-1 text-2xl font-black">Timetable builder</h2></div>
        <button type="button" onClick={props.close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Close</button>
      </header>
      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,.9fr)_minmax(32rem,1.1fr)]">
        <div className="space-y-7 p-5 sm:p-7">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2 text-sm font-bold">Timetable name <span className="text-rose-500">*</span><input required value={props.input.name} onChange={event => props.setInput(current => ({ ...current, name: event.target.value }))} placeholder="e.g. Banking Batch A" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
            <label className="text-sm font-bold">Effective from <span className="text-rose-500">*</span><input required type="date" value={props.input.effectiveFrom} onChange={event => props.setInput(current => ({ ...current, effectiveFrom: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
            <label className="text-sm font-bold">Effective to <span className="text-rose-500">*</span><input required type="date" min={props.input.effectiveFrom || undefined} value={props.input.effectiveTo} onChange={event => props.setInput(current => ({ ...current, effectiveTo: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
          </div>

          <fieldset><legend className="text-sm font-black">Batches</legend><p className="mt-1 text-xs text-slate-500">All current members of selected batches receive this timetable.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{props.groups.map(group => <AudienceChoice key={group.id} checked={props.input.selectedGroupIds.includes(group.id)} label={group.name} detail={`${group.members.length} members`} onChange={() => toggle('selectedGroupIds', group.id)} />)}{!props.groups.length && <EmptyChoice text="No batches available." />}</div></fieldset>
          <fieldset><legend className="text-sm font-black">Individual students</legend><p className="mt-1 text-xs text-slate-500">Add students directly, with or without a batch.</p><div className="mt-3 grid max-h-56 gap-2 overflow-auto pr-1 sm:grid-cols-2">{props.members.map(member => <AudienceChoice key={member.userId} checked={props.input.selectedUserIds.includes(member.userId)} label={memberName(member)} detail={member.userEmail} onChange={() => toggle('selectedUserIds', member.userId)} />)}{!props.members.length && <EmptyChoice text="No joined students available." />}</div></fieldset>

          <fieldset>
            <div className="flex items-end justify-between gap-3"><div><legend className="text-sm font-black">Weekly classes</legend><p className="mt-1 text-xs text-slate-500">Times use the app timezone and repeat every week in the effective date range.</p></div><button type="button" onClick={() => props.setInput(current => ({ ...current, entries: [...current.entries, emptyEntry(crypto.randomUUID())] }))} className="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700">+ Add class</button></div>
            <div className="mt-4 space-y-4">{props.input.entries.map((entry, index) => <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3"><p className="text-xs font-black tracking-widest text-slate-500">CLASS {index + 1}</p><button type="button" disabled={props.input.entries.length === 1} onClick={() => props.setInput(current => ({ ...current, entries: current.entries.filter(item => item.id !== entry.id) }))} className="text-xs font-black text-rose-600 disabled:opacity-30">Remove</button></div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2 text-xs font-bold">Subject <input required value={entry.subject} onChange={event => props.updateEntry(entry.id, { subject: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal" /></label>
                <fieldset className="sm:col-span-2">
                  <legend className="text-xs font-bold">Repeat on <span className="text-rose-500">*</span></legend>
                  <div className="mt-2 flex flex-wrap gap-2" aria-label="Class days">
                    {timetableWeekdayOrder.map(dayIndex => {
                      const selected = daysForTimetableEntry(entry).includes(dayIndex)
                      const dayName = timetableWeekdays[dayIndex]
                      return <button
                        key={dayIndex}
                        type="button"
                        aria-label={dayName}
                        aria-pressed={selected}
                        title={dayName}
                        onClick={() => {
                          const currentDays = daysForTimetableEntry(entry)
                          const weekdays = selected
                            ? currentDays.filter(day => day !== dayIndex)
                            : [...currentDays, dayIndex]
                          props.updateEntry(entry.id, { weekdays, weekday: undefined })
                        }}
                        className={`grid h-9 w-9 place-items-center rounded-full border text-xs font-black transition-colors ${selected ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm' : 'border-slate-300 bg-white text-slate-600 hover:border-indigo-400 hover:text-indigo-700'}`}
                      >
                        {dayName.charAt(0)}
                      </button>
                    })}
                  </div>
                  {!daysForTimetableEntry(entry).length && <p className="mt-2 text-xs font-semibold text-rose-600">Select at least one day.</p>}
                </fieldset>
                <div className="grid grid-cols-2 gap-2 sm:col-span-2"><label className="text-xs font-bold">Starts <input required type="time" value={entry.startTime} onChange={event => props.updateEntry(entry.id, { startTime: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-2.5 font-normal" /></label><label className="text-xs font-bold">Ends <input required type="time" value={entry.endTime} onChange={event => props.updateEntry(entry.id, { endTime: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-2.5 font-normal" /></label></div>
                <label className="text-xs font-bold">Teacher <span className="font-normal text-slate-400">(optional)</span><input value={entry.teacher || ''} onChange={event => props.updateEntry(entry.id, { teacher: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal" /></label>
                <label className="text-xs font-bold">Room or location <span className="font-normal text-slate-400">(optional)</span><input value={entry.location || ''} onChange={event => props.updateEntry(entry.id, { location: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal" /></label>
                <label className="sm:col-span-2 text-xs font-bold">Meeting link <span className="font-normal text-slate-400">(optional)</span><input type="url" value={entry.meetingUrl || ''} onChange={event => props.updateEntry(entry.id, { meetingUrl: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal" /></label>
                <label className="sm:col-span-2 text-xs font-bold">Notes <span className="font-normal text-slate-400">(optional)</span><textarea rows={2} value={entry.notes || ''} onChange={event => props.updateEntry(entry.id, { notes: event.target.value })} className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal" /></label>
              </div>
            </div>)}</div>
          </fieldset>
        </div>
        <aside className="border-t border-slate-200 bg-slate-50 p-5 lg:border-l lg:border-t-0 sm:p-7">
          <div className="sticky top-0"><p className="text-xs font-black tracking-widest text-indigo-600">LIVE PREVIEW</p><h3 className="mt-1 text-lg font-black">{props.input.name || 'Untitled timetable'}</h3><p className="mt-1 text-xs text-slate-500">{props.input.effectiveFrom || 'Start date'} – {props.input.effectiveTo || 'End date'} · {props.assigneeCount} student{props.assigneeCount === 1 ? '' : 's'}</p><WeeklyCalendarPreview entries={props.input.entries} /></div>
        </aside>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:px-7">
        <p className="text-sm font-bold text-slate-600">{props.assigneeCount} unique assignee{props.assigneeCount === 1 ? '' : 's'} · One agenda email at 7:00 AM on class days</p>
        <div className="flex flex-wrap justify-end gap-2">{props.canArchive && <button type="button" disabled={props.saving || props.publishing} onClick={props.archive} className="rounded-xl border border-rose-300 px-4 py-2.5 text-sm font-black text-rose-700 hover:bg-rose-50 disabled:opacity-50">Archive</button>}<button type="button" onClick={props.close} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold">Cancel</button><button disabled={props.saving || props.publishing} className="rounded-xl border border-indigo-300 px-4 py-2.5 text-sm font-black text-indigo-700 disabled:opacity-50">{props.saving ? 'Saving…' : 'Save draft'}</button><button type="button" disabled={props.saving || props.publishing} onClick={props.publish} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">{props.publishing ? 'Publishing…' : 'Publish'}</button></div>
      </footer>
    </form>
  </div>
}

function WeeklySchedule({ timetables, open }: { timetables: PublishedTimetable[]; open: (entry: TimetableEntry, timetable: PublishedTimetable) => void }) {
  return <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">{timetableWeekdays.map((day, weekday) => {
    const slots = timetables.flatMap(timetable => timetable.entries.filter(entry => daysForTimetableEntry(entry).includes(weekday)).map(entry => ({ entry, timetable }))).sort((first, second) => first.entry.startTime.localeCompare(second.entry.startTime))
    return <section key={day} className="min-h-36 rounded-xl border border-slate-200 bg-slate-50 p-3"><h3 className="text-xs font-black uppercase tracking-wider text-slate-500">{day}</h3><div className="mt-3 space-y-2">{slots.map(({ entry, timetable }) => <button type="button" key={`${timetable.id}:${entry.id}`} onClick={() => open(entry, timetable)} className="block w-full rounded-lg border border-indigo-200 bg-white p-2.5 text-left shadow-sm hover:border-indigo-400"><span className="block text-[10px] font-black text-indigo-600">{entry.startTime}–{entry.endTime}</span><span className="mt-1 block text-xs font-black text-slate-900">{entry.subject}</span><span className="mt-0.5 block truncate text-[10px] text-slate-500">{entry.teacher || timetable.name}</span></button>)}{!slots.length && <p className="text-xs text-slate-400">No classes</p>}</div></section>
  })}</div>
}

function WeeklyCalendarPreview({ entries }: { entries: TimetableEntry[] }) {
  const bounds = previewTimeBounds(entries)
  const events = entries.flatMap(entry => {
    const daysOfWeek = daysForTimetableEntry(entry)
    if (!daysOfWeek.length || !entry.startTime || !entry.endTime) return []
    return [{
      id: entry.id,
      title: entry.subject || 'Untitled class',
      daysOfWeek,
      startTime: entry.startTime,
      endTime: entry.endTime,
      backgroundColor: '#4f46e5',
      borderColor: '#4338ca',
      extendedProps: { teacher: entry.teacher || entry.location || '' },
    }]
  })
  return <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white">
    <div className="timetable-preview-calendar">
      <FullCalendar
        plugins={[timeGridPlugin]}
        initialView="timeGridWeek"
        initialDate="2026-01-05"
        firstDay={1}
        headerToolbar={false}
        allDaySlot={false}
        weekends
        events={events}
        slotMinTime={bounds.minimum}
        slotMaxTime={bounds.maximum}
        scrollTime={bounds.minimum}
        scrollTimeReset={false}
        slotDuration="00:30:00"
        slotLabelInterval="01:00:00"
        slotLabelFormat={{ hour: 'numeric', meridiem: 'short' }}
        dayHeaderFormat={{ weekday: 'short' }}
        eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
        eventContent={info => <div className="min-w-0 px-1 py-0.5"><p className="truncate text-[10px] font-black">{info.event.title}</p><p className="truncate text-[9px] opacity-85">{info.timeText}{info.event.extendedProps.teacher ? ` · ${info.event.extendedProps.teacher}` : ''}</p></div>}
        height={500}
        expandRows
      />
    </div>
  </div>
}

function previewTimeBounds(entries: TimetableEntry[]) {
  const starts = entries.map(entry => Number(entry.startTime.split(':')[0])).filter(Number.isFinite)
  const ends = entries.map(entry => {
    const [hour, minute] = entry.endTime.split(':').map(Number)
    return hour + (minute > 0 ? 1 : 0)
  }).filter(Number.isFinite)
  const minimumHour = starts.length ? Math.max(0, Math.min(...starts) - 1) : 8
  const maximumHour = ends.length ? Math.min(24, Math.max(...ends) + 1) : 18
  const format = (hour: number) => `${String(hour).padStart(2, '0')}:00:00`
  return { minimum: format(minimumHour), maximum: format(Math.max(minimumHour + 2, maximumHour)) }
}

function EntryDetails({ entry, timetable, close }: { entry: TimetableEntry; timetable: PublishedTimetable | DraftTimetable; close: () => void }) {
  const days = daysForTimetableEntry(entry).map(day => timetableWeekdays[day]).join(', ')
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/55 p-4" onMouseDown={close}><section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onMouseDown={event => event.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black tracking-widest text-indigo-600">CLASS DETAILS</p><h2 className="mt-2 text-2xl font-black">{entry.subject}</h2><p className="mt-1 text-sm font-semibold text-indigo-700">{timetable.organisationName} · {timetable.name}</p></div><button type="button" onClick={close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Close</button></div><dl className="mt-6 space-y-3 rounded-xl bg-slate-50 p-4 text-sm"><Detail label="Schedule" value={`${days}, ${entry.startTime}–${entry.endTime}`} /><Detail label="Effective dates" value={`${timetable.effectiveFrom} – ${timetable.effectiveTo}`} />{entry.teacher && <Detail label="Teacher" value={entry.teacher} />}{entry.location && <Detail label="Room or location" value={entry.location} />}{entry.notes && <Detail label="Notes" value={entry.notes} />}</dl>{entry.meetingUrl && <a href={entry.meetingUrl} target="_blank" rel="noreferrer" className="mt-5 block rounded-xl bg-indigo-600 px-4 py-3 text-center text-sm font-black text-white">Open meeting link</a>}</section></div>
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-black uppercase tracking-wider text-slate-400">{label}</dt><dd className="mt-1 whitespace-pre-wrap font-semibold text-slate-800">{value}</dd></div>
}

function StatusBadge({ status }: { status: 'active' | 'archived' | 'draft' }) {
  const style = status === 'active' ? 'bg-emerald-100 text-emerald-700' : status === 'archived' ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-700'
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${style}`}>{status}</span>
}

function AudienceChoice({ checked, label, detail, onChange }: { checked: boolean; label: string; detail: string; onChange: () => void }) {
  return <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${checked ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white'}`}><input type="checkbox" checked={checked} onChange={onChange} className="mt-0.5 h-4 w-4 accent-indigo-600" /><span className="min-w-0"><b className="block truncate text-sm text-slate-800">{label}</b><span className="mt-0.5 block truncate text-xs text-slate-500">{detail}</span></span></label>
}

function EmptyChoice({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-slate-200 p-3 text-sm text-slate-500">{text}</p>
}

function memberName(member: Member) {
  return member.userName?.trim() || member.userEmail
}

function crossTimetableConflicts(timetables: PublishedTimetable[]) {
  let conflicts = 0
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const entries = timetables.flatMap(timetable => timetable.entries
      .filter(entry => daysForTimetableEntry(entry).includes(weekday))
      .map(entry => ({
        entry,
        timetableId: timetable.id,
        effectiveFrom: timetable.effectiveFrom,
        effectiveTo: timetable.effectiveTo,
        assignedUserIds: timetable.assignedUserIds,
      })))
      .sort((first, second) => first.entry.startTime.localeCompare(second.entry.startTime))
    for (let first = 0; first < entries.length; first += 1) {
      for (let second = first + 1; second < entries.length; second += 1) {
        if (entries[second].entry.startTime >= entries[first].entry.endTime) break
        const dateRangesOverlap = entries[first].effectiveFrom <= entries[second].effectiveTo
          && entries[second].effectiveFrom <= entries[first].effectiveTo
        const sharedAudience = entries[first].assignedUserIds.some(userId => entries[second].assignedUserIds.includes(userId))
        if (entries[first].timetableId !== entries[second].timetableId && dateRangesOverlap && sharedAudience) conflicts += 1
      }
    }
  }
  return conflicts
}
