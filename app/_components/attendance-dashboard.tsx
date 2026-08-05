'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import ReactECharts from 'echarts-for-react'
import { useAuth } from './auth-context'
import type {
  AttendanceSession,
  AttendanceSummary,
} from '@/lib/attendance'
import { attendanceSeries, attendanceSummary } from '@/lib/attendance'
import { WorkDataLoading } from './work-data-loading'
import { useBrand } from './brand-provider'

type AttendanceSeriesItem = { date: string; present: number; absent: number; percentage: number | null }
type OrganisationOption = { organisationId: string; organisationName: string; memberRole: 'student' | 'teacher' }
type PendingOccurrence = {
  id: string
  timetableId: string
  timetableVersionId?: string
  timetableName: string
  organisationId: string
  organisationName: string
  entryId: string
  timetableEntryId?: string
  subject: string
  classDate: string
  startTime: string
  endTime: string
  teacherUserId?: string
  teacher?: string
  status: 'pending' | 'draft'
}
type AttendancePayload = {
  mode: 'organisation' | 'teaching' | 'student'
  from: string
  to: string
  organisations: OrganisationOption[]
  canTeach: boolean
  summary: AttendanceSummary
  series: AttendanceSeriesItem[]
  sessions: AttendanceSession[]
  pending: PendingOccurrence[]
}

