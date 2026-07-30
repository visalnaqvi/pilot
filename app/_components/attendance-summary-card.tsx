'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useAuth } from './auth-context'

type Session = {
  id: string
  classDate: string
  subject: string
  organisationName: string
  status: string
  roster: { userId: string; status: string }[]
}

function useAttendanceRecords(studentId?: string) {
  const { user, profile } = useAuth()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!user) return
    let active = true
    const query = profile?.role === 'user' ? '?mode=student' : ''
    void user.getIdToken()
      .then(token => fetch(`/api/attendance${query}`, { headers: { authorization: `Bearer ${token}` } }))
      .then(response => response.ok ? response.json() : Promise.reject())
      .then((payload: { sessions?: Session[] }) => {
        if (active) setSessions((payload.sessions || []).filter(session => !studentId || session.roster.some(record => record.userId === studentId)))
      })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [profile?.role, studentId, user])
  const records = useMemo(() => sessions.filter(session => session.status === 'submitted').flatMap(session => {
    if (!studentId && profile?.role === 'organisation') {
      return session.roster.map(record => ({ ...session, id: `${session.id}:${record.userId}`, attendanceStatus: record.status }))
    }
    const record = studentId ? session.roster.find(item => item.userId === studentId) : session.roster[0]
    return record ? [{ ...session, attendanceStatus: record.status }] : []
  }), [profile?.role, sessions, studentId])
  return {
    records,
    present: records.filter(record => record.attendanceStatus === 'present').length,
    absent: records.filter(record => record.attendanceStatus === 'absent').length,
    loading,
  }
}

export function AttendanceOverviewCard({ student = false }: { student?: boolean }) {
  const values = useAttendanceRecords()
  const total = values.present + values.absent
  const percentage = total ? Math.round(values.present / total * 100) : null
  return <section className="mt-6 rounded-2xl border border-teal-200 bg-gradient-to-r from-teal-50 to-white p-5 shadow-sm"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center"><div><p className="text-xs font-black uppercase tracking-widest text-teal-700">Attendance</p><h2 className="mt-1 text-xl font-black">{student ? 'My attendance snapshot' : 'Institute attendance snapshot'}</h2><p className="mt-2 text-sm text-slate-600">{values.loading ? 'Loading attendance…' : total ? `${values.present} present · ${values.absent} absent in the last 30 days` : 'No submitted attendance in the last 30 days.'}</p></div><div className="flex items-center gap-5"><div className="text-center"><p className="text-3xl font-black text-teal-700">{percentage == null ? '—' : `${percentage}%`}</p><p className="mt-1 text-xs font-bold text-slate-500">Overall</p></div><Link href="/attendance" className="rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-black text-white hover:bg-teal-800">View attendance</Link></div></div></section>
}

export function StudentAttendancePanel({ studentId }: { studentId: string }) {
  const values = useAttendanceRecords(studentId)
  const total = values.present + values.absent
  const percentage = total ? values.present / total * 100 : 0
  const byDate = new Map<string, { present: number; absent: number }>()
  values.records.forEach(record => {
    const item = byDate.get(record.classDate) || { present: 0, absent: 0 }
    if (record.attendanceStatus === 'present') item.present += 1
    if (record.attendanceStatus === 'absent') item.absent += 1
    byDate.set(record.classDate, item)
  })
  const dates = [...byDate.keys()].sort()
  const option = {
    tooltip: { trigger: 'axis' },
    grid: { left: 42, right: 20, top: 28, bottom: 44 },
    xAxis: { type: 'category', data: dates.map(date => date.slice(5)) },
    yAxis: { type: 'value', min: 0, max: 100, name: '%' },
    series: [{ type: 'line', smooth: true, data: dates.map(date => {
      const item = byDate.get(date)!
      return Math.round(item.present / (item.present + item.absent) * 100)
    }), lineStyle: { color: '#0d9488', width: 3 }, itemStyle: { color: '#0d9488' }, areaStyle: { color: '#ccfbf1' } }],
  }
  if (values.loading) return <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">Loading attendance…</p>
  return <section><div className="grid gap-4 sm:grid-cols-3"><AttendanceStat label="Attendance" value={total ? `${Math.round(percentage)}%` : '—'} tone="teal" /><AttendanceStat label="Present" value={values.present} tone="emerald" /><AttendanceStat label="Absent" value={values.absent} tone="rose" /></div>{dates.length ? <div className="mt-6 rounded-xl border border-slate-200 p-4"><h3 className="font-black">Attendance by date</h3><ReactECharts option={option} style={{ height: 280 }} notMerge lazyUpdate /></div> : <p className="mt-5 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">No submitted attendance for this student in the last 30 days.</p>}<div className="mt-6 overflow-hidden rounded-xl border border-slate-200">{values.records.map(record => <div key={record.id} className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-0"><div><p className="font-bold">{record.subject}</p><p className="mt-1 text-xs text-slate-500">{record.organisationName} · {record.classDate}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${record.attendanceStatus === 'present' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{record.attendanceStatus}</span></div>)}</div></section>
}

function AttendanceStat({ label, value, tone }: { label: string; value: string | number; tone: 'teal' | 'emerald' | 'rose' }) {
  const styles = tone === 'teal' ? 'bg-teal-50 text-teal-800' : tone === 'emerald' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
  return <div className={`rounded-xl p-4 ${styles}`}><p className="text-sm font-bold">{label}</p><p className="mt-2 text-3xl font-black text-slate-950">{value}</p></div>
}
