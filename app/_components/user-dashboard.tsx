'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import ReactECharts from 'echarts-for-react'
import { authenticatedFetch } from '@/lib/authenticated-fetch'
import { useAuth } from './auth-context'
import { SearchPicker } from './search-picker'
import { paginate, Pagination } from './pagination'
import { SubmissionReviewButton } from './submission-answers-modal'
import type { Submission } from './test-types'
import { AttendanceOverviewCard } from './attendance-summary-card'
import { chartDateKey, sortedChartDateKeys } from '@/lib/chart-dates'

type TestInfo = {
  exam: string
  examId?: string
  category: string
  organisationId?: string
  createdBy?: string
}
type JoinedOrganisation = {
  id: string
  name: string
  email: string
}
type ExamInsight = {
  name: string
  tests: number
  attempts: number
  average: number
  best: number
  accuracy: number
}
const scorePercent = (item: Submission) => item.totalMarks ? item.score / item.totalMarks * 100 : 0
const accuracyPercent = (item: Submission) => item.questionCount ? item.correctAnswers / item.questionCount * 100 : 0
const submittedAt = (item: Submission) => {
  if (!item.submittedAt) return undefined
  return typeof item.submittedAt === 'string' ? new Date(item.submittedAt) : item.submittedAt.toDate()
}
const dateKey = (item: Submission) => {
  return chartDateKey(submittedAt(item))
}