function localDateInput(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function daysAgo(amount: number) {
  const date = new Date()
  date.setDate(date.getDate() - amount)
  return localDateInput(date)
}

export function AttendanceDashboard({
  classesOnly = false,
}: {
  classesOnly?: boolean
}) {
  const brand = useBrand()
  const { user, profile } = useAuth()
  const [mode, setMode] = useState<'teaching' | 'student'>('teaching')
  const [from, setFrom] = useState(classesOnly ? daysAgo(30) : daysAgo(29))
  const [to, setTo] = useState(localDateInput())
  const [organisationId, setOrganisationId] = useState('')
  const [timetableId, setTimetableId] = useState('')
  const [entryId, setEntryId] = useState('')
  const [teacherUserId, setTeacherUserId] = useState('')
  const [payload, setPayload] = useState<AttendancePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const showInstituteFilter = profile?.role !== 'organisation'

  const load = useCallback(async () => {
    if (!user) return
    const token = await user.getIdToken()
    setLoading(true)
    setMessage('')
    try {
      const parameters = new URLSearchParams({ from, to })
      if (profile?.role === 'user') parameters.set('mode', classesOnly ? 'teaching' : mode)
      if (organisationId) parameters.set('organisationId', organisationId)
      const response = await fetch(`/api/attendance?${parameters}`, {
        headers: { authorization: `Bearer ${token}` },
      })
      const result = await response.json().catch(() => ({})) as AttendancePayload & { error?: string }
      if (!response.ok) throw new Error(result.error || 'Unable to load attendance.')
      setPayload(result)
      if (profile?.role === 'user' && result.mode !== mode && !classesOnly) setMode(result.mode === 'teaching' ? 'teaching' : 'student')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to load attendance.')
    } finally {
      setLoading(false)
    }
  }, [classesOnly, from, mode, organisationId, profile, to, user])

  // The request starts asynchronously; state changes happen after token resolution.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const view = useMemo(() => {
    if (!payload) return null
    const matches = (item: { timetableId: string; entryId: string; teacherUserId?: string }) => (
      (!timetableId || item.timetableId === timetableId)
      && (!entryId || item.entryId === entryId)
      && (!teacherUserId || item.teacherUserId === teacherUserId)
    )
    const sessions = payload.sessions.filter(matches)
    const pending = payload.pending.filter(matches)
    return {
      ...payload,
      sessions,
      pending,
      summary: attendanceSummary(sessions, pending.length),
      series: attendanceSeries(sessions),
    }
  }, [entryId, payload, teacherUserId, timetableId])

  const chartOption = useMemo(() => ({
    tooltip: { trigger: 'axis' },
    legend: { data: ['Present', 'Absent', 'Attendance %'], bottom: 0 },
    grid: { left: 42, right: 46, top: 30, bottom: 54 },
    xAxis: { type: 'category', data: view?.series.map(item => item.date.slice(5)) || [] },
    yAxis: [
      { type: 'value', minInterval: 1, name: 'Students' },
      { type: 'value', min: 0, max: 100, name: '%' },
    ],
    series: [
      { name: 'Present', type: 'bar', stack: 'count', data: view?.series.map(item => item.present) || [], itemStyle: { color: '#10b981' } },
      { name: 'Absent', type: 'bar', stack: 'count', data: view?.series.map(item => item.absent) || [], itemStyle: { color: '#fb7185' } },
      { name: 'Attendance %', type: 'line', yAxisIndex: 1, smooth: true, data: view?.series.map(item => item.percentage == null ? null : Math.round(item.percentage)) || [], itemStyle: { color: brand.primaryColor }, lineStyle: { width: 3 } },
    ],
  }), [brand.primaryColor, view?.series])

  const today = localDateInput()
  const classItems = useMemo(() => {
    if (!view) return []
    const pending = view.pending.map(item => ({ type: 'pending' as const, item }))
    const completed = view.sessions.map(item => ({ type: 'session' as const, item }))
    return [...pending, ...completed].sort((first, second) => {
      const firstItem = first.item
      const secondItem = second.item
      return `${secondItem.classDate} ${secondItem.startTime}`.localeCompare(`${firstItem.classDate} ${firstItem.startTime}`)
    })
  }, [view])

  if (loading) return <WorkDataLoading label={classesOnly ? 'classes' : 'attendance'} />

  if (classesOnly) {
    const todayItems = classItems.filter(item => item.item.classDate === today)
    const pastPending = (view?.pending || []).filter(item => item.classDate < today)
    return <section>
      <p className="text-xs font-black tracking-[0.18em] text-indigo-600">TEACHING</p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-black">My classes</h1><p className="mt-2 text-sm text-slate-600">Your assigned classes for today, with quick attendance access.</p></div><a href="/attendance" className="rounded-xl border border-indigo-300 bg-white px-4 py-2.5 text-sm font-black text-indigo-700">Open analytics</a></div>
      <AttendanceFilters from={from} to={to} organisationId={organisationId} organisations={payload?.organisations.filter(item => item.memberRole === 'teacher') || []} showInstitute={showInstituteFilter} setFrom={setFrom} setTo={setTo} setOrganisationId={setOrganisationId} />
      {message && <Notice message={message} />}
      {!loading && <div className="mt-6 grid gap-4 lg:grid-cols-2">{todayItems.map(item => item.type === 'pending'
        ? <ClassCard key={item.item.id} occurrence={item.item} />
        : <SessionCard key={item.item.id} session={item.item} student={false} />)}
        {!todayItems.length && <Empty text="No assigned classes today." />}
      </div>}
      {!loading && pastPending.length > 0 && <section className="mt-8"><h2 className="text-xl font-black">Past attendance pending</h2><p className="mt-1 text-sm text-slate-500">Complete or cancel these scheduled classes.</p><div className="mt-4 grid gap-4 lg:grid-cols-2">{pastPending.map(item => <ClassCard key={item.id} occurrence={item} />)}</div></section>}
    </section>
  }

  const student = payload?.mode === 'student'
  return <section>
    <p className="text-xs font-black tracking-[0.18em] text-indigo-600">ATTENDANCE</p>
    <div className="mt-1 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-black">{student ? 'My attendance' : 'Attendance dashboard'}</h1><p className="mt-2 max-w-2xl text-sm text-slate-600">{student ? 'Track your attendance across joined institutes and classes.' : 'Monitor completed classes, pending registers and attendance trends.'}</p></div></div>
    <AttendanceFilters from={from} to={to} organisationId={organisationId} organisations={payload?.organisations || []} showInstitute={showInstituteFilter} timetableId={timetableId} entryId={entryId} teacherUserId={teacherUserId} sessions={payload?.sessions || []} pending={payload?.pending || []} setFrom={setFrom} setTo={setTo} setOrganisationId={value => { setOrganisationId(value); setTimetableId(''); setEntryId(''); setTeacherUserId('') }} setTimetableId={value => { setTimetableId(value); setEntryId('') }} setEntryId={setEntryId} setTeacherUserId={setTeacherUserId} />
    {message && <Notice message={message} />}
    {!loading && view && <>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Overall attendance" value={view.summary.percentage == null ? '—' : `${Math.round(view.summary.percentage)}%`} accent />
        <Metric label="Present" value={view.summary.present} />
        <Metric label="Absent" value={view.summary.absent} />
        <Metric label="Completed" value={view.summary.submittedSessions} />
        <Metric label="Cancelled" value={view.summary.cancelledSessions} />
        <Metric label="Pending" value={view.summary.pendingSessions} warn={view.summary.pendingSessions > 0} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">Attendance by date</h2><p className="mt-1 text-sm text-slate-500">Present and absent counts with the daily percentage trend.</p>{view.series.length ? <ReactECharts option={chartOption} style={{ height: 340 }} notMerge lazyUpdate /> : <Empty text="Submitted attendance will appear here." />}</section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">{student ? 'Attendance split' : 'Registers'}</h2><p className="mt-1 text-sm text-slate-500">{student ? 'Submitted classes only.' : 'Completed versus still outstanding.'}</p><AttendanceDonut present={view.summary.present} absent={view.summary.absent} /><dl className="mt-5 grid grid-cols-2 gap-3 text-sm"><SummaryRow label="Submitted" value={view.summary.submittedSessions} /><SummaryRow label="Draft" value={view.summary.draftSessions} /><SummaryRow label="Cancelled" value={view.summary.cancelledSessions} /><SummaryRow label="Pending" value={view.summary.pendingSessions} /></dl></section>
      </div>
      {!student && view.pending.length > 0 && <section className="mt-8"><h2 className="text-xl font-black">Attendance pending</h2><p className="mt-1 text-sm text-slate-500">Scheduled classes with no submitted register.</p><div className="mt-4 grid gap-4 lg:grid-cols-2">{view.pending.map(item => <ClassCard key={item.id} occurrence={item} />)}</div></section>}
      <section className="mt-8"><h2 className="text-xl font-black">{student ? 'Class history' : 'Session history'}</h2><div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">{view.sessions.map(session => <SessionRow key={session.id} session={session} student={student} />)}{!view.sessions.length && <p className="p-6 text-sm text-slate-500">No attendance sessions in this date range.</p>}</div></section>
    </>}
  </section>
}

