'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { assignmentInstanceId } from '@/lib/assignment-instance'
import { addDays, daysForTimetableEntry, timetableWeekdays, type TimetableEntry } from '@/lib/timetable'
import { useAuth, type UserProfile } from './auth-context'
import { AssignmentModal, type AssignmentBatch } from './assignments-dashboard'
import type { Submission } from './test-types'

type UserAssignment = { id: string; assignmentBatchId?: string; testId: string; testTitle: string; assignmentName?: string; attemptsUsed?: number; maxAttempts?: number; startAt?: { toDate: () => Date }; deadline: { toDate: () => Date }; createdAt?: { toDate: () => Date } }
type DateValue = { toDate: () => Date }
type CalendarEventFilter = 'all' | 'assignments' | 'tasks' | 'timetables'
type CalendarTask = {
  id: string
  title: string
  description: string
  taskType?: 'basic' | 'submission'
  organisationId: string
  organisationName?: string
  createdByName?: string
  assignedUserIds: string[]
  audienceNames?: string[]
  startAt?: DateValue | null
  endAt?: DateValue | null
  createdAt?: DateValue
  isClosed?: boolean
}
type CalendarTimetable = {
  id: string
  name: string
  organisationId: string
  organisationName: string
  status: 'active' | 'archived'
  effectiveFrom: string
  effectiveTo: string
  assignedUserIds: string[]
  audienceNames?: string[]
  entries: TimetableEntry[]
}

function stateOf(assignment: { startAt?: { toDate: () => Date }; deadline: { toDate: () => Date }; createdAt?: { toDate: () => Date } }, now = Date.now()) {
  const start = assignment.startAt?.toDate().getTime() || assignment.createdAt?.toDate().getTime() || 0
  return now < start ? 'upcoming' : now <= assignment.deadline.toDate().getTime() ? 'live' : 'ended'
}

