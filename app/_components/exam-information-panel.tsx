'use client'

import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  ExamCycleDetailsSchema,
  isStale,
  sortSchedule,
  toDate,
  type ExamCatalogSummary,
  type ExamCycleDetails,
  type ExamUpdate,
} from '@/lib/exam-information'
import type { MockTest } from './test-types'
import { useAuth } from './auth-context'

export function ExamInformationPanel({ exam, stats, tests }: {
  exam: ExamCatalogSummary
  stats: { tests: number; groupUsers: number; completion: number }
  tests: MockTest[]
}) {
  const { user, isImpersonating } = useAuth()
  const [cycles, setCycles] = useState<ExamCycleDetails[]>([])
  const [updates, setUpdates] = useState<ExamUpdate[]>([])
  const [selectedCycleId, setSelectedCycleId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const examRef = doc(db, 'examCatalog', exam.id)
        const [cycleSnapshot, updateSnapshot] = await Promise.all([
          getDocs(collection(examRef, 'cycles')),
          getDocs(query(collection(examRef, 'updates'), orderBy('publishedAt', 'desc'), limit(12))),
        ])
        if (cancelled) return
        const parsedCycles = cycleSnapshot.docs.flatMap((item) => {
          const parsed = ExamCycleDetailsSchema.safeParse({ id: item.id, ...item.data() })
          return parsed.success ? [parsed.data] : []
        }).sort((left, right) => (right.year || 0) - (left.year || 0))
        setCycles(parsedCycles)
        setSelectedCycleId((current) => current || exam.activeCycleId || parsedCycles[0]?.id || '')
        setUpdates(updateSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as ExamUpdate))
        if (user && exam.lastPublishedAt && !isImpersonating) {
          // This receipt is useful for the unread badge, but it must never keep
          // already-loaded exam information behind the loading state.
          void setDoc(doc(db, 'examUpdateReads', `${user.uid}_${exam.id}`), {
            userId: user.uid,
            examId: exam.id,
            lastSeenRevisionId: exam.publishedRevisionId || null,
            lastSeenPublishedAt: exam.lastPublishedAt,
            updatedAt: serverTimestamp(),
          }, { merge: true }).catch((reason) => {
            console.warn('Could not mark exam information as read.', reason)
          })
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load exam information.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [exam.activeCycleId, exam.id, exam.lastPublishedAt, exam.publishedRevisionId, isImpersonating, user])

  const cycle = cycles.find((item) => item.id === selectedCycleId) || cycles[0]
  const checked = toDate(exam.lastCheckedAt)
  const stale = isStale(exam.lastCheckedAt)
  const dashboardSummary = <ExamDashboardSummary stats={stats} testCount={tests.length} />
  if (loading) return <div className="space-y-4">{dashboardSummary}<div className="h-24 animate-pulse rounded-2xl bg-slate-100" /><div className="h-64 animate-pulse rounded-2xl bg-slate-100" /></div>
  if (error) return <div className="space-y-4">{dashboardSummary}<Notice tone="error" title="Exam information could not be loaded">{error}</Notice></div>
  if (!cycle) {
    return <div className="space-y-6">{dashboardSummary}<Notice tone="neutral" title="Exam information pending">Run an exam web refresh to publish the latest cited details.</Notice></div>
  }

  return <div className="space-y-6">
    {dashboardSummary}
    <section className="rounded-2xl border border-slate-200 bg-gradient-to-r from-indigo-50 to-white p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Current information</p><h3 className="mt-1 text-2xl font-black">{cycle.label}</h3>{cycle.overview.summary ? <p className="mt-2 text-sm text-slate-600">{cycle.overview.summary}</p> : null}</div>{cycles.length > 1 && <label className="text-sm font-bold text-slate-700">Exam cycle<select value={cycle.id} onChange={(event) => setSelectedCycleId(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">{cycles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}</div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold"><StatusPill status={cycle.overview.status} /><span className={`rounded-full px-3 py-1 ${stale ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>{checked ? `${stale ? 'Last checked' : 'Checked'} ${formatDateTime(checked)}` : 'Check date unavailable'}</span>{Number(exam.pendingRevisionCount || 0) > 0 && <span className="rounded-full bg-violet-100 px-3 py-1 text-violet-700">AI updated · awaiting admin verification</span>}</div>
    </section>
    <ScheduleSection cycle={cycle} />
    <OverviewSection cycle={cycle} />
    <EligibilitySection cycle={cycle} />
    <PatternSection cycle={cycle} />
    <SyllabusSection cycle={cycle} />
    <ResourcesSection cycle={cycle} />
    <UpdatesSection updates={updates.filter((item) => item.cycleId === cycle.id)} />
  </div>
}