function AttendanceFilters(props: {
  from: string
  to: string
  organisationId: string
  organisations: OrganisationOption[]
  showInstitute: boolean
  timetableId?: string
  entryId?: string
  teacherUserId?: string
  sessions?: AttendanceSession[]
  pending?: PendingOccurrence[]
  setFrom: (value: string) => void
  setTo: (value: string) => void
  setOrganisationId: (value: string) => void
  setTimetableId?: (value: string) => void
  setEntryId?: (value: string) => void
  setTeacherUserId?: (value: string) => void
}) {
  const allItems = [...(props.sessions || []), ...(props.pending || [])]
  const timetables = [...new Map(allItems.map(item => [item.timetableId, item.timetableName])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const classes = [...new Map(allItems.filter(item => !props.timetableId || item.timetableId === props.timetableId).map(item => [item.entryId, item.subject])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const teachers = [...new Map(allItems.flatMap(item => item.teacherUserId ? [[item.teacherUserId, item.teacher || 'Assigned teacher'] as const] : [])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const filterCount = 2
    + Number(props.showInstitute)
    + Number(Boolean(props.setTimetableId))
    + Number(Boolean(props.setEntryId))
    + Number(Boolean(props.setTeacherUserId))
  return <div className={`mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 ${filterCount >= 6 ? 'xl:grid-cols-6' : filterCount === 5 ? 'xl:grid-cols-5' : filterCount === 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
    <label className="text-sm font-bold">From<input type="date" value={props.from} max={props.to} onChange={event => props.setFrom(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
    <label className="text-sm font-bold">To<input type="date" value={props.to} min={props.from} max={localDateInput()} onChange={event => props.setTo(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
    {props.showInstitute && <label className="text-sm font-bold">Institute<select value={props.organisationId} onChange={event => props.setOrganisationId(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal"><option value="">All institutes</option>{props.organisations.map(item => <option key={`${item.organisationId}:${item.memberRole}`} value={item.organisationId}>{item.organisationName}</option>)}</select></label>}
    {props.setTimetableId && <label className="text-sm font-bold">Class timetable<select value={props.timetableId} onChange={event => props.setTimetableId?.(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal"><option value="">All timetables</option>{timetables.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
    {props.setEntryId && <label className="text-sm font-bold">Class<select value={props.entryId} onChange={event => props.setEntryId?.(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal"><option value="">All classes</option>{classes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
    {props.setTeacherUserId && <label className="text-sm font-bold">Teacher<select value={props.teacherUserId} onChange={event => props.setTeacherUserId?.(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal"><option value="">All teachers</option>{teachers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
  </div>
}

function ClassCard({ occurrence }: { occurrence: PendingOccurrence }) {
  const query = new URLSearchParams({
    ...(occurrence.timetableVersionId
      ? { timetableVersionId: occurrence.timetableVersionId }
      : { timetableId: occurrence.timetableId }),
    timetableEntryId: occurrence.timetableEntryId || occurrence.entryId,
    classDate: occurrence.classDate,
  })
  return <article className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-wider text-amber-700">{occurrence.status === 'draft' ? 'Draft register' : 'Attendance pending'}</p><h3 className="mt-1 text-lg font-black">{occurrence.subject}</h3><p className="mt-1 text-sm text-slate-500">{occurrence.organisationName} · {occurrence.timetableName}</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">{occurrence.classDate}</span></div><p className="mt-4 text-sm font-semibold text-slate-700">{occurrence.startTime}–{occurrence.endTime}{occurrence.teacher ? ` · ${occurrence.teacher}` : ''}</p><Link href={`/attendance/take?${query}`} className="mt-4 inline-flex rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white hover:bg-indigo-700">{occurrence.status === 'draft' ? 'Continue attendance' : 'Take attendance'}</Link></article>
}

function SessionCard({ session, student }: { session: AttendanceSession; student: boolean }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-wider text-indigo-600">{session.status}</p><h3 className="mt-1 text-lg font-black">{session.subject}</h3><p className="mt-1 text-sm text-slate-500">{session.organisationName} · {session.timetableName}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${session.status === 'submitted' ? 'bg-emerald-100 text-emerald-700' : session.status === 'cancelled' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700'}`}>{session.classDate}</span></div><p className="mt-4 text-sm font-semibold text-slate-700">{session.startTime}–{session.endTime}{session.teacher ? ` · ${session.teacher}` : ''}</p><p className="mt-2 text-sm text-slate-600">{student ? ownStatus(session) : `${session.presentCount} present · ${session.absentCount} absent`}</p><Link href={`/attendance/take?sessionId=${encodeURIComponent(session.id)}`} className="mt-4 inline-flex text-sm font-black text-indigo-700 hover:underline">{student ? 'View details' : 'Open register'}</Link></article>
}

function SessionRow({ session, student }: { session: AttendanceSession; student: boolean }) {
  const total = session.presentCount + session.absentCount
  const percentage = total ? Math.round(session.presentCount / total * 100) : null
  return <Link href={`/attendance/take?sessionId=${encodeURIComponent(session.id)}`} className="grid w-full gap-3 border-b border-slate-100 px-5 py-4 text-left last:border-0 hover:bg-indigo-50 sm:grid-cols-[1fr_8rem_8rem_7rem] sm:items-center"><div><p className="font-black text-slate-900">{session.subject}</p><p className="mt-1 text-xs text-slate-500">{session.organisationName} · {session.timetableName} · {session.classDate}</p></div><span className="text-sm font-semibold text-slate-600">{session.startTime}–{session.endTime}</span><span className="text-sm font-bold capitalize text-slate-700">{student ? ownStatus(session) : session.status}</span><span className="text-sm font-black text-indigo-700">{student ? '' : percentage == null ? '—' : `${percentage}%`}</span></Link>
}

function AttendanceDonut({ present, absent }: { present: number; absent: number }) {
  const total = present + absent
  const percentage = total ? present / total * 100 : 0
  const radius = 46
  const circumference = Math.PI * 2 * radius
  return <div className="mx-auto mt-5 grid w-fit justify-items-center"><div className="relative grid h-36 w-36 place-items-center"><svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90"><circle cx="60" cy="60" r={radius} fill="none" stroke="#fee2e2" strokeWidth="12" /><circle cx="60" cy="60" r={radius} fill="none" stroke="#10b981" strokeWidth="12" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percentage / 100)} /></svg><div className="relative text-center"><p className="text-2xl font-black">{total ? `${Math.round(percentage)}%` : '—'}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Present</p></div></div><p className="text-xs font-semibold text-slate-500">{present} present · {absent} absent</p></div>
}

function Metric({ label, value, accent = false, warn = false }: { label: string; value: string | number; accent?: boolean; warn?: boolean }) {
  return <div className={`rounded-2xl border p-4 shadow-sm ${accent ? 'border-indigo-200 bg-indigo-600 text-white' : warn ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}><p className={`text-xs font-bold ${accent ? 'text-indigo-100' : 'text-slate-500'}`}>{label}</p><p className="mt-2 text-2xl font-black">{value}</p></div>
}
function SummaryRow({ label, value }: { label: string; value: number }) { return <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs font-bold text-slate-500">{label}</dt><dd className="mt-1 text-xl font-black">{value}</dd></div> }
function Notice({ message }: { message: string }) { return <p role="status" className={`mt-5 rounded-xl p-4 text-sm font-semibold ${/unable|cannot|invalid|updated elsewhere|mark every/i.test(message) ? 'bg-rose-50 text-rose-700' : 'bg-indigo-50 text-indigo-800'}`}>{message}</p> }
function Empty({ text }: { text: string }) { return <p className="mt-4 rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">{text}</p> }
function ownStatus(session: AttendanceSession) { return session.status === 'cancelled' ? 'cancelled' : session.roster[0]?.status || 'unmarked' }
