'use client'

import { type FormEvent, useMemo, useState } from 'react'
import {
  daysForTimetableEntry,
  timetableEntryOverlaps,
  timetableWeekdayOrder,
  timetableWeekdays,
  type TimetableEntry,
  type TimetableInput,
} from '@/lib/timetable'

type Member = { userId: string; userName?: string; userEmail: string }
type Group = { id: string; name: string; members: Member[] }

export function TimetableEditor(props: {
  editing: boolean
  input: TimetableInput
  groups: Group[]
  members: Member[]
  teachers: Member[]
  assigneeCount: number
  saving: boolean
  publishing: boolean
  disabling: boolean
  deleting: boolean
  canDisable: boolean
  canDelete: boolean
  setInput: (value: TimetableInput | ((current: TimetableInput) => TimetableInput)) => void
  save: (event: FormEvent) => void
  publish: () => void
  disable: () => void
  remove: () => void
  close: () => void
}) {
  const [groupSearch, setGroupSearch] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const [classDraft, setClassDraft] = useState<TimetableEntry | null>(null)
  const [classError, setClassError] = useState('')

  const filteredGroups = useMemo(() => {
    const needle = groupSearch.trim().toLowerCase()
    return props.groups.filter(group => !needle || group.name.toLowerCase().includes(needle))
  }, [groupSearch, props.groups])
  const filteredMembers = useMemo(() => {
    const needle = studentSearch.trim().toLowerCase()
    return props.members.filter(member => !needle || `${memberName(member)} ${member.userEmail}`.toLowerCase().includes(needle))
  }, [props.members, studentSearch])

  const toggleAudience = (field: 'selectedUserIds' | 'selectedGroupIds', id: string) => {
    props.setInput(current => ({
      ...current,
      [field]: current[field].includes(id)
        ? current[field].filter(value => value !== id)
        : [...current[field], id],
    }))
  }

  const openNewClass = (weekday = 1, startTime = '09:00') => {
    const endTime = addMinutes(startTime, 60)
    setClassError('')
    setClassDraft({
      id: crypto.randomUUID(),
      subject: '',
      weekdays: [weekday],
      startTime,
      endTime,
      teacher: '',
      teacherUserId: undefined,
      location: '',
      meetingUrl: '',
      notes: '',
    })
  }

  const openExistingClass = (entry: TimetableEntry) => {
    setClassError('')
    setClassDraft({
      ...entry,
      weekdays: daysForTimetableEntry(entry),
      weekday: undefined,
    })
  }

  const saveClass = () => {
    if (!classDraft) return
    if (!classDraft.subject.trim()) {
      setClassError('Add a subject for this class.')
      return
    }
    if (!daysForTimetableEntry(classDraft).length) {
      setClassError('Select at least one day.')
      return
    }
    if (classDraft.endTime <= classDraft.startTime) {
      setClassError('The end time must be after the start time.')
      return
    }
    if (classDraft.meetingUrl?.trim()) {
      try {
        const url = new URL(classDraft.meetingUrl)
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
      } catch {
        setClassError('Meeting links must use http or https.')
        return
      }
    }
    const normalized = {
      ...classDraft,
      subject: classDraft.subject.trim(),
      teacher: classDraft.teacher?.trim() || '',
      location: classDraft.location?.trim() || '',
      meetingUrl: classDraft.meetingUrl?.trim() || '',
      notes: classDraft.notes?.trim() || '',
      weekdays: daysForTimetableEntry(classDraft),
      weekday: undefined,
    }
    const otherEntries = props.input.entries.filter(entry => entry.id !== normalized.id)
    if (timetableEntryOverlaps([...otherEntries, normalized]).length) {
      setClassError('This class overlaps another class on one or more selected days.')
      return
    }
    props.setInput(current => ({
      ...current,
      entries: current.entries.some(entry => entry.id === normalized.id)
        ? current.entries.map(entry => entry.id === normalized.id ? normalized : entry)
        : [...current.entries, normalized],
    }))
    setClassDraft(null)
  }

  const deleteClass = () => {
    if (!classDraft) return
    props.setInput(current => ({
      ...current,
      entries: current.entries.filter(entry => entry.id !== classDraft.id),
    }))
    setClassDraft(null)
  }

  return <div role="dialog" aria-modal="true" aria-labelledby="timetable-editor-title" className="fixed inset-0 z-[60] bg-slate-950/55 p-3 sm:p-6" onMouseDown={props.close}>
    <form onSubmit={props.save} onMouseDown={event => event.stopPropagation()} className="mx-auto flex max-h-full w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-7">
        <div><p className="text-xs font-black tracking-widest text-indigo-600">{props.editing ? 'EDIT TIMETABLE' : 'NEW TIMETABLE'}</p><h2 id="timetable-editor-title" className="mt-1 text-2xl font-black">Timetable builder</h2></div>
        <button type="button" onClick={props.close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Close</button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <div><p className="text-xs font-black tracking-widest text-indigo-600">TIMETABLE DETAILS</p><h3 className="mt-1 text-lg font-black">Schedule and batches</h3></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2 text-sm font-bold">Timetable name <span className="text-rose-500">*</span><input required value={props.input.name} onChange={event => props.setInput(current => ({ ...current, name: event.target.value }))} placeholder="e.g. Banking Batch A" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
              <label className="text-sm font-bold">Effective from <span className="text-rose-500">*</span><input required type="date" value={props.input.effectiveFrom} onChange={event => props.setInput(current => ({ ...current, effectiveFrom: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" /></label>
              <label className="text-sm font-bold">Effective to <span className="text-rose-500">*</span><input required type="date" min={props.input.effectiveFrom || undefined} value={props.input.effectiveTo} onChange={event => props.setInput(current => ({ ...current, effectiveTo: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal" /></label>
            </div>
            <fieldset className="mt-6">
              <div className="flex flex-wrap items-end justify-between gap-3"><div><legend className="text-sm font-black">Batches</legend><p className="mt-1 text-xs text-slate-500">Selecting a batch includes all its current members.</p></div><span className="text-xs font-bold text-indigo-700">{props.input.selectedGroupIds.length} selected</span></div>
              <label className="relative mt-3 block"><span className="sr-only">Search batches</span><SearchIcon /><input value={groupSearch} onChange={event => setGroupSearch(event.target.value)} placeholder="Search batches…" className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
              <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {filteredGroups.map(group => <AudienceChoice key={group.id} checked={props.input.selectedGroupIds.includes(group.id)} label={group.name} detail={`${group.members.length} member${group.members.length === 1 ? '' : 's'}`} onChange={() => toggleAudience('selectedGroupIds', group.id)} />)}
                {!filteredGroups.length && <EmptyChoice text={props.groups.length ? 'No batches match this search.' : 'No batches available.'} />}
              </div>
            </fieldset>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black tracking-widest text-indigo-600">STUDENT SELECTION</p><h3 className="mt-1 text-lg font-black">Individual students</h3><p className="mt-1 text-xs text-slate-500">Add students directly, with or without a selected batch.</p></div><span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-black text-indigo-700">{props.assigneeCount} unique</span></div>
            <label className="relative mt-5 block"><span className="sr-only">Search students</span><SearchIcon /><input value={studentSearch} onChange={event => setStudentSearch(event.target.value)} placeholder="Search by name or email…" className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
            <div className="mt-3 grid max-h-[25rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {filteredMembers.map(member => <AudienceChoice key={member.userId} checked={props.input.selectedUserIds.includes(member.userId)} label={memberName(member)} detail={member.userEmail} onChange={() => toggleAudience('selectedUserIds', member.userId)} />)}
              {!filteredMembers.length && <EmptyChoice text={props.members.length ? 'No students match this search.' : 'No joined students available.'} />}
            </div>
          </div>
        </section>

        <section className="mt-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-xs font-black tracking-widest text-indigo-600">WEEKLY CLASSES</p><h3 className="mt-1 text-xl font-black">{props.input.name || 'Untitled timetable'}</h3><p className="mt-1 text-xs text-slate-500">Hover over an empty 30-minute window and click to add a class. Click an existing class to edit it.</p></div>
            <button type="button" onClick={() => openNewClass()} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white shadow-sm hover:bg-indigo-700">+ Add class</button>
          </div>
          <InteractiveWeekCalendar entries={props.input.entries} addClass={openNewClass} editClass={openExistingClass} />
        </section>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:px-7">
        <p className="text-sm font-bold text-slate-600">{props.input.entries.length} class{props.input.entries.length === 1 ? '' : 'es'} · {props.assigneeCount} unique assignee{props.assigneeCount === 1 ? '' : 's'} · Morning agenda at 7:00 AM</p>
        <div className="flex flex-wrap justify-end gap-2">
          {props.canDisable && <button type="button" disabled={props.saving || props.publishing || props.disabling} onClick={props.disable} className="rounded-xl border border-amber-300 px-4 py-2.5 text-sm font-black text-amber-800 hover:bg-amber-50 disabled:opacity-50">{props.disabling ? 'Disabling…' : 'Disable timetable'}</button>}
          {props.canDelete && <button type="button" disabled={props.saving || props.publishing || props.deleting} onClick={props.remove} className="rounded-xl border border-rose-300 px-4 py-2.5 text-sm font-black text-rose-700 hover:bg-rose-50 disabled:opacity-50">{props.deleting ? 'Deleting…' : 'Delete timetable'}</button>}
          <button type="button" onClick={props.close} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold">Cancel</button>
          <button disabled={props.saving || props.publishing || props.disabling || props.deleting} className="rounded-xl border border-indigo-300 px-4 py-2.5 text-sm font-black text-indigo-700 disabled:opacity-50">{props.saving ? 'Saving…' : 'Save draft'}</button>
          <button type="button" disabled={props.saving || props.publishing || props.disabling || props.deleting} onClick={props.publish} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">{props.publishing ? 'Publishing…' : 'Publish'}</button>
        </div>
      </footer>
    </form>

    {classDraft && <ClassEditorDialog
      entry={classDraft}
      teachers={props.teachers}
      existing={props.input.entries.some(entry => entry.id === classDraft.id)}
      error={classError}
      setEntry={setClassDraft}
      save={saveClass}
      remove={deleteClass}
      close={() => setClassDraft(null)}
    />}
  </div>
}

function InteractiveWeekCalendar({ entries, addClass, editClass }: {
  entries: TimetableEntry[]
  addClass: (weekday: number, startTime: string) => void
  editClass: (entry: TimetableEntry) => void
}) {
  const { minimum, maximum } = calendarMinuteBounds(entries)
  const slotMinutes = 30
  const slotHeight = 36
  const slotCount = (maximum - minimum) / slotMinutes
  const slots = Array.from({ length: slotCount }, (_, index) => minimum + index * slotMinutes)
  const height = slotCount * slotHeight

  return <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="min-w-[58rem]">
      <div className="grid grid-cols-[4.5rem_repeat(7,minmax(7rem,1fr))] border-b border-slate-200 bg-slate-50">
        <div className="border-r border-slate-200 px-2 py-3 text-center text-[10px] font-black uppercase tracking-wider text-slate-400">Time</div>
        {timetableWeekdayOrder.map(day => <div key={day} className="border-r border-slate-200 px-2 py-3 text-center text-xs font-black uppercase tracking-wider text-slate-600 last:border-r-0">{timetableWeekdays[day].slice(0, 3)}</div>)}
      </div>
      <div className="grid grid-cols-[4.5rem_repeat(7,minmax(7rem,1fr))]">
        <div className="relative border-r border-slate-200 bg-slate-50" style={{ height }}>
          {slots.filter((_, index) => index % 2 === 0).map(minutes => <span key={minutes} className="absolute right-2 -translate-y-1/2 text-[10px] font-bold text-slate-500" style={{ top: ((minutes - minimum) / slotMinutes) * slotHeight }}>{formatMinutes(minutes)}</span>)}
        </div>
        {timetableWeekdayOrder.map(weekday => <div key={weekday} className="relative border-r border-slate-200 last:border-r-0" style={{ height }}>
          {slots.map(minutes => <button
            key={minutes}
            type="button"
            aria-label={`Add class on ${timetableWeekdays[weekday]} at ${formatMinutes(minutes)}`}
            title={`Add class · ${timetableWeekdays[weekday]} ${formatMinutes(minutes)}`}
            onClick={() => addClass(weekday, minutesToTime(minutes))}
            className="block w-full border-b border-slate-100 bg-white transition-colors hover:bg-indigo-100 focus:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-400"
            style={{ height: slotHeight }}
          />)}
          {entries.filter(entry => daysForTimetableEntry(entry).includes(weekday)).map(entry => {
            const start = timeToMinutes(entry.startTime)
            const end = timeToMinutes(entry.endTime)
            const top = ((start - minimum) / slotMinutes) * slotHeight
            const eventHeight = Math.max(28, ((end - start) / slotMinutes) * slotHeight)
            return <button
              key={entry.id}
              type="button"
              onClick={() => editClass(entry)}
              className="absolute left-1 right-1 z-10 overflow-hidden rounded-lg bg-indigo-600 px-2 py-1.5 text-left text-white shadow-md ring-1 ring-indigo-700/20 transition-transform hover:z-20 hover:scale-[1.02] hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              style={{ top, height: eventHeight }}
            >
              <span className="block truncate text-xs font-black leading-4">{entry.subject}</span>
              <span className="mt-0.5 block truncate text-[11px] font-semibold leading-4 text-indigo-100">{entry.startTime}–{entry.endTime}{entry.teacher ? ` · ${entry.teacher}` : ''}</span>
            </button>
          })}
        </div>)}
      </div>
    </div>
  </div>
}

function ClassEditorDialog(props: {
  entry: TimetableEntry
  teachers: Member[]
  existing: boolean
  error: string
  setEntry: (entry: TimetableEntry) => void
  save: () => void
  remove: () => void
  close: () => void
}) {
  const update = (patch: Partial<TimetableEntry>) => props.setEntry({ ...props.entry, ...patch })
  return <div role="dialog" aria-modal="true" aria-labelledby="class-editor-title" className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 p-4" onMouseDown={event => { event.stopPropagation(); props.close() }}>
    <section className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()}>
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5"><div><p className="text-xs font-black tracking-widest text-indigo-600">{props.existing ? 'EDIT CLASS' : 'NEW CLASS'}</p><h3 id="class-editor-title" className="mt-1 text-2xl font-black">Class details</h3></div><button type="button" onClick={props.close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Close</button></header>
      <div className="grid gap-5 p-6 sm:grid-cols-2">
        <label className="sm:col-span-2 text-sm font-bold">Subject <span className="text-rose-500">*</span><input autoFocus value={props.entry.subject} onChange={event => update({ subject: event.target.value })} placeholder="e.g. Quantitative Aptitude" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
        <fieldset className="sm:col-span-2"><legend className="text-sm font-bold">Repeat on <span className="text-rose-500">*</span></legend><div className="mt-3 flex flex-wrap gap-2">{timetableWeekdayOrder.map(day => {
          const selected = daysForTimetableEntry(props.entry).includes(day)
          return <button key={day} type="button" aria-label={timetableWeekdays[day]} aria-pressed={selected} title={timetableWeekdays[day]} onClick={() => update({ weekdays: selected ? daysForTimetableEntry(props.entry).filter(value => value !== day) : [...daysForTimetableEntry(props.entry), day], weekday: undefined })} className={`grid h-10 w-10 place-items-center rounded-full border text-xs font-black ${selected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-700'}`}>{timetableWeekdays[day].charAt(0)}</button>
        })}</div></fieldset>
        <label className="text-sm font-bold">Starts <span className="text-rose-500">*</span><input type="time" step="1800" value={props.entry.startTime} onChange={event => update({ startTime: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
        <label className="text-sm font-bold">Ends <span className="text-rose-500">*</span><input type="time" step="1800" value={props.entry.endTime} onChange={event => update({ endTime: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
        <label className="text-sm font-bold">Teacher <span className="font-normal text-slate-400">(optional)</span><select value={props.entry.teacherUserId || ''} onChange={event => {
          const teacher = props.teachers.find(item => item.userId === event.target.value)
          update({ teacherUserId: teacher?.userId, teacher: teacher ? memberName(teacher) : props.entry.teacherUserId ? '' : props.entry.teacher || '' })
        }} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal"><option value="">{props.entry.teacher && !props.entry.teacherUserId ? `Unlinked: ${props.entry.teacher}` : 'No assigned teacher'}</option>{props.teachers.map(teacher => <option key={teacher.userId} value={teacher.userId}>{memberName(teacher)}</option>)}</select>{!props.teachers.length && <span className="mt-1 block text-xs font-normal text-slate-500">Promote a joined student to teacher before assigning them here.</span>}</label>
        <label className="text-sm font-bold">Room or location <span className="font-normal text-slate-400">(optional)</span><input value={props.entry.location || ''} onChange={event => update({ location: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
        <label className="sm:col-span-2 text-sm font-bold">Meeting link <span className="font-normal text-slate-400">(optional)</span><input type="url" value={props.entry.meetingUrl || ''} onChange={event => update({ meetingUrl: event.target.value })} placeholder="https://…" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
        <label className="sm:col-span-2 text-sm font-bold">Notes <span className="font-normal text-slate-400">(optional)</span><textarea rows={3} value={props.entry.notes || ''} onChange={event => update({ notes: event.target.value })} className="mt-2 w-full resize-y rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
        {props.error && <p className="sm:col-span-2 rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{props.error}</p>}
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-5"><div>{props.existing && <button type="button" onClick={props.remove} className="rounded-xl border border-rose-300 px-4 py-2.5 text-sm font-black text-rose-700 hover:bg-rose-50">Remove class</button>}</div><div className="flex gap-2"><button type="button" onClick={props.close} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold">Cancel</button><button type="button" onClick={props.save} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white hover:bg-indigo-700">{props.existing ? 'Save changes' : 'Add class'}</button></div></footer>
    </section>
  </div>
}

function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
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

function calendarMinuteBounds(entries: TimetableEntry[]) {
  const starts = entries.map(entry => timeToMinutes(entry.startTime)).filter(Number.isFinite)
  const ends = entries.map(entry => timeToMinutes(entry.endTime)).filter(Number.isFinite)
  const minimum = starts.length ? Math.max(0, Math.floor((Math.min(...starts) - 60) / 30) * 30) : 8 * 60
  const maximum = ends.length ? Math.min(24 * 60, Math.ceil((Math.max(...ends) + 60) / 30) * 30) : 18 * 60
  return { minimum, maximum: Math.max(minimum + 120, maximum) }
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function minutesToTime(minutes: number) {
  const normalized = Math.max(0, Math.min(23 * 60 + 30, minutes))
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

function addMinutes(value: string, amount: number) {
  return minutesToTime(timeToMinutes(value) + amount)
}

function formatMinutes(minutes: number) {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  const displayHour = hour % 12 || 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}