export function UserDashboard() {
  const { user, profile } = useAuth()
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [testInfo, setTestInfo] = useState<Record<string, TestInfo>>({})
  const [organisations, setOrganisations] = useState<JoinedOrganisation[]>([])
  const [openedExam, setOpenedExam] = useState<ExamInsight | null>(null)
  const [error, setError] = useState('')
  const [examPage, setExamPage] = useState(1)

  useEffect(() => {
    if (!user || profile?.role !== 'user') return
    let active = true
    void Promise.all([
      authenticatedFetch(user, '/api/test-submissions', { cache: 'no-store' }),
      authenticatedFetch(user, '/api/organizations', { cache: 'no-store' }),
      authenticatedFetch(user, '/api/tests', { cache: 'no-store' }),
    ]).then(async ([submissionResponse, organizationResponse, testResponse]) => {
      const [submissionData, organizationData, testData] = await Promise.all([
        submissionResponse.json(),
        organizationResponse.json(),
        testResponse.json(),
      ])
      if (!submissionResponse.ok) throw new Error(submissionData.error || 'Unable to load submissions.')
      if (!organizationResponse.ok) throw new Error(organizationData.error || 'Unable to load institutes.')
      if (!testResponse.ok) throw new Error(testData.error || 'Unable to load tests.')
      if (!active) return
      setSubmissions(((submissionData.items || []) as Submission[])
        .filter(item => item.gradingStatus !== 'pending')
        .sort((a, b) => (submittedAt(b)?.getTime() || 0) - (submittedAt(a)?.getTime() || 0)))
      setOrganisations((organizationData.items || []).map((item: { id: string; name: string }) => ({
        id: item.id,
        name: item.name,
        email: '',
      })).sort((a: JoinedOrganisation, b: JoinedOrganisation) => a.name.localeCompare(b.name)))
      setTestInfo(Object.fromEntries((testData.items || []).map((item: {
        id: string
        exam?: string
        examId?: string
        category?: string
        organisationId?: string
        createdBy?: string
      }) => [item.id, {
        exam: item.exam || 'Unassigned',
        examId: item.examId,
        category: item.category || 'Uncategorised',
        organisationId: item.organisationId,
        createdBy: item.createdBy,
      }])))
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load dashboard.')
    })
    return () => { active = false }
  }, [profile?.role, user])

  const examOf = useCallback((item: Submission) => item.testExam || testInfo[item.testId]?.exam || 'Unassigned', [testInfo])
  const filtered = submissions

  const insights = useMemo(() => {
    const average = filtered.length ? filtered.reduce((sum, item) => sum + scorePercent(item), 0) / filtered.length : 0
    const accuracy = filtered.length ? filtered.reduce((sum, item) => sum + accuracyPercent(item), 0) / filtered.length : 0
    const byExam = new Map<string, Submission[]>()
    filtered.forEach(item => {
      const examName = examOf(item)
      byExam.set(examName, [...(byExam.get(examName) || []), item])
    })
    const exams: ExamInsight[] = [...byExam.entries()].map(([name, attempts]) => ({
      name,
      tests: new Set(attempts.map(item => item.testId)).size,
      attempts: attempts.length,
      average: attempts.reduce((sum, item) => sum + scorePercent(item), 0) / attempts.length,
      best: Math.max(...attempts.map(scorePercent)),
      accuracy: attempts.reduce((sum, item) => sum + accuracyPercent(item), 0) / attempts.length,
    })).sort((a, b) => b.attempts - a.attempts)
    const strongest = exams.slice().sort((a, b) => b.average - a.average)[0]
    const focus = exams.slice().sort((a, b) => a.average - b.average)[0]
    const recent = filtered.slice(0, 3)
    const previous = filtered.slice(3, 6)
    const recentAverage = recent.length ? recent.reduce((sum, item) => sum + scorePercent(item), 0) / recent.length : 0
    const previousAverage = previous.length ? previous.reduce((sum, item) => sum + scorePercent(item), 0) / previous.length : 0
    return {
      average,
      accuracy,
      exams,
      strongest,
      focus,
      trend: previous.length ? recentAverage - previousAverage : 0,
      uniqueTests: new Set(filtered.map(item => item.testId)).size,
    }
  }, [examOf, filtered])
  const visibleExams = paginate(insights.exams, examPage)

  if (profile?.role !== 'user') return null
  return <section>
    <p className="text-sm font-bold tracking-widest text-indigo-600">EXAM INTELLIGENCE</p>
    <div className="mt-1 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <h1 className="text-4xl font-bold">My exam dashboard</h1>
        <p className="mt-3 max-w-2xl text-slate-600">Explore your scores, accuracy and practice trends across exams and joined institutes.</p>
      </div>
      <Link href="/tests" className="rounded-xl bg-indigo-600 px-5 py-3 text-center font-bold text-white">Find a test</Link>
    </div>

    <div className="mt-8 grid overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200/60 sm:grid-cols-2 lg:grid-cols-4">
      <DashboardMetric icon="tests" label="Tests completed" value={insights.uniqueTests} note={`${filtered.length} total attempt${filtered.length === 1 ? '' : 's'}`} />
      <DashboardMetric icon="attempts" label="Average score" value={filtered.length ? `${Math.round(insights.average)}%` : '—'} note="Across all your attempts" />
      <DashboardMetric icon="accuracy" label="Answer accuracy" value={filtered.length ? `${Math.round(insights.accuracy)}%` : '—'} note="Correct answers across tests" />
      <DashboardMetric icon="organisation" label="Joined institutes" value={organisations.length} note="Filter by institute in exam details" />
    </div>
    <AttendanceOverviewCard student />

    {error && <p className="mt-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">Could not fully load your dashboard data: {error}</p>}

    <div className="mt-6 grid gap-6 xl:grid-cols-2">
      <InsightCard tone="emerald" label="Strongest exam" title={insights.strongest?.name || '—'} detail={insights.strongest ? `${Math.round(insights.strongest.average)}% average across ${insights.strongest.attempts} attempt${insights.strongest.attempts === 1 ? '' : 's'}` : 'Your strongest exam will appear after your first attempt.'} />
      <InsightCard tone="orange" label="Recommended practice focus" title={insights.focus?.name || '—'} detail={insights.focus ? `${Math.round(insights.focus.average)}% average · ${insights.trend >= 0 ? '+' : ''}${Math.round(insights.trend)} point recent trend` : 'Complete tests in more exam areas to receive a practice recommendation.'} />
    </div>

    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4"><h2 className="font-black text-slate-950">Performance by exam</h2><p className="mt-1 text-sm text-slate-500">Every value is calculated only from your attempts.</p></div>
        <div className="hidden grid-cols-[minmax(130px,1.4fr)_repeat(5,minmax(75px,1fr))] gap-3 border-b border-slate-200 px-5 py-3 text-xs font-bold tracking-wide text-slate-500 lg:grid"><span>EXAM</span><span>TESTS</span><span>ATTEMPTS</span><span>AVG SCORE</span><span>BEST</span><span>ACCURACY</span></div>
        {visibleExams.items.map(item => <button type="button" key={item.name} onClick={() => setOpenedExam(item)} className="grid w-full gap-3 border-b border-slate-100 px-5 py-4 text-left hover:bg-indigo-50 last:border-0 lg:grid-cols-[minmax(130px,1.4fr)_repeat(5,minmax(75px,1fr))] lg:items-center"><div><p className="font-bold text-slate-950">{item.name}</p><p className="mt-1 text-xs text-slate-500">Open performance dashboard</p></div><TableCell label="Tests" value={item.tests} /><TableCell label="Attempts" value={item.attempts} /><TableCell label="Avg score" value={`${Math.round(item.average)}%`} /><TableCell label="Best" value={`${Math.round(item.best)}%`} /><TableCell label="Accuracy" value={`${Math.round(item.accuracy)}%`} /></button>)}
        {!insights.exams.length && <p className="p-6 text-slate-500">No completed tests match these filters.</p>}
        <Pagination page={visibleExams.page} totalItems={insights.exams.length} onPageChange={setExamPage} itemLabel="exams" />
    </section>
    {openedExam && <UserExamModal initialExam={openedExam} allAttempts={submissions} organisations={organisations} testInfo={testInfo} close={() => setOpenedExam(null)} />}
  </section>
}