function ExamDashboardSummary({ stats, testCount }: {
  stats: { tests: number; groupUsers: number; completion: number }
  testCount: number
}) {
  const items = [
    ['Tests', testCount || stats.tests],
    ['Group users', stats.groupUsers],
    ['Completion', stats.groupUsers ? `${Math.round(stats.completion)}%` : '—'],
  ]
  return <dl className="grid gap-3 sm:grid-cols-3">{items.map(([label, value]) => <div key={label} className="rounded-xl border border-indigo-100 bg-indigo-50 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-indigo-600">{label}</dt><dd className="mt-1 text-2xl font-black text-indigo-950">{value}</dd></div>)}</dl>
}

function Notice({ tone, title, children }: { tone: 'error' | 'warning' | 'neutral'; title: string; children: React.ReactNode }) {
  const color = tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-700'
  return <div className={`rounded-2xl border p-5 ${color}`}><p className="font-black">{title}</p><p className="mt-1 text-sm">{children}</p></div>
}

function StatusPill({ status }: { status: ExamCycleDetails['overview']['status'] }) {
  return <span className="rounded-full bg-indigo-100 px-3 py-1 capitalize text-indigo-700">{(status || 'not_announced').replaceAll('_', ' ')}</span>
}

function ScheduleSection({ cycle }: { cycle: ExamCycleDetails }) {
  const events = useMemo(() => sortSchedule(cycle.schedule.events), [cycle.schedule.events])
  if (!events.length) return null
  return <ExamSection title="Important dates" source={firstSource(cycle, '/schedule')}><div className="relative ml-2 border-l-2 border-indigo-100 pl-6">{events.map((event) => <div key={event.id} className="relative pb-5 last:pb-0"><span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-indigo-600 bg-white" /><div className="flex flex-col justify-between gap-1 sm:flex-row"><div><p className="font-bold">{event.label}</p>{event.stage && <p className="text-xs text-slate-500">{event.stage}</p>}</div><div className="sm:text-right"><p className="font-semibold text-indigo-700">{formatEventDate(event)}</p><p className="text-xs capitalize text-slate-500">{event.status} · {event.precision}</p></div></div></div>)}</div></ExamSection>
}

function OverviewSection({ cycle }: { cycle: ExamCycleDetails }) {
  const hasOverview = Boolean(
    cycle.overview.summary ||
    cycle.overview.officialName ||
    cycle.overview.conductingBody ||
    cycle.overview.applicationMethod ||
    cycle.overview.vacanciesLabel
  )
  if (!hasOverview) return null
  return <ExamSection title="Exam overview" source={firstSource(cycle, '/overview')}><DetailGrid items={[['Official name', cycle.overview.officialName], ['Conducting body', cycle.overview.conductingBody], ['Application method', cycle.overview.applicationMethod], ['Vacancies / seats', cycle.overview.vacanciesLabel]]} /></ExamSection>
}

function EligibilitySection({ cycle }: { cycle: ExamCycleDetails }) {
  const item = cycle.eligibility
  const age = item.minimumAge != null || item.maximumAge != null ? `${item.minimumAge ?? '—'}–${item.maximumAge ?? '—'} years${item.ageAsOf ? ` as of ${formatIsoDate(item.ageAsOf)}` : ''}` : null
  const hasFees = item.fees.length > 0 && item.fees.some(f => f.amount != null || f.note)
  const hasEligibility = Boolean(
    item.qualifications.length ||
    item.minimumAge != null ||
    item.maximumAge != null ||
    item.nationality.length ||
    item.attemptLimit ||
    item.experience ||
    item.reservationNotes ||
    hasFees
  )
  if (!hasEligibility) return null
  return <ExamSection title="Eligibility and fees" source={firstSource(cycle, '/eligibility')}><DetailGrid items={[['Qualification', item.qualifications.join('; ') || null], ['Age limit', age], ['Nationality', item.nationality.join(', ') || null], ['Attempt limit', item.attemptLimit], ['Experience', item.experience], ['Reservation notes', item.reservationNotes]]} />{hasFees && <div className="mt-4 overflow-hidden rounded-xl border border-slate-200"><div className="grid grid-cols-[1fr_auto] bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500"><span>Category</span><span>Fee</span></div>{item.fees.map((fee, index) => <div key={`${fee.category}-${index}`} className="grid grid-cols-[1fr_auto] border-t border-slate-100 px-4 py-3 text-sm"><span>{fee.category}{fee.note ? <span className="block text-xs text-slate-500">{fee.note}</span> : null}</span><span className="font-bold">{fee.amount == null ? 'Not announced' : `${fee.currency} ${fee.amount}`}</span></div>)}</div>}</ExamSection>
}

function PatternSection({ cycle }: { cycle: ExamCycleDetails }) {
  if (!cycle.pattern.stages.length) return null
  return <ExamSection title="Exam pattern" source={firstSource(cycle, '/pattern')}><div className="space-y-4">{cycle.pattern.stages.map((stage) => <article key={stage.id} className="rounded-xl border border-slate-200 p-4"><h5 className="font-black">{stage.name}</h5><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><SmallFact label="Mode" value={stage.mode} /><SmallFact label="Duration" value={stage.durationMinutes ? `${stage.durationMinutes} min` : null} /><SmallFact label="Questions" value={stage.questionCount} /><SmallFact label="Marks" value={stage.totalMarks} /></div>{stage.negativeMarking && <p className="mt-3 text-sm"><span className="font-bold">Negative marking:</span> {stage.negativeMarking}</p>}{stage.qualifyingRule && <p className="mt-2 text-sm"><span className="font-bold">Qualifying rule:</span> {stage.qualifyingRule}</p>}{stage.sections.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{stage.sections.map((section) => <span key={section.name} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold">{section.name}{section.questions != null ? ` · ${section.questions} Q` : ''}{section.marks != null ? ` · ${section.marks} marks` : ''}</span>)}</div>}</article>)}</div></ExamSection>
}

function SyllabusSection({ cycle }: { cycle: ExamCycleDetails }) {
  if (!cycle.syllabus.groups.length) return null
  return <ExamSection title="Syllabus" source={firstSource(cycle, '/syllabus')}><div className="space-y-3">{cycle.syllabus.groups.map((group, index) => <details key={`${group.stage}-${group.subject}-${index}`} className="rounded-xl border border-slate-200 p-4" open={index === 0}><summary className="cursor-pointer font-bold">{group.stage ? `${group.stage} · ` : ''}{group.subject}</summary><div className="mt-3 flex flex-wrap gap-2">{group.topics.map((topic) => <span key={topic} className="rounded-full bg-indigo-50 px-3 py-1.5 text-sm text-indigo-800">{topic}</span>)}</div>{group.notes && <p className="mt-3 text-sm text-slate-600">{group.notes}</p>}</details>)}</div></ExamSection>
}

function ResourcesSection({ cycle }: { cycle: ExamCycleDetails }) {
  if (!cycle.links.length) return null
  return <ExamSection title="Official resources" source={firstSource(cycle, '/resources')}><div className="grid gap-3 sm:grid-cols-2">{cycle.links.map((link) => <a key={`${link.kind}-${link.url}`} href={link.url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 p-4 font-bold text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50"><span className="block text-xs uppercase tracking-wide text-slate-500">{link.kind}</span><span className="mt-1 block">{link.label} ↗</span></a>)}</div></ExamSection>
}

function UpdatesSection({ updates }: { updates: ExamUpdate[] }) {
  if (!updates.length) return null
  return <ExamSection title="Recent updates">{<div className="space-y-3">{updates.map((update) => <article key={update.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-col justify-between gap-1 sm:flex-row"><div className="flex flex-wrap items-center gap-2"><p className="font-bold capitalize">{update.section.replaceAll('_', ' ')}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${update.verificationStatus === 'pending' ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'}`}>{update.verificationStatus === 'pending' ? 'AI update · pending verification' : 'Verified'}</span></div><p className="text-xs text-slate-500">{formatDateTime(toDate(update.publishedAt))}</p></div><p className="mt-2 text-sm text-slate-700">{update.summary}</p><a href={update.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-bold text-indigo-600 hover:underline">{update.sourceTitle} ↗</a></article>)}</div>}</ExamSection>
}


function ExamSection({ title, source, children }: { title: string; source?: { url: string; sourceTitle: string }; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between gap-3"><h4 className="text-xl font-black">{title}</h4>{source && <a href={source.url} title={source.sourceTitle} target="_blank" rel="noreferrer" className="text-xs font-bold text-indigo-600 hover:underline">Source ↗</a>}</div><div className="mt-4">{children}</div></section>
}

function DetailGrid({ items }: { items: (string | number | null)[][] }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map(([label, value]) => <SmallFact key={String(label)} label={String(label)} value={value} />)}</div>
}

function SmallFact({ label, value }: { label: string; value: string | number | null }) {
  if (value == null) return null
  return <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-900">{value}</p></div>
}

function firstSource(cycle: ExamCycleDetails, path: string) {
  const item = Object.entries(cycle.evidence).find(([key]) => key === path || key.startsWith(`${path}/`))?.[1]?.[0]
  return item ? { url: item.url, sourceTitle: item.sourceTitle } : undefined
}

function formatIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(year, month - 1, day))
}

function formatEventDate(event: ExamCycleDetails['schedule']['events'][number]) {
  if (!event.startDate) return event.dateText || 'To be announced'
  const start = formatIsoDate(event.startDate)
  return event.endDate && event.endDate !== event.startDate ? `${start} – ${formatIsoDate(event.endDate)}` : start
}

function formatDateTime(value: Date | null) {
  return value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(value) : 'Date unavailable'
}
