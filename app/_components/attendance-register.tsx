'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AttendanceRosterEntry, AttendanceSession } from '@/lib/attendance'
import { useAuth } from './auth-context'
import { WorkDataLoading } from './work-data-loading'

type AttendanceRegisterProps = {
  sessionId?: string
  timetableId?: string
  timetableVersionId?: string
  timetableEntryId?: string
  classDate?: string
}

type AttendanceHistoryEntry = {
  id: string
  revision: number
  actorUserId: string
  createdAt: string
}

export function AttendanceRegister(props: AttendanceRegisterProps) {
  const { user } = useAuth()
  const [session, setSession] = useState<AttendanceSession | null>(null)
  const [roster, setRoster] = useState<AttendanceRosterEntry[]>([])
  const [history, setHistory] = useState<AttendanceHistoryEntry[]>([])
  const [canManage, setCanManage] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const loadSession = useCallback(async (id: string, token: string) => {
    const response = await fetch(`/api/attendance/sessions/${encodeURIComponent(id)}`, {
      cache: 'no-store',
      headers: { authorization: `Bearer ${token}` },
    })
    const result = await response.json().catch(() => ({})) as {
      session?: AttendanceSession
      history?: AttendanceHistoryEntry[]
      canManage?: boolean
      error?: string
    }
    if (!response.ok || !result.session) throw new Error(result.error || 'Unable to load this attendance register.')
    setSession(result.session)
    setRoster(result.session.roster.map(student => ({
      ...student,
      status: student.status || 'unmarked',
    })))
    setHistory(result.history || [])
    setCanManage(Boolean(result.canManage))
  }, [])

  const openRegister = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setMessage('')
    try {
      const token = await user.getIdToken()
      let id = props.sessionId
      if (!id) {
        if (
          (!props.timetableId && !props.timetableVersionId)
          || !props.timetableEntryId
          || !props.classDate
        ) throw new Error('This attendance link is incomplete. Return to the timetable and open the class again.')
        const response = await fetch('/api/attendance/sessions', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            timetableId: props.timetableId,
            timetableVersionId: props.timetableVersionId,
            timetableEntryId: props.timetableEntryId,
            classDate: props.classDate,
          }),
        })
        const result = await response.json().catch(() => ({})) as { id?: string; session?: { id: string }; error?: string }
        if (!response.ok) throw new Error(result.error || 'Unable to open this attendance register.')
        id = result.id || result.session?.id
        if (!id) throw new Error('The attendance register could not be created.')
      }
      await loadSession(id, token)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to open this attendance register.')
    } finally {
      setLoading(false)
    }
  }, [
    loadSession,
    props.classDate,
    props.sessionId,
    props.timetableEntryId,
    props.timetableId,
    props.timetableVersionId,
    user,
  ])

  // The authenticated request starts asynchronously after the page mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void openRegister() }, [openRegister])

  const visibleRoster = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return roster
    return roster.filter(student => `${student.userName} ${student.userEmail}`.toLowerCase().includes(query))
  }, [roster, search])

  const present = roster.filter(student => student.status === 'present').length
  const absent = roster.filter(student => student.status === 'absent').length
  const marked = present + absent
  const complete = roster.length > 0 && marked === roster.length

  function mark(userId: string, status: 'present' | 'absent') {
    setRoster(current => current.map(student => student.userId === userId ? { ...student, status } : student))
    setMessage('')
  }

  function markAll(status: 'present' | 'absent') {
    setRoster(current => current.map(student => ({ ...student, status })))
    setMessage('')
  }

  async function submitAttendance() {
    if (!user || !session || saving) return
    if (!complete) {
      setMessage(roster.length ? 'Mark every student before submitting attendance.' : 'There are no students assigned to this register.')
      return
    }
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch(`/api/attendance/sessions/${encodeURIComponent(session.id)}`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${await user.getIdToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          status: 'submitted',
          marks: roster.map(student => ({ userId: student.userId, mark: student.status })),
          cancellationReason: null,
        }),
      })
      const result = await response.json().catch(() => ({})) as { session?: AttendanceSession; error?: string }
      if (!response.ok || !result.session) throw new Error(result.error || 'Unable to submit attendance.')
      setSession(result.session)
      setRoster(result.session.roster)
      setMessage(result.session.status === 'submitted' ? 'Attendance submitted successfully.' : 'Attendance saved.')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to submit attendance.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <WorkDataLoading label="attendance register" />

  if (!session) {
    return <section className="mx-auto max-w-3xl">
      <Link href="/attendance" className="text-sm font-black text-indigo-700 hover:underline">← Back to attendance</Link>
      <div className="mt-5 rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-black tracking-[0.18em] text-rose-600">REGISTER UNAVAILABLE</p>
        <h1 className="mt-2 text-2xl font-black">Attendance could not be opened</h1>
        <p role="alert" className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
      </div>
    </section>
  }

  const readonly = !canManage || session.status === 'cancelled'

  return <section className="mx-auto max-w-5xl">
    <Link href="/attendance" className="text-sm font-black text-indigo-700 hover:underline">← Back to attendance</Link>
    <header className="mt-5 rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-xs font-black tracking-[0.2em] text-indigo-300">ATTENDANCE REGISTER</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{session.subject || 'Class attendance'}</h1>
          <p className="mt-3 text-sm font-semibold text-slate-300">
            {[session.organisationName, session.timetableName].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-wide ${
          session.status === 'submitted'
            ? 'bg-emerald-400/20 text-emerald-200'
            : session.status === 'cancelled'
              ? 'bg-slate-400/20 text-slate-200'
              : 'bg-amber-400/20 text-amber-200'
        }`}>{session.status}</span>
      </div>
      <dl className="mt-7 grid gap-3 sm:grid-cols-3">
        <ClassDetail label="Class date" value={session.classDate} />
        <ClassDetail label="Time" value={session.startTime && session.endTime ? `${session.startTime}–${session.endTime}` : 'Not specified'} />
        <ClassDetail label="Teacher" value={session.teacher || 'Assigned teacher'} />
      </dl>
    </header>

    {session.status === 'cancelled' && <p className="mt-5 rounded-2xl border border-slate-200 bg-slate-100 p-4 text-sm font-semibold text-slate-700">
      This class was cancelled{session.cancellationReason ? `: ${session.cancellationReason}` : '.'}
    </p>}

    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="block flex-1 text-sm font-black text-slate-800">
            Find a student
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search by name or email"
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          {!readonly && <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => markAll('present')} className="rounded-xl border border-emerald-300 px-3 py-3 text-sm font-black text-emerald-700 hover:bg-emerald-50">All present</button>
            <button type="button" onClick={() => markAll('absent')} className="rounded-xl border border-rose-300 px-3 py-3 text-sm font-black text-rose-700 hover:bg-rose-50">All absent</button>
          </div>}
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
          {visibleRoster.map(student => <div key={student.userId} className="flex flex-col gap-3 border-b border-slate-100 p-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate font-black text-slate-900">{student.userName}</p>
              <p className="mt-1 truncate text-xs text-slate-500">{student.userEmail}</p>
            </div>
            {readonly
              ? <StatusBadge status={student.status} />
              : <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={student.status === 'present'}
                  onClick={() => mark(student.userId, 'present')}
                  className={`rounded-xl px-4 py-2.5 text-sm font-black ${student.status === 'present' ? 'bg-emerald-600 text-white shadow-sm' : 'border border-slate-300 text-slate-600 hover:bg-emerald-50'}`}
                >
                  Present
                </button>
                <button
                  type="button"
                  aria-pressed={student.status === 'absent'}
                  onClick={() => mark(student.userId, 'absent')}
                  className={`rounded-xl px-4 py-2.5 text-sm font-black ${student.status === 'absent' ? 'bg-rose-600 text-white shadow-sm' : 'border border-slate-300 text-slate-600 hover:bg-rose-50'}`}
                >
                  Absent
                </button>
              </div>}
          </div>)}
          {!visibleRoster.length && <p className="p-6 text-center text-sm text-slate-500">
            {roster.length ? 'No students match your search.' : 'No students are assigned to this class.'}
          </p>}
        </div>
      </section>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-widest text-slate-400">Progress</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{marked}/{roster.length}</p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${roster.length ? marked / roster.length * 100 : 0}%` }} />
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3">
            <SummaryStat label="Present" value={present} tone="emerald" />
            <SummaryStat label="Absent" value={absent} tone="rose" />
          </dl>
          {canManage && session.status !== 'cancelled' && <button
            type="button"
            disabled={saving || !complete}
            onClick={() => void submitAttendance()}
            className="mt-5 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Submitting…' : session.status === 'submitted' ? 'Save correction' : 'Submit attendance'}
          </button>}
          {message && <p role="status" className={`mt-4 rounded-xl p-3 text-sm font-semibold ${/success|saved/i.test(message) ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{message}</p>}
        </section>

        {history.length > 0 && <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer text-sm font-black text-slate-800">Change history ({history.length})</summary>
          <div className="mt-4 space-y-3">
            {history.map(item => <p key={item.id} className="text-xs leading-5 text-slate-500">
              Revision {item.revision} · {new Date(item.createdAt).toLocaleString()}
            </p>)}
          </div>
        </details>}
      </aside>
    </div>
  </section>
}

function ClassDetail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-white/10 px-4 py-3">
    <dt className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</dt>
    <dd className="mt-1 text-sm font-black text-white">{value}</dd>
  </div>
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'rose' }) {
  return <div className={`rounded-xl p-3 ${tone === 'emerald' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
    <dt className="text-xs font-bold">{label}</dt>
    <dd className="mt-1 text-2xl font-black">{value}</dd>
  </div>
}

function StatusBadge({ status }: { status: AttendanceRosterEntry['status'] }) {
  const style = status === 'present'
    ? 'bg-emerald-100 text-emerald-700'
    : status === 'absent'
      ? 'bg-rose-100 text-rose-700'
      : 'bg-slate-100 text-slate-600'
  return <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-black capitalize ${style}`}>{status}</span>
}