function UserExamModal({
  initialExam,
  allAttempts,
  organisations,
  testInfo,
  close,
}: {
  initialExam: ExamInsight
  allAttempts: Submission[]
  organisations: JoinedOrganisation[]
  testInfo: Record<string, TestInfo>
  close: () => void
}) {
  const [tab, setTab] = useState<'scores' | 'attempts'>('scores')
  const [organisationId, setOrganisationId] = useState('')
  const [examName, setExamName] = useState(initialExam.name)
  const [testId, setTestId] = useState('')
  const [attemptPage, setAttemptPage] = useState(1)
  const examOf = useCallback((item: Submission) => item.testExam || testInfo[item.testId]?.exam || 'Unassigned', [testInfo])
  const belongsToOrganisation = useCallback((item: Submission, id: string) => {
    const info = testInfo[item.testId]
    const ownerId = info?.organisationId || info?.createdBy
    return ownerId === id
  }, [testInfo])
  const organisationAttempts = useMemo(
    () => organisationId ? allAttempts.filter(item => belongsToOrganisation(item, organisationId)) : allAttempts,
    [allAttempts, belongsToOrganisation, organisationId],
  )
  const examOptions = useMemo(
    () => [...new Set(organisationAttempts.map(examOf))].sort((a, b) => a.localeCompare(b)),
    [examOf, organisationAttempts],
  )
  const testOptions = useMemo(
    () => [...new Map(organisationAttempts
      .filter(item => !examName || examOf(item) === examName)
      .map(item => [item.testId, { id: item.testId, label: item.testTitle, detail: testInfo[item.testId]?.category }]))
      .values()].sort((a, b) => a.label.localeCompare(b.label)),
    [examName, examOf, organisationAttempts, testInfo],
  )
  const attempts = useMemo(
    () => organisationAttempts.filter(item => (!examName || examOf(item) === examName) && (!testId || item.testId === testId)),
    [examName, examOf, organisationAttempts, testId],
  )
  const sortedAttempts = useMemo(() => attempts.slice().sort((a, b) => (submittedAt(b)?.getTime() || 0) - (submittedAt(a)?.getTime() || 0)), [attempts])
  const visibleAttempts = paginate(sortedAttempts, attemptPage)
  const stats = useMemo(() => ({
    average: attempts.length ? attempts.reduce((sum, item) => sum + scorePercent(item), 0) / attempts.length : 0,
    best: attempts.length ? Math.max(...attempts.map(scorePercent)) : 0,
    accuracy: attempts.length ? attempts.reduce((sum, item) => sum + accuracyPercent(item), 0) / attempts.length : 0,
  }), [attempts])
  const daily = useMemo(() => {
    const values = new Map<string, Submission[]>()
    attempts.forEach(item => {
      const key = dateKey(item)
      if (key) values.set(key, [...(values.get(key) || []), item])
    })
    return values
  }, [attempts])
  const dateLabels = sortedChartDateKeys(daily.keys())
  const averageByDateOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 45, right: 18, top: 28, bottom: 55 },
    xAxis: { type: 'category', data: dateLabels, boundaryGap: false, axisLabel: { rotate: 35, color: '#64748b' }, axisTick: { show: false } },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%', color: '#64748b' }, splitLine: { lineStyle: { color: '#e2e8f0', type: 'dashed' } } },
    series: [{
      name: 'Average score',
      type: 'line',
      smooth: true,
      symbol: 'circle',
      showSymbol: true,
      symbolSize: 9,
      data: dateLabels.map(label => {
        const dateAttempts = daily.get(label) || []
        return Math.round(dateAttempts.reduce((sum, item) => sum + scorePercent(item), 0) / (dateAttempts.length || 1))
      }),
      areaStyle: { color: '#7c3aed20' },
      lineStyle: { color: '#6d4aff', width: 3 },
      itemStyle: { color: '#fff', borderColor: '#6d4aff', borderWidth: 2 },
    }],
  }
  const attemptsByDateOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 45, right: 18, top: 28, bottom: 55 },
    xAxis: { type: 'category', data: dateLabels, axisLabel: { rotate: 35, color: '#64748b' }, axisTick: { show: false } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: '#e2e8f0', type: 'dashed' } } },
    series: [{
      name: 'Attempts',
      type: 'bar',
      barMaxWidth: 32,
      data: dateLabels.map(label => daily.get(label)?.length || 0),
      itemStyle: { color: '#059669', borderRadius: [6, 6, 0, 0] },
    }],
  }
  const scoreBands = [
    { label: 'Below 50%', value: attempts.filter(item => scorePercent(item) < 50).length, color: '#f43f5e' },
    { label: '50-74%', value: attempts.filter(item => scorePercent(item) >= 50 && scorePercent(item) < 75).length, color: '#f59e0b' },
    { label: '75%+', value: attempts.filter(item => scorePercent(item) >= 75).length, color: '#10b981' },
  ]
  const distributionOption = {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [{ type: 'pie', radius: ['46%', '70%'], center: ['50%', '43%'], label: { formatter: '{b}\n{c}' }, data: scoreBands.map(item => ({ name: item.label, value: item.value, itemStyle: { color: item.color } })) }],
  }

  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={close}>
    <div className="h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()}>
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-6">
        <div><p className="text-xs font-bold tracking-widest text-indigo-600">MY EXAM DASHBOARD</p><h2 className="mt-1 text-2xl font-black text-slate-950">{examName || 'All exams'}</h2><p className="mt-2 text-sm text-slate-500">Detailed performance from your attempts only.</p></div>
        <button type="button" onClick={close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Close</button>
      </header>
      <div className="flex overflow-x-auto border-b border-slate-200 px-4">
        <button type="button" onClick={() => setTab('scores')} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-bold ${tab === 'scores' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'}`}>Score analysis</button>
        <button type="button" onClick={() => setTab('attempts')} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-bold ${tab === 'attempts' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'}`}>Attempt history</button>
      </div>
      <div className="p-6">
        <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-2 xl:grid-cols-3">
          <DashboardFilter label="Institute">
            <SearchPicker value={organisationId} options={[{ id: '', label: 'All joined institutes' }, ...organisations.map(item => ({ id: item.id, label: item.name, detail: item.email }))]} onChange={option => { setOrganisationId(option.id); setExamName(''); setTestId(''); setAttemptPage(1) }} placeholder="Search joined institutes" />
          </DashboardFilter>
          <DashboardFilter label="Exam">
            <SearchPicker value={examName} options={[{ id: '', label: 'All exams' }, ...examOptions.map(item => ({ id: item, label: item }))]} onChange={option => { setExamName(option.id); setTestId(''); setAttemptPage(1) }} placeholder="Search exams" />
          </DashboardFilter>
          <DashboardFilter label="Test">
            <SearchPicker value={testId} options={[{ id: '', label: 'All tests' }, ...testOptions]} onChange={option => { setTestId(option.id); setAttemptPage(1) }} placeholder="Search tests" />
          </DashboardFilter>
        </div>
        {tab === 'scores' && <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3"><ModalStat label="Average score" value={attempts.length ? `${Math.round(stats.average)}%` : '—'} /><ModalStat label="Best score" value={attempts.length ? `${Math.round(stats.best)}%` : '—'} /><ModalStat label="Answer accuracy" value={attempts.length ? `${Math.round(stats.accuracy)}%` : '—'} /></div>
          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <ChartCard title="Average score by date" subtitle="Your daily average for the selected filters.">{dateLabels.length ? <ReactECharts option={averageByDateOption} style={{ height: 320 }} notMerge lazyUpdate /> : <Empty text="A dated submission is needed to show your average score." />}</ChartCard>
            <ChartCard title="Number of attempts by date" subtitle="How many tests you completed on each date.">{dateLabels.length ? <ReactECharts option={attemptsByDateOption} style={{ height: 320 }} notMerge lazyUpdate /> : <Empty text="A dated submission is needed to show your attempt activity." />}</ChartCard>
          </div>
          <div className="mt-6">
            <ChartCard title="Score distribution" subtitle="Your attempts grouped into performance bands.">{attempts.length ? <ReactECharts option={distributionOption} style={{ height: 320 }} notMerge lazyUpdate /> : <Empty text="Complete an attempt to show your score distribution." />}</ChartCard>
          </div>
        </>}
        {tab === 'attempts' && <section className="overflow-hidden rounded-xl border border-slate-200">
          {visibleAttempts.items.map(item => <div key={item.id} className="flex flex-col justify-between gap-3 border-b border-slate-100 px-4 py-4 last:border-0 sm:flex-row sm:items-center"><div className="min-w-0"><p className="truncate font-semibold text-slate-950">{item.testTitle}</p><p className="mt-1 text-sm text-slate-500">{submittedAt(item)?.toLocaleDateString() || 'Recently completed'} · {item.correctAnswers}/{item.questionCount} correct</p></div><div className="flex shrink-0 items-center gap-4"><span className="rounded-full bg-indigo-50 px-3 py-1.5 text-sm font-black text-indigo-700">{Math.round(scorePercent(item))}%</span><SubmissionReviewButton submission={item} className="text-sm font-bold text-indigo-700 hover:underline">Review answers</SubmissionReviewButton></div></div>)}
          {!attempts.length && <p className="p-5 text-sm text-slate-500">No attempts are available for this exam.</p>}
          <Pagination page={visibleAttempts.page} totalItems={attempts.length} onPageChange={setAttemptPage} itemLabel="attempts" />
        </section>}
      </div>
    </div>
  </div>
}

function DashboardFilter({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-bold text-slate-800"><span className="mb-2 block">{label}</span><span className="block font-normal">{children}</span></label>
}

function DashboardMetric({ icon, label, value, note }: { icon: 'tests' | 'attempts' | 'accuracy' | 'organisation'; label: string; value: string | number; note: string }) {
  return <div className="flex min-w-0 items-center gap-4 border-b border-slate-200 p-4 last:border-b-0 sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:border-r lg:last:border-r-0"><span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-violet-100 bg-violet-50 text-violet-600"><MetricIcon name={icon} /></span><div className="min-w-0"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-3xl font-bold leading-none text-slate-950">{value}</p><p className="mt-3 text-xs leading-relaxed text-slate-500">{note}</p></div></div>
}

function InsightCard({ tone, label, title, detail }: { tone: 'emerald' | 'orange'; label: string; title: string; detail: string }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/50"><div className="flex items-center gap-5"><span className={`grid h-16 w-16 shrink-0 place-items-center rounded-full ${tone === 'emerald' ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-500'}`}><InsightIcon tone={tone} /></span><div className="min-w-0"><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-1 truncate text-xl font-bold text-slate-950">{title}</p><p className="mt-2 text-sm text-slate-600">{detail}</p></div></div></section>
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/50"><h2 className="font-black text-slate-950">{title}</h2><p className="mt-1 text-sm text-slate-500">{subtitle}</p>{children}</section>
}

function TableCell({ label, value }: { label: string; value: string | number }) {
  return <div><p className="text-xs font-bold uppercase text-slate-400 lg:hidden">{label}</p><p className="font-bold text-indigo-700">{value}</p></div>
}

function ModalStat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-indigo-50 p-4"><p className="text-sm font-bold text-indigo-800">{label}</p><p className="mt-2 text-2xl font-black text-slate-950">{value}</p></div>
}

function Empty({ text }: { text: string }) {
  return <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{text}</p>
}

function MetricIcon({ name }: { name: 'tests' | 'attempts' | 'accuracy' | 'organisation' }) {
  if (name === 'tests') return <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4a3 3 0 0 1 6 0M9 10h6M9 14h6M9 18h4" /></svg>
  if (name === 'attempts') return <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  if (name === 'accuracy') return <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="m15 9 5-5M16 4h4v4" /></svg>
  return <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V8l8-4 8 4v13M9 21v-4h6v4M8 10h.01M12 10h.01M16 10h.01M8 13h.01M12 13h.01M16 13h.01" /></svg>
}

function InsightIcon({ tone }: { tone: 'emerald' | 'orange' }) {
  if (tone === 'emerald') return <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM9 20h6M12 13v7M5 5H3v2a4 4 0 0 0 4 4M19 5h2v2a4 4 0 0 1-4 4" /></svg>
  return <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2l-5-4.9 6.9-1Z" /></svg>
}