export function AssignmentCalendarDashboard() {
  const { user, profile } = useAuth()
  const role = profile?.role
  const manager = role === 'admin' || role === 'organisation'
  const learner = role === 'user'
  const [assignments, setAssignments] = useState<AssignmentBatch[]>([])
  const [userAssignments, setUserAssignments] = useState<UserAssignment[]>([])
  const [tasks, setTasks] = useState<CalendarTask[]>([])
  const [timetables, setTimetables] = useState<CalendarTimetable[]>([])
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [accounts, setAccounts] = useState<UserProfile[]>([])
  const [opened, setOpened] = useState<AssignmentBatch | null>(null)
  const [openedUser, setOpenedUser] = useState<UserAssignment | null>(null)
  const [openedTask, setOpenedTask] = useState<CalendarTask | null>(null)
  const [openedTimetable, setOpenedTimetable] = useState<{ timetable: CalendarTimetable; entry: TimetableEntry } | null>(null)
  const [eventFilter, setEventFilter] = useState<CalendarEventFilter>('all')
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!user || !manager) return
    return onSnapshot(query(collection(db, 'assignmentBatches'), where('assignedBy', '==', user.uid)), snapshot => setAssignments(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as AssignmentBatch)), reason => setMessage(reason.message))
  }, [manager, user])
  useEffect(() => {
    if (!user || !learner) return
    void user.getIdToken().then(token => fetch('/api/test-session?list=assignments', {
      headers: { authorization: `Bearer ${token}` },
    })).catch(() => undefined)
    return onSnapshot(query(collection(db, 'testAssignments'), where('userId', '==', user.uid)), snapshot => setUserAssignments(snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }) as UserAssignment)
      .filter(item => !!item.assignmentBatchId && item.id === assignmentInstanceId(item.assignmentBatchId, user.uid))), reason => setMessage(reason.message))
  }, [learner, user])
  useEffect(() => {
    if (!user || (role !== 'organisation' && role !== 'user')) return
    const taskQuery = role === 'organisation'
      ? query(collection(db, 'tasks'), where('organisationId', '==', user.uid))
      : query(collection(db, 'tasks'), where('assignedUserIds', 'array-contains', user.uid))
    return onSnapshot(taskQuery, snapshot => setTasks(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as CalendarTask)), reason => setMessage(reason.message))
  }, [role, user])
  useEffect(() => {
    if (!user || !role) return
    const timetableQuery = role === 'admin'
      ? collection(db, 'timetables')
      : role === 'organisation'
        ? query(collection(db, 'timetables'), where('organisationId', '==', user.uid))
        : query(collection(db, 'timetables'), where('assignedUserIds', 'array-contains', user.uid))
    return onSnapshot(timetableQuery, snapshot => setTimetables(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as CalendarTimetable)), reason => setMessage(reason.message))
  }, [role, user])
  useEffect(() => { if (!user || !manager) return; const source = role === 'admin' ? collection(db, 'submissions') : query(collection(db, 'submissions'), where('organisationIds', 'array-contains', user.uid)); return onSnapshot(source, snapshot => setSubmissions(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as Submission)), reason => setMessage(reason.message)) }, [manager, role, user])
  useEffect(() => {
    if (!user || !manager) return
    void (async () => {
      try {
        const snapshot = role === 'admin' ? await getDocs(query(collection(db, 'users'), where('role', '==', 'user'))) : await getDocs(query(collection(db, 'organisationInvites'), where('organisationId', '==', user.uid)))
        setAccounts(role === 'admin' ? snapshot.docs.map(item => ({ uid: item.id, ...item.data() }) as UserProfile) : snapshot.docs.map(item => item.data() as { userId: string; userEmail: string; status: string }).filter(item => item.status === 'accepted').map(item => ({ uid: item.userId, email: item.userEmail, role: 'user' })))
      } catch { setMessage('Unable to load assignment users.') }
    })()
  }, [manager, role, user])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  if (!manager && !learner) return <section><h1 className="text-3xl font-black">Access denied</h1></section>
  const assignmentSource = manager ? assignments : userAssignments
  const assignmentEvents = assignmentSource.map(assignment => {
    const state = stateOf(assignment, now)
    const color = state === 'live' ? '#059669' : state === 'upcoming' ? '#4f46e5' : '#64748b'
    return { id: `assignment:${assignment.id}`, title: manager ? (assignment as AssignmentBatch).name : (assignment as UserAssignment).assignmentName || assignment.testTitle, start: assignment.startAt?.toDate() || assignment.createdAt?.toDate(), end: assignment.deadline.toDate(), backgroundColor: color, borderColor: color, extendedProps: { kind: 'assignment', originalId: assignment.id, detail: manager ? (assignment as AssignmentBatch).audienceName : assignment.testTitle } }
  })
  const taskEvents = tasks.flatMap(task => {
    if (!task.endAt || (learner && task.startAt && task.startAt.toDate().getTime() > now)) return []
    const startTime = task.startAt?.toDate() || task.createdAt?.toDate() || task.endAt.toDate()
    const deadline = task.endAt.toDate()
    const state = task.isClosed ? 'ended' : now < startTime.getTime() ? 'upcoming' : now <= deadline.getTime() ? 'live' : 'ended'
    const color = state === 'live' ? '#059669' : state === 'upcoming' ? '#4f46e5' : '#64748b'
    const detail = learner
      ? task.organisationName || task.createdByName || 'Institute'
      : task.audienceNames?.join(', ') || `${task.assignedUserIds.length} assignee${task.assignedUserIds.length === 1 ? '' : 's'}`
    return [{ id: `task:${task.id}`, title: task.title, start: startTime, end: deadline, backgroundColor: color, borderColor: color, extendedProps: { kind: 'task', originalId: task.id, detail } }]
  })
  const timetableEvents = timetables
    .filter(timetable => timetable.status === 'active')
    .flatMap(timetable => timetable.entries.map(entry => ({
      id: `timetable:${timetable.id}:${entry.id}`,
      title: entry.subject,
      daysOfWeek: daysForTimetableEntry(entry),
      startTime: entry.startTime,
      endTime: entry.endTime,
      startRecur: timetable.effectiveFrom,
      endRecur: addDays(timetable.effectiveTo, 1),
      backgroundColor: '#4f46e5',
      borderColor: '#4338ca',
      extendedProps: {
        kind: 'timetable',
        originalId: timetable.id,
        entryId: entry.id,
        detail: entry.teacher || timetable.name,
      },
    })))
  const events = eventFilter === 'assignments'
    ? assignmentEvents
    : eventFilter === 'tasks'
      ? taskEvents
      : eventFilter === 'timetables'
        ? timetableEvents
        : [...assignmentEvents, ...taskEvents, ...timetableEvents]

  return <section className="calendar-page flex h-[calc(100dvh-9.5rem)] min-h-[32rem] flex-col">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-black tracking-[0.18em] text-indigo-600">SCHEDULE</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{manager ? 'Schedule calendar' : 'Your schedule calendar'}</h1>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-4 pb-1 text-xs font-bold text-slate-600">
        <label className="flex items-center gap-2">
          <span>Show</span>
          <select value={eventFilter} onChange={event => setEventFilter(event.target.value as CalendarEventFilter)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100">
            <option value="all">All events</option>
            <option value="assignments">Assignments</option>
            <option value="tasks">Tasks</option>
            <option value="timetables">Timetables</option>
          </select>
        </label>
        <Legend color="bg-indigo-500" label="Upcoming" />
        <Legend color="bg-emerald-600" label="Live" />
        <Legend color="bg-slate-500" label="Ended" />
        <Legend color="bg-indigo-600" label="Timetable" />
      </div>
    </div>
    {message && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{message}</p>}
    <section className="assignment-calendar mt-4 min-h-0 flex-1 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_14px_40px_rgb(15_23_42/0.08)] sm:p-5">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
        buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day' }}
        views={{
          dayGridMonth: { dayMaxEvents: 3 },
          timeGridWeek: { dayHeaderFormat: { weekday: 'short', month: 'numeric', day: 'numeric' } },
          timeGridDay: { dayHeaderFormat: { weekday: 'long', month: 'short', day: 'numeric' } },
        }}
        events={events}
        eventClick={info => {
          if (info.event.extendedProps.kind === 'timetable') {
            const timetable = timetables.find(item => item.id === info.event.extendedProps.originalId)
            const entry = timetable?.entries.find(item => item.id === info.event.extendedProps.entryId)
            if (timetable && entry) setOpenedTimetable({ timetable, entry })
            return
          }
          if (info.event.extendedProps.kind === 'task') {
            const task = tasks.find(item => item.id === info.event.extendedProps.originalId)
            if (task) setOpenedTask(task)
            return
          }
          if (manager) {
            const assignment = assignments.find(item => item.id === info.event.extendedProps.originalId)
            if (assignment) setOpened(assignment)
          } else {
            const assignment = userAssignments.find(item => item.id === info.event.extendedProps.originalId)
            if (assignment) setOpenedUser(assignment)
          }
        }}
        eventContent={info => <div className="min-w-0 px-1 py-0.5"><p className="truncate font-extrabold">{info.event.extendedProps.kind === 'task' ? 'Task · ' : info.event.extendedProps.kind === 'timetable' ? 'Class · ' : ''}{info.event.title}</p><p className="truncate text-[10px] opacity-85">{info.event.extendedProps.detail}</p></div>}
        nowIndicator
        allDaySlot={false}
        slotMinTime="00:00:00"
        slotMaxTime="24:00:00"
        scrollTime="00:00:00"
        scrollTimeReset={false}
        slotDuration="00:30:00"
        slotLabelInterval="01:00:00"
        slotLabelFormat={{ hour: 'numeric', meridiem: 'short' }}
        stickyHeaderDates
        expandRows
        height="100%"
        eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
      />
      {!events.length && <p className="pointer-events-none absolute bottom-8 left-1/2 z-10 -translate-x-1/2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-sm text-slate-500 shadow-sm">{eventFilter === 'assignments' ? 'No assignments are scheduled.' : eventFilter === 'tasks' ? 'No tasks with deadlines are scheduled.' : eventFilter === 'timetables' ? 'No published classes are scheduled.' : manager ? 'Create an assignment, task, or timetable to see it here.' : 'No assignments, tasks, or classes are scheduled yet.'}</p>}
    </section>
    {opened && <AssignmentModal assignment={opened} submissions={submissions} accounts={accounts} close={() => setOpened(null)} />}
    {openedUser && <UserAssignmentModal assignment={openedUser} close={() => setOpenedUser(null)} />}
    {openedTask && <TaskCalendarModal task={openedTask} close={() => setOpenedTask(null)} />}
    {openedTimetable && <TimetableCalendarModal {...openedTimetable} close={() => setOpenedTimetable(null)} />}
  </section>
}

function UserAssignmentModal({ assignment, close }: { assignment: UserAssignment; close: () => void }) {
  const state = stateOf(assignment)
  const attemptsExhausted = (assignment.attemptsUsed || 0) >= (assignment.maxAttempts || 1)
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={close}><section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onMouseDown={event => event.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold tracking-widest text-indigo-600">ASSIGNMENT DETAILS</p><h2 className="mt-2 text-2xl font-black">{assignment.assignmentName || assignment.testTitle}</h2><p className="mt-1 text-sm text-slate-600">{assignment.testTitle}</p></div><button type="button" onClick={close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Close</button></div><dl className="mt-6 space-y-4 rounded-xl bg-slate-50 p-4 text-sm"><div><dt className="font-bold text-slate-500">Status</dt><dd className="mt-1 font-bold capitalize text-slate-900">{state}</dd></div><div><dt className="font-bold text-slate-500">Starts</dt><dd className="mt-1 text-slate-900">{(assignment.startAt?.toDate() || assignment.createdAt?.toDate())?.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</dd></div><div><dt className="font-bold text-slate-500">Ends</dt><dd className="mt-1 text-slate-900">{assignment.deadline.toDate().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</dd></div><div><dt className="font-bold text-slate-500">Attempts</dt><dd className="mt-1 text-slate-900">{assignment.attemptsUsed || 0} of {assignment.maxAttempts || 1} used</dd></div></dl>{state === 'live' && !attemptsExhausted && <Link href={`/tests/${assignment.testId}${assignment.assignmentBatchId ? `?assignment=${encodeURIComponent(assignment.assignmentBatchId)}` : ''}`} className="mt-5 block rounded-xl bg-indigo-600 px-4 py-3 text-center text-sm font-black text-white hover:bg-indigo-700">Start assignment</Link>}</section></div>
}

function TaskCalendarModal({ task, close }: { task: CalendarTask; close: () => void }) {
  const start = task.startAt?.toDate() || task.createdAt?.toDate()
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={close}><section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onMouseDown={event => event.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-bold tracking-widest text-indigo-600">TASK DETAILS</p>{task.taskType === 'submission' && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-700">SUBMISSION</span>}</div><h2 className="mt-2 text-2xl font-black">{task.title}</h2><p className="mt-1 text-sm font-semibold text-indigo-700">{task.organisationName || task.createdByName || 'Institute'}</p></div><button type="button" onClick={close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Close</button></div><p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-slate-600">{task.description}</p><dl className="mt-6 space-y-4 rounded-xl bg-slate-50 p-4 text-sm">{start && <div><dt className="font-bold text-slate-500">Starts</dt><dd className="mt-1 text-slate-900">{start.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>}<div><dt className="font-bold text-slate-500">Deadline</dt><dd className="mt-1 text-slate-900">{task.endAt?.toDate().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</dd></div></dl><a href="/tasks" className="mt-6 block rounded-xl bg-indigo-600 px-4 py-3 text-center text-sm font-black text-white hover:bg-indigo-700">Open task board</a></section></div>
}

function TimetableCalendarModal({ timetable, entry, close }: { timetable: CalendarTimetable; entry: TimetableEntry; close: () => void }) {
  const days = daysForTimetableEntry(entry).map(day => timetableWeekdays[day]).join(', ')
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={close}><section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onMouseDown={event => event.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold tracking-widest text-indigo-600">TIMETABLE CLASS</p><h2 className="mt-2 text-2xl font-black">{entry.subject}</h2><p className="mt-1 text-sm font-semibold text-indigo-700">{timetable.organisationName} · {timetable.name}</p></div><button type="button" onClick={close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Close</button></div><dl className="mt-6 space-y-4 rounded-xl bg-slate-50 p-4 text-sm"><div><dt className="font-bold text-slate-500">Schedule</dt><dd className="mt-1 text-slate-900">{days}, {entry.startTime}–{entry.endTime}</dd></div><div><dt className="font-bold text-slate-500">Effective dates</dt><dd className="mt-1 text-slate-900">{timetable.effectiveFrom} – {timetable.effectiveTo}</dd></div>{entry.teacher && <div><dt className="font-bold text-slate-500">Teacher</dt><dd className="mt-1 text-slate-900">{entry.teacher}</dd></div>}{entry.location && <div><dt className="font-bold text-slate-500">Room or location</dt><dd className="mt-1 text-slate-900">{entry.location}</dd></div>}{entry.notes && <div><dt className="font-bold text-slate-500">Notes</dt><dd className="mt-1 whitespace-pre-wrap text-slate-900">{entry.notes}</dd></div>}</dl>{entry.meetingUrl && <a href={entry.meetingUrl} target="_blank" rel="noreferrer" className="mt-5 block rounded-xl bg-indigo-600 px-4 py-3 text-center text-sm font-black text-white hover:bg-indigo-700">Open meeting link</a>}<Link href="/timetables" className="mt-3 block text-center text-sm font-black text-indigo-700 hover:underline">View all timetables</Link></section></div>
}

function Legend({ color, label }: { color: string; label: string }) { return <span className="inline-flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${color}`} />{label}</span> }
