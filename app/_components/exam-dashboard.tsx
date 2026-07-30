'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import ReactECharts from 'echarts-for-react'
import { SearchPicker } from './search-picker'
import { paginate, Pagination } from './pagination'
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from './auth-context'
import type { MockTest, Submission } from './test-types'
import { SubmissionReviewButton } from './submission-answers-modal'
import { ExamInformationPanel } from './exam-information-panel'
import { ExamResolver } from './exam-resolver'
import type { ExamCatalogEntry, ExamSelectionStatus } from '@/lib/exam-catalog'
import { scopeDashboardExams } from '@/lib/exam-dashboard-scope'
import { toDate, type ExamCatalogSummary } from '@/lib/exam-information'
import { AttendanceOverviewCard, StudentAttendancePanel } from './attendance-summary-card'

type Exam = ExamCatalogSummary
type Group = { id: string;
name: string;
targetExamId?: string;
targetExamName?: string;
members: { userId: string; userEmail?: string; userName?: string }[] }
type TestAssignment = { id: string; testId: string; userId: string }
type ExamStats = { exam: Exam;
tests: number;
groups: number;
groupUsers: number;
attempts: number;
students: number;
average: number;
completion: number }
type ModalTab = 'details' | 'scores' | 'users' | 'groups' | 'goals' | 'attendance'
const score = (item: Submission) => item.totalMarks ? item.score / item.totalMarks * 100 : 0
const isUnreadExam = (exam: Exam, lastSeen: unknown) => {
  const published = toDate(exam.lastPublishedAt)
  const seen = toDate(lastSeen)
  return Boolean(published && (!seen || published.valueOf() > seen.valueOf()))
}

export function ExamDashboard() {
  const { user, profile } = useAuth();
const role = profile?.role;
const allowed = role === 'admin' || role === 'organisation'
  const [catalogExams, setCatalogExams] = useState<Exam[]>([]);
const [tests, setTests] = useState<MockTest[]>([]);
const [groups, setGroups] = useState<Group[]>([]);
const [submissions, setSubmissions] = useState<Submission[]>([]);
const [assignments, setAssignments] = useState<TestAssignment[]>([]);
const [examReads, setExamReads] = useState<Record<string, unknown>>({});
const [filter, setFilter] = useState('');
const [opened, setOpened] = useState<ExamStats | null>(null);
const [error, setError] = useState('')
const [page, setPage] = useState(1)
const [addingExam, setAddingExam] = useState(false)
const [examNotice, setExamNotice] = useState('')
  useEffect(() => { if (!user || !allowed) return;
return onSnapshot(collection(db, 'examCatalog'), s => setCatalogExams(s.docs.map(d => ({ id: d.id, ...d.data() }) as Exam).filter(e => e.name).sort((a, b) => a.name.localeCompare(b.name))), e => setError(e.message)) }, [allowed, user])
  useEffect(() => { if (!user || !allowed) return;
return onSnapshot(query(collection(db, 'examUpdateReads'), where('userId', '==', user.uid)), s => setExamReads(Object.fromEntries(s.docs.map(d => [d.data().examId as string, d.data().lastSeenPublishedAt]))), e => setError(e.message)) }, [allowed, user])
  useEffect(() => {
    if (!user || !allowed) return
    if (role === 'admin') {
      return onSnapshot(
        collection(db, 'tests'),
        snapshot => setTests(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as MockTest).filter(test => test.deletedAt == null)),
        reason => setError(reason.message),
      )
    }

    // Firestore rules are not filters. A broad `createdBy == uid` query can be
    // rejected because access to private tests also depends on organisationId.
    // Keep every listener constrained to the same fields used by the rules.
    const testGroups = new Map<string, MockTest[]>()
    const updateTests = (key: string, items: MockTest[]) => {
      testGroups.set(key, items)
      setTests([...testGroups.values()].flat())
    }
    const onError = (reason: Error) => setError(reason.message)
    const stops = [
      onSnapshot(
        query(collection(db, 'tests'), where('createdBy', '==', user.uid), where('visibility', '==', 'public'), where('deletedAt', '==', null)),
        snapshot => updateTests('public', snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as MockTest)),
        onError,
      ),
      onSnapshot(
        query(collection(db, 'tests'), where('createdBy', '==', user.uid), where('visibility', '==', 'private'), where('organisationId', '==', user.uid), where('deletedAt', '==', null)),
        snapshot => updateTests('private', snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as MockTest)),
        onError,
      ),
      onSnapshot(
        query(collection(db, 'tests'), where('createdBy', '==', user.uid), where('visibility', '==', 'assigned'), where('deletedAt', '==', null)),
        snapshot => updateTests('assigned', snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as MockTest)),
        onError,
      ),
    ]
    return () => stops.forEach(stop => stop())
  }, [allowed, role, user])
  useEffect(() => { if (!user || !allowed) return;
const source = role === 'admin' ? collection(db, 'organisationGroups') : query(collection(db, 'organisationGroups'), where('organisationId', '==', user.uid));
return onSnapshot(source, async s => { try { setGroups(await Promise.all(s.docs.map(async d => ({ id: d.id, name: d.data().name as string, targetExamId: d.data().targetExamId as string | undefined, targetExamName: d.data().targetExamName as string | undefined, members: (await getDocs(collection(d.ref, 'members'))).docs.map(m => ({ userId: m.data().userId as string })) })))) } catch { setError('Unable to load batches.') } }, e => setError(e.message)) }, [allowed, role, user])
  useEffect(() => { if (!user || !allowed) return;
const source = role === 'admin' ? collection(db, 'submissions') : query(collection(db, 'submissions'), where('organisationIds', 'array-contains', user.uid));
return onSnapshot(source, s => setSubmissions(s.docs.map(d => ({ id: d.id, ...d.data() }) as Submission).filter(item => item.gradingStatus !== 'pending')), e => setError(e.message)) }, [allowed, role, user])
  useEffect(() => { if (!user || !allowed) return;
const source = role === 'admin' ? collection(db, 'testAssignments') : query(collection(db, 'testAssignments'), where('assignedBy', '==', user.uid));
return onSnapshot(source, s => setAssignments(s.docs.map(d => ({ id: d.id, ...d.data() }) as TestAssignment)), e => setError(e.message)) }, [allowed, role, user])
  const exams = useMemo(
    () => scopeDashboardExams(catalogExams, tests, role, user?.uid),
    [catalogExams, role, tests, user?.uid],
  )
  const stats = useMemo(() => { const testExam = new Map(tests.map(t => [t.id, t.examId]));
return exams.map(exam => { const examTests = tests.filter(t => t.examId === exam.id);
const examGroups = groups.filter(g => g.targetExamId === exam.id || (!g.targetExamId && g.targetExamName === exam.name));
const groupUsers = new Set(examGroups.flatMap(g => g.members.map(m => m.userId)));
const attempts = submissions.filter(s => s.testExamId === exam.id || testExam.get(s.testId) === exam.id || s.testExam === exam.name);
const students = new Set(attempts.map(s => s.userId)).size;
const average = attempts.length ? attempts.reduce((sum, s) => sum + score(s), 0) / attempts.length : 0;
return { exam, tests: examTests.length, groups: examGroups.length, groupUsers: groupUsers.size, attempts: attempts.length, students, average, completion: groupUsers.size ? students / groupUsers.size * 100 : 0 } }) }, [exams, groups, submissions, tests])
  const visible = filter ? stats.filter(s => s.exam.id === filter) : stats
  const visibleExams = paginate(visible, page)
  if (!allowed) return null
  return <section>
<p className="text-sm font-bold tracking-widest text-indigo-600">EXAM INTELLIGENCE</p>
<div className="mt-1 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
<div>
<h1 className="text-4xl font-bold">Exam dashboard</h1>
<p className="mt-3 max-w-2xl text-slate-600">Select an exam to explore its performance, learners and batch goals.</p>
</div>
<button type="button" onClick={() => { setExamNotice(''); setAddingExam(true) }} className="rounded-xl bg-indigo-600 px-5 py-3 text-center font-bold text-white">Create exam</button>
</div>
{examNotice && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{examNotice}</p>}
<DashboardOverview exams={exams} tests={tests} groups={groups} submissions={submissions} />
{role === 'organisation' && <AttendanceOverviewCard />}
<label className="mt-8 block max-w-md text-sm font-bold">Focus on an exam<div className="mt-2 font-normal"><SearchPicker value={filter} options={[{ id: '', label: role === 'admin' ? 'All catalog exams' : 'All institute exams' }, ...exams.map(exam => ({ id: exam.id, label: exam.name }))]} onChange={option => { setFilter(option.id); setPage(1) }} placeholder="Search exams" /></div><select value={filter} onChange={e => { setFilter(e.target.value); setPage(1) }} className="hidden" aria-hidden="true" tabIndex={-1}>
<option value="">{role === 'admin' ? 'All catalog exams' : 'All institute exams'}</option>{exams.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
</label>{error && <p className="mt-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">Could not fully load dashboard data: {error}</p>}<div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
<div className="hidden grid-cols-[minmax(150px,1.4fr)_repeat(6,minmax(75px,1fr))] gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-bold tracking-wide text-slate-500 lg:grid">
<span>EXAM</span>
<span>TESTS</span>
<span>BATCHES</span>
<span>BATCH STUDENTS</span>
<span>STUDENTS</span>
<span>ATTEMPTS</span>
<span>AVG SCORE</span>
</div>{visibleExams.items.map(item => <button type="button" key={item.exam.id} onClick={() => setOpened(item)} className="grid w-full gap-3 border-b border-slate-100 px-5 py-5 text-left hover:bg-indigo-50 last:border-0 lg:grid-cols-[minmax(150px,1.4fr)_repeat(6,minmax(75px,1fr))] lg:items-center">
<div>
<div className="flex flex-wrap items-center gap-2"><p className="font-bold">{item.exam.name}</p>{isUnreadExam(item.exam, examReads[item.exam.id]) && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-rose-700">Updated</span>}</div>
<p className="mt-1 text-xs text-slate-500">Click for exam details</p>
</div>
<Cell label="Tests" value={item.tests} />

<Cell label="Batches" value={item.groups} />

<Cell label="Batch students" value={item.groupUsers} />

<Cell label="Students" value={item.students} />

<Cell label="Attempts" value={item.attempts} />

<Cell label="Avg score" value={item.attempts ? `${Math.round(item.average)}%` : '—'} />

</button>)}{!visible.length && <p className="p-6 text-slate-500">{role === 'admin' ? 'No catalog exams match this selection.' : 'Create a test or add an exam to see it here.'}</p>}<Pagination page={visibleExams.page} totalItems={visible.length} onPageChange={setPage} itemLabel="exams" /></div>{opened && <ExamModal stats={opened} tests={tests} groups={groups} submissions={submissions} assignments={assignments} close={() => setOpened(null)} />
}{addingExam && <CreateExamDialog close={() => setAddingExam(false)} resolve={(exam, status) => { setAddingExam(false); setFilter(exam.id); setPage(1); setExamNotice(status === 'created' ? `Created ${exam.name}.` : `Selected existing exam ${exam.name}.`) }} />}</section>
}

function CreateExamDialog({
  close,
  resolve,
}: {
  close: () => void
  resolve: (exam: ExamCatalogEntry, status: ExamSelectionStatus) => void
}) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="create-exam-title" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={close}>
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-6">
          <div>
            <p className="text-xs font-bold tracking-widest text-indigo-600">EXAM CATALOG</p>
            <h2 id="create-exam-title" className="mt-1 text-2xl font-black">Create exam</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Enter a name or abbreviation. Existing catalog matches will be suggested before a new exam is created.</p>
          </div>
          <button type="button" onClick={close} aria-label="Close create exam dialog" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">Close</button>
        </div>
        <div className="p-6">
          <ExamResolver autoFocus onResolved={resolve} />
        </div>
      </div>
    </div>
  )
}

function DashboardOverview({ exams, tests, groups, submissions }: { exams: Exam[]; tests: MockTest[]; groups: Group[]; submissions: Submission[] }) {
  const [groupId, setGroupId] = useState('')
  const [testId, setTestId] = useState('')
  const students = new Set([...submissions.map(item => item.userId), ...groups.flatMap(group => group.members.map(member => member.userId))]).size
  const groupPerformance = groups.map(group => {
    const memberIds = new Set(group.members.map(member => member.userId))
    const attempts = submissions.filter(item => memberIds.has(item.userId))
    return { group, attempts, average: attempts.length ? attempts.reduce((sum, item) => sum + score(item), 0) / attempts.length : 0 }
  }).filter(item => item.attempts.length)
  const testPerformance = tests.map(test => {
    const attempts = submissions.filter(item => item.testId === test.id)
    return { test, attempts, average: attempts.length ? attempts.reduce((sum, item) => sum + score(item), 0) / attempts.length : 0 }
  }).filter(item => item.attempts.length)
  const highestGroup = groupPerformance.slice().sort((a, b) => b.average - a.average)[0]
  const highestUser = submissions.slice().sort((a, b) => score(b) - score(a))[0]
  const groupAttempts = groupId ? groupPerformance.find(item => item.group.id === groupId)?.attempts || [] : groupPerformance.flatMap(item => item.attempts)
  const testAttempts = testId ? testPerformance.find(item => item.test.id === testId)?.attempts || [] : testPerformance.flatMap(item => item.attempts)

  return <section className="mt-8 space-y-6">
    <div className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200/60 sm:grid-cols-2 lg:grid-cols-4">
      <Metric icon="tests" label="Number of tests" value={tests.length} note="Active tests" />
      <Metric icon="students" label="Number of students" value={students} note="Students with attempts or batch membership" />
      <Metric icon="groups" label="Number of batches" value={groups.length} note="Available institute batches" />
      <Metric icon="attempts" label="Learner attempts" value={submissions.length} note={`${new Set(submissions.map(item => item.userId)).size} unique students`} />
    </div>
    <div className="grid gap-6 xl:grid-cols-2">
      <InsightCard icon="trophy" label="Highest performing batch" title={highestGroup?.group.name || '—'} detail={highestGroup ? `${Math.round(highestGroup.average)}% average across ${highestGroup.attempts.length} attempt${highestGroup.attempts.length === 1 ? '' : 's'}` : 'Will appear after a batch member completes a test.'} />
      <InsightCard icon="star" label="Highest scoring student" title={highestUser?.userName || highestUser?.userEmail || highestUser?.userId || '—'} subtitle={highestUser?.userEmail || highestUser?.userId} detail={highestUser ? `${highestUser.score}/${highestUser.totalMarks} marks (${Math.round(score(highestUser))}%) on ${highestUser.testTitle}` : 'Will appear after a student completes a test.'} />
    </div>
    <div className="grid gap-6 xl:grid-cols-2">
      <TrendChart title="Batch average score by date" filterLabel="Batch" value={groupId} onChange={setGroupId} options={groups.map(group => ({ id: group.id, label: group.name }))} attempts={groupAttempts} emptyText="A dated batch submission is needed to show this trend." />
      <TrendChart title="Exam average score by date" filterLabel="Exam" value={testId} onChange={setTestId} options={tests.map(test => ({ id: test.id, label: test.title }))} attempts={testAttempts} emptyText="A dated exam submission is needed to show this trend." />
    </div>
    <AttemptsByDateChart exams={exams} tests={tests} groups={groups} submissions={submissions} />
  </section>
}

function AttemptsByDateChart({ exams, tests, groups, submissions }: { exams: Exam[]; tests: MockTest[]; groups: Group[]; submissions: Submission[] }) {
  const [examId, setExamId] = useState('')
  const [testId, setTestId] = useState('')
  const [userId, setUserId] = useState('')
  const [groupId, setGroupId] = useState('')
  const testExamIds = new Map(tests.map(test => [test.id, test.examId]))
  const selectedGroupUserIds = groupId ? new Set(groups.find(group => group.id === groupId)?.members.map(member => member.userId) || []) : null
  const attempts = submissions.filter(item => (!examId || item.testExamId === examId || testExamIds.get(item.testId) === examId) && (!testId || item.testId === testId) && (!userId || item.userId === userId) && (!selectedGroupUserIds || selectedGroupUserIds.has(item.userId)))
  const daily = new Map<string, number>()
  attempts.forEach(item => { const date = item.submittedAt?.toDate?.(); if (date) { const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; daily.set(key, (daily.get(key) || 0) + 1) } })
  const labels = [...daily.keys()].sort()
  const users = [...new Map(submissions.map(item => [item.userId, item.userEmail || item.userId])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const option = { tooltip: { trigger: 'axis' }, grid: { left: 42, right: 18, top: 26, bottom: 54 }, xAxis: { type: 'category', data: labels, axisLabel: { rotate: 35 } }, yAxis: { type: 'value', minInterval: 1, name: 'Attempts' }, series: [{ name: 'Attempts', type: 'line', smooth: true, data: labels.map(label => daily.get(label) || 0), areaStyle: { color: '#05966922' }, lineStyle: { color: '#059669', width: 3 }, itemStyle: { color: '#059669' } }] }
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div><h2 className="font-black">Number of attempts by date</h2><p className="mt-1 text-sm text-slate-500">Across all exams by default. Combine filters to narrow the trend.</p></div><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><DashboardPicker label="Exam" value={examId} options={[{ id: '', label: 'All exams' }, ...exams.map(exam => ({ id: exam.id, label: exam.name }))]} onChange={setExamId} placeholder="Search exams" /><DashboardPicker label="Test" value={testId} options={[{ id: '', label: 'All tests' }, ...tests.map(test => ({ id: test.id, label: test.title, detail: test.category || undefined }))]} onChange={setTestId} placeholder="Search tests" /><DashboardPicker label="Student" value={userId} options={[{ id: '', label: 'All students' }, ...users.map(([id, email]) => ({ id, label: email }))]} onChange={setUserId} placeholder="Search students" /><DashboardPicker label="Batch" value={groupId} options={[{ id: '', label: 'All batches' }, ...groups.map(group => ({ id: group.id, label: group.name, detail: `${group.members.length} students` }))]} onChange={setGroupId} placeholder="Search batches" /></div>{labels.length ? <ReactECharts option={option} style={{ height: 300 }} notMerge lazyUpdate /> : <Empty text="No dated attempts match the selected filters." />}</section>
}

function DashboardPicker({ label, value, options, onChange, placeholder, inline = false }: { label: string; value: string; options: { id: string; label: string; detail?: string }[]; onChange: (value: string) => void; placeholder: string; inline?: boolean }) {
  return <label className={inline ? 'flex items-center gap-3 text-sm font-bold text-slate-800' : 'block text-sm font-bold text-slate-800'}><span className={inline ? 'shrink-0' : 'mb-1.5 block'}>{label}</span><span className="block min-w-0 flex-1 font-normal"><SearchPicker value={value} options={options} onChange={option => onChange(option.id)} placeholder={placeholder} /></span></label>
}

function InsightCard({ icon, label, title, subtitle, detail }: { icon: 'trophy' | 'star'; label: string; title: string; subtitle?: string; detail: string }) {
  const accent = icon === 'trophy' ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-500'
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/50"><div className="flex items-center gap-5"><span className={`grid h-16 w-16 shrink-0 place-items-center rounded-full ${accent}`}><DashboardIcon name={icon} className="h-8 w-8" /></span><div className="min-w-0"><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-1 truncate text-xl font-bold text-slate-950">{title}</p>{subtitle && <p className="mt-1 truncate text-xs text-slate-500">{subtitle}</p>}<p className="mt-2 text-sm text-slate-600">{detail}</p></div></div></section>
}

function TrendChart({ title, filterLabel, value, onChange, options, attempts, emptyText }: { title: string; filterLabel: string; value: string; onChange: (value: string) => void; options: { id: string; label: string }[]; attempts: Submission[]; emptyText: string }) {
  const daily = new Map<string, Submission[]>()
  attempts.forEach(item => { const date = item.submittedAt?.toDate?.(); if (date) { const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; daily.set(key, [...(daily.get(key) || []), item]) } })
  const labels = [...daily.keys()].sort()
  const option = { tooltip: { trigger: 'axis' }, grid: { left: 44, right: 18, top: 28, bottom: 58 }, xAxis: { type: 'category', data: labels, boundaryGap: false, axisLine: { lineStyle: { color: '#94a3b8' } }, axisTick: { show: false }, axisLabel: { rotate: 40, color: '#64748b' } }, yAxis: { type: 'value', min: 0, max: 100, splitLine: { lineStyle: { color: '#e2e8f0', type: 'dashed' } }, axisLabel: { formatter: '{value}%', color: '#64748b' } }, series: [{ name: 'Average score', type: 'line', smooth: 0.45, symbol: 'circle', symbolSize: 8, data: labels.map(label => Math.round((daily.get(label) || []).reduce((sum, item) => sum + score(item), 0) / (daily.get(label)?.length || 1))), areaStyle: { color: '#7c3aed1f' }, lineStyle: { color: '#6d4aff', width: 3 }, itemStyle: { color: '#fff', borderColor: '#6d4aff', borderWidth: 2 } }] }
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/50"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="font-black text-slate-950">{title}</h2><p className="mt-1 text-sm text-slate-500">Average percentage for completed submissions.</p></div><div className="w-full sm:w-52"><DashboardPicker label={filterLabel} value={value} options={[{ id: '', label: `All ${filterLabel.toLowerCase()}s` }, ...options]} onChange={onChange} placeholder={`Search ${filterLabel.toLowerCase()}s`} inline /></div></div>{labels.length ? <ReactECharts option={option} style={{ height: 300 }} notMerge lazyUpdate /> : <Empty text={emptyText} />}</section>
}

function ExamModal({ stats, tests, groups, submissions, assignments, close }: { stats: ExamStats;
tests: MockTest[];
groups: Group[];
submissions: Submission[];
assignments: TestAssignment[];
close: () => void }) {
  const [tab, setTab] = useState<ModalTab>('scores');
const ownTests = tests.filter(t => t.examId === stats.exam.id);
const ids = new Set(ownTests.map(t => t.id));
const attempts = submissions.filter(s => s.testExamId === stats.exam.id || ids.has(s.testId) || s.testExam === stats.exam.name);
const ownGroups = groups.filter(g => g.targetExamId === stats.exam.id || (!g.targetExamId && g.targetExamName === stats.exam.name));
const tabs = [['scores', 'Score analysis'], ['details', 'Exam details'], ['users', 'Student list'], ['groups', 'Batch goals']] as const
  if (['scores'].includes(tab)) return <ScoreAnalysisModal stats={stats} attempts={attempts} tests={ownTests} tabs={tabs} setTab={setTab} close={close} />

  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={close}>
<div className="h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white shadow-2xl" onMouseDown={e => e.stopPropagation()}>
<div className="flex items-start justify-between gap-3 border-b border-slate-200 p-6">
<div>
<p className="text-xs font-bold tracking-widest text-indigo-600">EXAM DASHBOARD</p>
<h2 className="mt-1 text-2xl font-black">{stats.exam.name}</h2>
</div>
<button type="button" onClick={close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Close</button>
</div>
<div className="flex overflow-x-auto border-b border-slate-200 px-4">{tabs.map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} className={`shrink-0 border-b-2 px-3 py-3 text-sm font-bold ${tab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'}`}>{label}</button>)}</div>
<div className="p-6">{tab === 'details' && <ExamInformationPanel exam={stats.exam} stats={stats} tests={ownTests} />}{tab === 'scores' && <>
<div className="grid gap-4 sm:grid-cols-3">
<ModalStat label="Average score" value={attempts.length ? `${Math.round(stats.average)}%` : '—'} />

<ModalStat label="Attempts" value={attempts.length} />

<ModalStat label="Students" value={stats.students} />

</div>{attempts.length ? <div className="mt-6 grid grid-cols-3 gap-3">{[['Below 50%', attempts.filter(a => score(a) < 50).length], ['50–74%', attempts.filter(a => score(a) >= 50 && score(a) < 75).length], ['75%+', attempts.filter(a => score(a) >= 75).length]].map(([label, value]) => <ModalStat key={label as string} label={label as string} value={value as number} />
)}</div> : <Empty text="Score analysis will appear after learners complete tests." />
}</>}{tab === 'users' && <ExamUserList attempts={attempts} tests={ownTests} groups={ownGroups} assignments={assignments} />}{tab === 'groups' && <GroupGoals attempts={attempts} groups={ownGroups} />}</div>
</div>
</div>
}

function GroupGoals({ attempts, groups }: { attempts: Submission[]; groups: Group[] }) {
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [sort, setSort] = useState<{ field: 'users' | 'average' | 'attempts'; direction: 'asc' | 'desc' }>({ field: 'average', direction: 'desc' })
  const [page, setPage] = useState(1)
  const visibleGroups = selectedGroupId ? groups.filter(group => group.id === selectedGroupId) : groups
  const memberIds = new Set(visibleGroups.flatMap(group => group.members.map(member => member.userId)))
  const combinedAttempts = attempts.filter(attempt => memberIds.has(attempt.userId))
  const byGroup = visibleGroups.map(group => {
    const users = new Set(group.members.map(member => member.userId))
    const groupAttempts = attempts.filter(attempt => users.has(attempt.userId))
    return { group, users: users.size, attempts: groupAttempts.length, average: groupAttempts.length ? groupAttempts.reduce((sum, attempt) => sum + score(attempt), 0) / groupAttempts.length : 0 }
  }).sort((a, b) => b.average - a.average)
  const sortedGroups = byGroup.slice().sort((a, b) => { const comparison = sort.field === 'users' ? a.users - b.users : sort.field === 'attempts' ? a.attempts - b.attempts : a.average - b.average; return sort.direction === 'asc' ? comparison : -comparison })
  const pageSize = 5
  const totalPages = Math.max(1, Math.ceil(sortedGroups.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedGroups = sortedGroups.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const toggleSort = (field: 'users' | 'average' | 'attempts') => { setSort((current) => current.field === field ? { field, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { field, direction: 'desc' }); setPage(1) }
  const daily = new Map<string, Submission[]>()
  combinedAttempts.forEach(attempt => { const date = attempt.submittedAt?.toDate?.(); if (date) { const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; daily.set(key, [...(daily.get(key) || []), attempt]) } })
  const labels = [...daily.keys()].sort()
  const lineOption = { tooltip: { trigger: 'axis' }, grid: { left: 42, right: 18, top: 28, bottom: 48 }, xAxis: { type: 'category', data: labels, axisLabel: { rotate: 35 } }, yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } }, series: [{ name: 'Average score', type: 'line', smooth: true, data: labels.map(label => Math.round((daily.get(label) || []).reduce((sum, attempt) => sum + score(attempt), 0) / (daily.get(label)?.length || 1))), areaStyle: { color: '#4f46e522' }, lineStyle: { color: '#4f46e5', width: 3 }, itemStyle: { color: '#4f46e5' } }] }
  const attemptsByDateOption = { tooltip: { trigger: 'axis' }, grid: { left: 42, right: 18, top: 28, bottom: 48 }, xAxis: { type: 'category', data: labels, axisLabel: { rotate: 35 } }, yAxis: { type: 'value', minInterval: 1, name: 'Attempts' }, series: [{ name: 'Attempts', type: 'line', smooth: true, data: labels.map(label => (daily.get(label) || []).length), areaStyle: { color: '#05966922' }, lineStyle: { color: '#059669', width: 3 }, itemStyle: { color: '#059669' } }] }
  const barOption = { tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } }, grid: { left: 42, right: 18, top: 28, bottom: 70 }, xAxis: { type: 'category', data: byGroup.map(item => item.group.name), axisLabel: { rotate: 35, interval: 0 } }, yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } }, series: [{ name: 'Average score', type: 'bar', data: byGroup.map(item => Math.round(item.average)), itemStyle: { color: '#059669', borderRadius: [5, 5, 0, 0] } }] }
  return <section className="space-y-6"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h3 className="font-bold">Batch goal performance</h3><p className="mt-1 text-sm text-slate-500">Scores include all students and tests for this exam.</p></div><div className="w-full sm:w-72"><p className="mb-2 text-sm font-bold">Filter by batch</p><SearchPicker value={selectedGroupId} options={[{ id: '', label: 'All batches', detail: `${groups.length} batches` }, ...groups.map(group => ({ id: group.id, label: group.name, detail: `${group.members.length} students` }))]} onChange={option => { setSelectedGroupId(option.id); setPage(1) }} placeholder="Search and filter batches" /></div></div><div className="grid gap-4 sm:grid-cols-2"><ModalStat label="Total batches" value={visibleGroups.length} /><ModalStat label="Total students" value={memberIds.size} /></div>{visibleGroups.length ? <><div className="space-y-6"><Chart title="Combined average score by date" option={lineOption} labels={[]} onDateSelect={() => undefined} /><Chart title="Number of attempts by date" option={attemptsByDateOption} labels={[]} onDateSelect={() => undefined} /><Chart title="Average score by batch" option={barOption} labels={[]} onDateSelect={() => undefined} /></div><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-end justify-between gap-3"><div><h3 className="text-xl font-bold tracking-tight text-slate-900">Batches</h3><p className="mt-1 text-sm text-slate-500">Sort and browse batch performance.</p></div><p className="text-sm font-medium text-slate-500">{sortedGroups.length} batch{sortedGroups.length === 1 ? '' : 's'}</p></div><div className="mt-5 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-50 text-xs font-bold tracking-wide text-slate-500"><tr><th className="px-4 py-3">Batch</th><th className="px-4 py-3"><button type="button" onClick={() => toggleSort('users')} className="inline-flex items-center gap-1 hover:text-indigo-700">Students <span aria-hidden="true">{sort.field === 'users' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button></th><th className="px-4 py-3"><button type="button" onClick={() => toggleSort('average')} className="inline-flex items-center gap-1 hover:text-indigo-700">Average score <span aria-hidden="true">{sort.field === 'average' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button></th><th className="px-4 py-3"><button type="button" onClick={() => toggleSort('attempts')} className="inline-flex items-center gap-1 hover:text-indigo-700">Attempts <span aria-hidden="true">{sort.field === 'attempts' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button></th></tr></thead><tbody>{pagedGroups.map(item => <tr key={item.group.id} className="border-t border-slate-100 transition-colors hover:bg-indigo-50/50"><td className="px-4 py-3.5 font-semibold text-slate-900">{item.group.name}</td><td className="px-4 py-3.5 font-semibold text-slate-800">{item.users}</td><td className="px-4 py-3.5"><span className="rounded-full bg-indigo-50 px-2.5 py-1 font-bold text-indigo-700">{item.attempts ? `${Math.round(item.average)}%` : '—'}</span></td><td className="px-4 py-3.5 font-semibold text-slate-800">{item.attempts}</td></tr>)}</tbody></table></div>{sortedGroups.length > pageSize && <div className="mt-4 flex items-center justify-between gap-3"><p className="text-sm text-slate-500">Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, sortedGroups.length)} of {sortedGroups.length}</p><div className="flex gap-2"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">Previous</button><button type="button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">Next</button></div></div>}</section></> : <Empty text="No batches have selected this exam as their goal." />}</section>
}

function ExamUserList({ attempts, tests, groups, assignments, dashboardType = 'exam' }: { attempts: Submission[]; tests: MockTest[]; groups: Group[]; assignments: TestAssignment[]; dashboardType?: 'exam' | 'test' | 'group' }) {
  const [userQuery, setUserQuery] = useState('')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [testQuery, setTestQuery] = useState('')
  const [selectedTestId, setSelectedTestId] = useState('')
  const [selectedGroupName, setSelectedGroupName] = useState('')
  const [sort, setSort] = useState<{ field: 'attempts' | 'average'; direction: 'asc' | 'desc' }>({ field: 'average', direction: 'desc' })
  const [page, setPage] = useState(1)
  const testIds = new Set(tests.map((test) => test.id))
  const groupsByUser = new Map<string, string[]>()
  groups.forEach((group) => group.members.forEach((member) => groupsByUser.set(member.userId, [...(groupsByUser.get(member.userId) || []), group.name])))
  const assignedUsers = new Set([...assignments.filter((assignment) => testIds.has(assignment.testId)).map((assignment) => assignment.userId), ...groupsByUser.keys()])
  const attemptUsers = new Map(attempts.map((attempt) => [attempt.userId, { id: attempt.userId, name: attempt.userName || attempt.userEmail || attempt.userId, email: attempt.userEmail || attempt.userId, attempts: attempts.filter((item) => item.userId === attempt.userId) }]))
  if (dashboardType === 'group') groups.flatMap(group => group.members).forEach(member => { if (!attemptUsers.has(member.userId)) attemptUsers.set(member.userId, { id: member.userId, name: member.userName || member.userEmail || member.userId, email: member.userEmail || member.userId, attempts: [] }) })
  const users = [...attemptUsers.values()].map((user) => ({ ...user, average: user.attempts.length ? user.attempts.reduce((sum, attempt) => sum + score(attempt), 0) / user.attempts.length : 0, best: user.attempts.slice().sort((a, b) => score(b) - score(a))[0], groups: groupsByUser.get(user.id) || [] })).sort((a, b) => b.average - a.average)
  const rankedUsers = users.filter((user): user is typeof user & { best: Submission } => !!user.best)
  const activeUser = users.find((user) => user.id === selectedUserId)
  const trendAttempts = (activeUser ? activeUser.attempts : attempts).filter((attempt) => !selectedTestId || attempt.testId === selectedTestId)
  const daily = new Map<string, Submission[]>()
  trendAttempts.forEach((attempt) => { const date = attempt.submittedAt?.toDate?.(); if (date) { const key = date.toLocaleDateString(); daily.set(key, [...(daily.get(key) || []), attempt]) } })
  const labels = [...daily.keys()]
  const chartOption = { tooltip: { trigger: 'axis' }, grid: { left: 38, right: 16, top: 28, bottom: 48 }, xAxis: { type: 'category', data: labels, axisLabel: { rotate: 35 } }, yAxis: { type: 'value', min: 0, max: 100 }, series: [{ name: 'Average score', type: 'line', smooth: true, data: labels.map((label) => { const values = daily.get(label) || []; return Math.round(values.reduce((sum, item) => sum + score(item), 0) / values.length) }), areaStyle: { color: '#4f46e522' }, lineStyle: { color: '#4f46e5', width: 3 }, itemStyle: { color: '#4f46e5' } }] }
  const participation = assignedUsers.size ? Math.round(rankedUsers.length / assignedUsers.size * 100) : 0
  const rows = users.filter((user) => (!selectedUserId || user.id === selectedUserId) && (!selectedTestId || user.attempts.some((attempt) => attempt.testId === selectedTestId)) && (!selectedGroupName || user.groups.includes(selectedGroupName))).map((user) => {
    const filteredAttempts = selectedTestId ? user.attempts.filter((attempt) => attempt.testId === selectedTestId) : user.attempts
    return { ...user, attempts: filteredAttempts, average: filteredAttempts.length ? filteredAttempts.reduce((sum, attempt) => sum + score(attempt), 0) / filteredAttempts.length : 0 }
  }).sort((a, b) => {
    const comparison = sort.field === 'attempts' ? a.attempts.length - b.attempts.length : a.average - b.average
    return sort.direction === 'asc' ? comparison : -comparison
  })
  const pageSize = 5
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const toggleSort = (field: 'attempts' | 'average') => { setSort((current) => current.field === field ? { field, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { field, direction: 'desc' }); setPage(1) }
  return <section className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><ModalStat label={`Students who took this ${dashboardType}`} value={rankedUsers.length} /><ModalStat label={dashboardType === 'test' ? 'Test attempts' : dashboardType === 'group' ? 'Batch members' : 'Students assigned this exam'} value={dashboardType === 'test' ? attempts.length : assignedUsers.size} /><ModalStat label={dashboardType === 'test' || dashboardType === 'group' ? 'Average score' : 'Batches assigned this exam'} value={dashboardType === 'test' || dashboardType === 'group' ? (attempts.length ? `${Math.round(attempts.reduce((sum, attempt) => sum + score(attempt), 0) / attempts.length)}%` : '—') : groups.length} /><ModalStat label="Participation" value={assignedUsers.size ? `${participation}%` : '—'} /></div>
    <section className="rounded-xl border p-4"><h3 className="text-xl font-bold tracking-tight text-slate-900">Student score trend</h3><p className="mt-1 text-sm text-slate-500">{dashboardType === 'test' ? 'Shows this test’s students by default. Select a student to refine the chart.' : `Shows all students in this ${dashboardType} by default. Select a student and test to refine the chart.`}</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><SearchPicker value={selectedUserId} options={[{ id: '', label: 'All students', detail: `${users.length} students` }, ...users.map((user) => ({ id: user.id, label: user.name, detail: `${user.email} · ${user.attempts.length} attempts` }))]} onChange={(option) => setSelectedUserId(option.id)} placeholder="Search and select a student" />{dashboardType !== 'test' && <SearchPicker value={selectedTestId} options={[{ id: '', label: `All tests in this ${dashboardType}` }, ...tests.map((test) => ({ id: test.id, label: test.title, detail: test.category || undefined }))]} onChange={(option) => setSelectedTestId(option.id)} placeholder="Search and select a test" />}</div>{labels.length ? <ReactECharts option={chartOption} style={{ height: 280 }} notMerge lazyUpdate /> : <Empty text="A dated submission is needed to show this trend." />}</section>
    <UserRanking title="Top 5 students" users={rankedUsers.slice(0, 5)} /><UserRanking title="Lowest 5 students" users={rankedUsers.slice().reverse().slice(0, 5)} />
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-xl font-bold tracking-tight text-slate-900">All students by attempts and average score</h3><p className="mt-1 text-sm text-slate-500">Filter, sort, and browse learner performance.</p></div><p className="text-sm font-medium text-slate-500">{rows.length} student{rows.length === 1 ? '' : 's'}</p></div><div className="mt-5 grid gap-3 md:grid-cols-3"><SearchPicker value={selectedUserId} options={[{ id: '', label: 'All students' }, ...users.map((user) => ({ id: user.id, label: user.name, detail: user.email }))]} onChange={(option) => { setSelectedUserId(option.id); setPage(1) }} placeholder="Search student" />{dashboardType !== 'test' && <SearchPicker value={selectedTestId} options={[{ id: '', label: 'All tests' }, ...tests.map((test) => ({ id: test.id, label: test.title, detail: test.category || undefined }))]} onChange={(option) => { setSelectedTestId(option.id); setPage(1) }} placeholder="Search test" />}{dashboardType === 'exam' && <SearchPicker value={selectedGroupName} options={[{ id: '', label: 'All batches' }, ...groups.map((group) => ({ id: group.name, label: group.name, detail: `${group.members.length} students` }))]} onChange={(option) => { setSelectedGroupName(option.id); setPage(1) }} placeholder="Search batch" />}</div><div className="mt-5 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-xs font-bold tracking-wide text-slate-500"><tr><th className="px-4 py-3">Student</th><th className="px-4 py-3"><button type="button" onClick={() => toggleSort('attempts')} className="inline-flex items-center gap-1 hover:text-indigo-700">Attempts <span aria-hidden="true">{sort.field === 'attempts' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button></th><th className="px-4 py-3"><button type="button" onClick={() => toggleSort('average')} className="inline-flex items-center gap-1 hover:text-indigo-700">Average score <span aria-hidden="true">{sort.field === 'average' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button></th><th className="px-4 py-3">Batches</th></tr></thead><tbody>{pagedRows.map((user) => <tr key={user.id} className="border-t border-slate-100 transition-colors hover:bg-indigo-50/50"><td className="px-4 py-3.5"><UserIdentity name={user.name} email={user.email} /></td><td className="px-4 py-3.5 font-semibold text-slate-800">{user.attempts.length}</td><td className="px-4 py-3.5"><span className="rounded-full bg-indigo-50 px-2.5 py-1 font-bold text-indigo-700">{user.attempts.length ? `${Math.round(user.average)}%` : '—'}</span></td><td className="max-w-72 px-4 py-3.5 text-slate-600">{user.groups.join(', ') || '—'}</td></tr>)}</tbody></table>{!pagedRows.length && <p className="p-6 text-center text-sm text-slate-500">No students match these filters.</p>}</div>{rows.length > pageSize && <div className="mt-4 flex items-center justify-between gap-3"><p className="text-sm text-slate-500">Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, rows.length)} of {rows.length}</p><div className="flex gap-2"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">Previous</button><button type="button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">Next</button></div></div>}</section>
  </section>
  const search = userQuery
  const setSearch = setUserQuery
  const visibleUsers = users
  return <section className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><ModalStat label="Students who took this exam" value={users.length} /><ModalStat label="Students assigned this exam" value={assignedUsers.size} /><ModalStat label="Batches assigned this exam" value={groups.length} /><ModalStat label="Participation" value={assignedUsers.size ? `${participation}%` : '—'} /></div>
    <section className="rounded-xl border p-4"><h3 className="font-bold">Student score trend</h3><p className="mt-1 text-sm text-slate-500">Defaults to the student with the most attempts. Select a student and test to refine the chart.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><input list="exam-user-options" value={userQuery} onChange={(event) => { const value = event.target.value; setUserQuery(value); const match = users.find((user) => user.email === value); if (match) setSelectedUserId(match.id) }} type="search" placeholder="Search and select a student" className="rounded-lg border border-slate-300 px-3 py-2" /><datalist id="exam-user-options">{users.map((user) => <option key={user.id} value={user.email} />)}</datalist><input list="exam-test-options" value={testQuery} onChange={(event) => { const value = event.target.value; setTestQuery(value); setSelectedTestId(tests.find((test) => test.title === value)?.id || '') }} type="search" placeholder="Search and select a test" className="rounded-lg border border-slate-300 px-3 py-2" /><datalist id="exam-test-options">{tests.map((test) => <option key={test.id} value={test.title} />)}</datalist></div>{activeUser && labels.length ? <ReactECharts option={chartOption} style={{ height: 280 }} notMerge lazyUpdate /> : <Empty text="A dated submission is needed to show this student’s trend." />}</section>
    <UserRanking title="Top 5 students" users={users.slice(0, 5)} /><UserRanking title="Lowest 5 students" users={users.slice().reverse().slice(0, 5)} />
    <section><h3 className="font-bold">All students by attempts and average score</h3><div className="mt-3 overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Student</th><th className="p-3">Attempts</th><th className="p-3">Average score</th><th className="p-3">Batches</th></tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-t"><td className="p-3 font-semibold">{user.email}</td><td className="p-3">{user.attempts.length}</td><td className="p-3 font-bold text-indigo-700">{Math.round(user.average)}%</td><td className="p-3 text-slate-600">{user.groups.join(', ') || '—'}</td></tr>)}</tbody></table>{!users.length && <p className="p-4 text-sm text-slate-500">No learner attempts are available yet.</p>}</div></section>
  </section>
  return <section className="space-y-6"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><ModalStat label="Students who took this exam" value={users.length} /><ModalStat label="Students assigned this exam" value={assignedUsers.size} /><ModalStat label="Batches assigned this exam" value={groups.length} /><ModalStat label="Participation" value={assignedUsers.size ? `${participation}%` : '—'} /></div><UserRanking title="Top 5 students" users={users.slice(0, 5)} /><UserRanking title="Lowest 5 students" users={users.slice().reverse().slice(0, 5)} /><section><h3 className="font-bold">All students by attempts and average score</h3><div className="mt-3 overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Student</th><th className="p-3">Attempts</th><th className="p-3">Average score</th><th className="p-3">Batches</th></tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-t"><td className="p-3 font-semibold">{user.email}</td><td className="p-3">{user.attempts.length}</td><td className="p-3 font-bold text-indigo-700">{Math.round(user.average)}%</td><td className="p-3 text-slate-600">{user.groups.join(', ') || '—'}</td></tr>)}</tbody></table>{!users.length && <p className="p-4 text-sm text-slate-500">No learner attempts are available yet.</p>}</div></section><section className="rounded-xl border p-4"><h3 className="font-bold">Student score trend</h3><p className="mt-1 text-sm text-slate-500">Defaults to the student with the most attempts.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Search a student" className="rounded-lg border border-slate-300 px-3 py-2" /><select value={activeUser?.id || ''} onChange={(event) => setSelectedUserId(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="">Select a student</option>{visibleUsers.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}</select></div>{activeUser && labels.length ? <ReactECharts option={chartOption} style={{ height: 280 }} notMerge lazyUpdate /> : <Empty text="A dated submission is needed to show this student’s trend." />}</section></section>
}

function UserRanking({ title, users }: { title: string; users: { id: string; name: string; email: string; attempts: Submission[]; average: number; best: Submission; groups: string[] }[] }) {
  return <section>
    <h3 className="text-xl font-bold tracking-tight text-slate-900">{title}</h3>
    <div className="mt-3 space-y-3">{users.map((user, index) => {
      const average = Math.round(user.average)
      const bestScore = Math.round(score(user.best))
      return <article key={user.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="grid gap-5 xl:grid-cols-[minmax(15rem,1fr)_minmax(18rem,1.4fr)_minmax(17rem,1.2fr)] xl:items-center xl:gap-0">
        <div className="flex min-w-0 gap-4 xl:pr-5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-violet-50 text-lg font-bold text-violet-600">{index + 1}</span><div className="min-w-0"><p className="truncate text-lg font-bold tracking-tight text-slate-900">{user.name}</p><SubmissionReviewButton submission={user.best} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 hover:text-indigo-900 hover:underline"><span aria-hidden="true">↗</span>Open submission</SubmissionReviewButton></div></div>
        <dl className="grid min-w-0 gap-2 border-y border-slate-100 py-4 text-sm xl:border-y-0 xl:border-x xl:px-5 xl:py-0"><div className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-2"><dt className="text-slate-500"><EmailIcon /></dt><dd className="truncate text-slate-600">{user.email}</dd></div><div className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-2"><dt className="text-slate-500"><TestIcon /></dt><dd className="truncate font-medium text-slate-800">{user.best.testTitle}</dd></div><div className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-2"><dt className="text-slate-500"><GroupIcon /></dt><dd className="truncate text-slate-600">{user.groups.join(', ') || 'No exam batch'}</dd></div></dl>
        <div className="grid grid-cols-3 justify-items-start gap-3 xl:px-5"><ScoreRing value={100} display={String(user.attempts.length)} label="Attempts" color="#6366f1" /><ScoreRing value={average} display={`${average}%`} label="Average" color="#7657f6" /><ScoreRing value={bestScore} display={`${bestScore}%`} label="Best" color="#10b981" /></div>
      </div>
      </article>
    })}</div>
    {!users.length && <Empty text="No learner attempts are available yet." />}
  </section>
}

function ScoreRing({ value, display, label, color }: { value: number; display: string; label: string; color: string }) {
  const radius = 39
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.max(0, Math.min(100, value)) / 100)
  return <div className="grid justify-items-center gap-2">
    <div className="relative grid h-20 w-20 place-items-center"><svg aria-hidden="true" viewBox="0 0 96 96" className="absolute inset-0 h-full w-full -rotate-90"><circle cx="48" cy="48" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="8" /><circle cx="48" cy="48" r={radius} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} /></svg><p className="relative text-base font-black leading-none text-slate-900">{display}</p></div>
    <p className="text-xs font-semibold text-slate-500">{label}</p>
  </div>
}

function TestIcon() { return <svg aria-label="Test" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></svg> }
function EmailIcon() { return <svg aria-label="Email" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg> }
function GroupIcon() { return <svg aria-label="Batch" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg> }

function ScoreAnalysisModal({ stats: examStats, attempts: examAttempts, tests, tabs, setTab, close, initialTestId = '', dashboardLabel = 'EXAM DASHBOARD', dashboardName = examStats.exam.name, lockedTest, canEdit = false, action, scopeLabel = 'exam' }: { stats: ExamStats;
attempts: Submission[];
tests: MockTest[];
tabs: readonly (readonly [ModalTab, string])[];
setTab: (tab: ModalTab) => void;
close: () => void;
initialTestId?: string;
dashboardLabel?: string;
dashboardName?: string;
lockedTest?: MockTest;
canEdit?: boolean;
action?: { label: string; onClick: () => void };
scopeLabel?: 'exam' | 'group' | 'user' }) {
  const [selectedTestId, setSelectedTestId] = useState(initialTestId);
const [selectedUsersPage, setSelectedUsersPage] = useState(1);
const attempts = selectedTestId ? examAttempts.filter(item => item.testId === selectedTestId) : examAttempts;
const stats = { ...examStats, average: attempts.length ? attempts.reduce((sum, item) => sum + score(item), 0) / attempts.length : 0, students: new Set(attempts.map(item => item.userId)).size };
const selectedTest = tests.find(test => test.id === selectedTestId);
const daily = new Map<string, Submission[]>();
attempts.forEach(item => { const date = item.submittedAt?.toDate?.();
if (date) { const key = date.toLocaleDateString();
daily.set(key, [...(daily.get(key) || []), item]) } });
const labels = [...daily.keys()];
const [savedSelectedDate, setSelectedDate] = useState(labels[labels.length - 1] || '');
const activeSelectedDate = labels.includes(savedSelectedDate) ? savedSelectedDate : labels[labels.length - 1] || '';
const selectedDate = activeSelectedDate;
const selectedAttempts = daily.get(activeSelectedDate) || [];
const selectedUsers = [...new Map(selectedAttempts.map(item => [item.userId, { name: item.userName || item.userEmail || item.userId, email: item.userEmail || item.userId, attempts: selectedAttempts.filter(attempt => attempt.userId === item.userId) }])).entries()];
const visibleSelectedUsers = paginate(selectedUsers, selectedUsersPage);
const averageByDay = labels.map(label => { const values = daily.get(label) || [];
return Math.round(values.reduce((sum, item) => sum + score(item), 0) / values.length) });
const countByDay = labels.map(label => scopeLabel === 'user' ? (daily.get(label) || []).length : new Set((daily.get(label) || []).map(item => item.userId)).size);
const byTest = tests.map(test => { const values = attempts.filter(item => item.testId === test.id);
 return { test, values, average: values.length ? values.reduce((sum, item) => sum + score(item), 0) / values.length : 0, highest: values.length ? Math.max(...values.map(score)) : 0, lowest: values.length ? Math.min(...values.map(score)) : 0 } }).filter(item => item.values.length);
const highestTest = byTest.slice().sort((a, b) => b.average - a.average)[0];
const lowestTest = byTest.slice().sort((a, b) => a.average - b.average)[0];
const highestUser = attempts.slice().sort((a, b) => score(b) - score(a))[0];
const lowestUser = attempts.slice().sort((a, b) => score(a) - score(b))[0];
const option = (name: string, data: number[], color: string) => ({ tooltip: { trigger: 'axis' }, grid: { left: 38, right: 16, top: 28, bottom: 48 }, xAxis: { type: 'category', data: labels, axisLabel: { rotate: 35 } }, yAxis: { type: 'value', min: 0, max: name.includes('Score') ? 100 : undefined }, series: [{ name, type: 'line', smooth: true, data, areaStyle: { color: `${color}22` }, lineStyle: { color, width: 3 }, itemStyle: { color } }] })
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={close}>
<div className="h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()}>
<div className="flex items-start justify-between gap-3 border-b border-slate-200 p-6">
<div>
<p className="text-xs font-bold tracking-widest text-indigo-600">{dashboardLabel}</p>
<h2 className="mt-1 text-2xl font-black">{dashboardName}</h2>
</div>
<div className="flex gap-2">{action && <button type="button" onClick={action.onClick} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-700">{action.label}</button>}{lockedTest && canEdit && <Link href={`/tests/${lockedTest.id}/edit`} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-700">Edit test</Link>}<button type="button" onClick={close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Close</button></div>
</div>
<div className="flex overflow-x-auto border-b border-slate-200 px-4">{tabs.map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} className={`shrink-0 border-b-2 px-3 py-3 text-sm font-bold ${id === 'scores' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'}`}>{label}</button>)}</div>
<div className="space-y-6 p-6">
{!lockedTest && <label className="block max-w-md text-sm font-bold">Test
<div className="mt-2 font-normal"><SearchPicker value={selectedTestId} options={[{ id: '', label: `All tests in this ${scopeLabel}` }, ...tests.map(test => ({ id: test.id, label: test.title, detail: test.category || undefined }))]} onChange={option => { setSelectedTestId(option.id); setSelectedUsersPage(1) }} placeholder="Search tests" /></div><select value={selectedTestId} onChange={event => { setSelectedTestId(event.target.value); setSelectedUsersPage(1) }} className="hidden" aria-hidden="true" tabIndex={-1}>
<option value="">{`All tests in this ${scopeLabel}`}</option>{tests.map(test => <option key={test.id} value={test.id}>{test.title}</option>)}</select>
</label>}
<div className="grid gap-4 sm:grid-cols-3">
<ModalStat label="Average score" value={attempts.length ? `${Math.round(stats.average)}%` : '—'} />

<ModalStat label="Attempts" value={attempts.length} />

<ModalStat label="Students" value={stats.students} />

</div>{labels.length ? <div className="grid gap-6 lg:grid-cols-2">
<Chart title="Average score by date" option={option('Average score', averageByDay, '#4f46e5')} labels={labels} onDateSelect={date => { setSelectedDate(date); setSelectedUsersPage(1) }} />

<Chart title={scopeLabel === 'user' ? `Tests taken${selectedTest ? ` for ${selectedTest.title}` : ''} by date` : `Students who took this ${selectedTest ? 'test' : scopeLabel} by date`} option={option(scopeLabel === 'user' ? 'Tests' : 'Students', countByDay, '#059669')} labels={labels} onDateSelect={date => { setSelectedDate(date); setSelectedUsersPage(1) }} />

</div> : <Empty text="Date charts will appear once submissions have saved timestamps." />
}{labels.length > 0 && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xl font-bold tracking-tight text-slate-900">Students on {selectedDate}</h3><span className="text-sm font-medium text-slate-500">{selectedUsers.length} student{selectedUsers.length === 1 ? '' : 's'}</span></div><div className="mt-4 space-y-3">{visibleSelectedUsers.items.map(([id, item]) => { const average = item.attempts.reduce((sum, attempt) => sum + score(attempt), 0) / item.attempts.length; return <SubmissionUserCard key={id} submission={item.attempts[0]} average={average} attemptCount={item.attempts.length} /> })}</div>{!selectedUsers.length && <p className="mt-3 text-sm text-slate-500">No students submitted on this date.</p>}<Pagination page={visibleSelectedUsers.page} totalItems={selectedUsers.length} onPageChange={setSelectedUsersPage} itemLabel="students" className="mt-4 rounded-xl border border-slate-200" /></section>}
{!lockedTest && <div className="grid gap-4 md:grid-cols-2">
<PerformanceTestCard label="Highest performing test" data={highestTest} totalUsers={stats.groupUsers} />

<PerformanceTestCard label="Lowest performing test" data={lowestTest} totalUsers={stats.groupUsers} />

</div>}
<div className="space-y-6">
<PerformanceUserCard label="Highest score student" data={highestUser} />

<PerformanceUserCard label="Lowest score student" data={lowestUser} />

</div>
</div>
</div>
</div>
}

export function TestDashboardModal({ test, close }: { test: MockTest; close: () => void }) {
  const { user, profile } = useAuth()
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!user || !profile) return
    if (profile.role === 'user') {
      let active = true
      void user.getIdToken().then(async token => {
        const response = await fetch(`/api/test-submissions?testId=${encodeURIComponent(test.id)}`, {
          headers: { authorization: `Bearer ${token}` },
        })
        const payload = await response.json().catch(() => ({})) as {
          submissions?: Array<Omit<Submission, 'submittedAt'> & { submittedAt?: string | null }>
          error?: string
        }
        if (!response.ok) throw new Error(payload.error || 'Unable to load test dashboard data.')
        if (!active) return
        setSubmissions((payload.submissions || []).map(item => {
          const { submittedAt, ...submission } = item
          return {
            ...submission,
            ...(submittedAt ? { submittedAt: { toDate: () => new Date(submittedAt) } } : {}),
          }
        }))
      }).catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load test dashboard data.')
      })
      return () => { active = false }
    }
    const source = profile.role === 'admin'
      ? query(collection(db, 'submissions'), where('testId', '==', test.id))
      : query(collection(db, 'submissions'), where('testId', '==', test.id), where('organisationIds', 'array-contains', user.uid))
    return onSnapshot(source, snapshot => setSubmissions(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as Submission).filter(item => item.gradingStatus !== 'pending')), reason => setError(reason.message))
  }, [profile, test.id, user])
  const [tab, setTab] = useState<ModalTab>('scores')
  const canEdit = profile?.role === 'admin'
    || ((profile?.role === 'organisation' || profile?.role === 'user') && test.createdBy === user?.uid)
  const students = new Set(submissions.map(item => item.userId)).size
  const average = submissions.length ? submissions.reduce((sum, item) => sum + score(item), 0) / submissions.length : 0
  const stats: ExamStats = { exam: { id: test.id, name: test.title }, tests: 1, groups: 0, groupUsers: students, attempts: submissions.length, students, average, completion: 0 }
  const tabs = [['scores', 'Score analysis'], ['details', 'Test details'], ['users', 'Student list']] as const
  if (tab === 'details') return <TestDetailsModal test={test} canEdit={canEdit} tabs={tabs} setTab={setTab} close={close} />
  if (tab === 'users') return <TestUserListModal test={test} canEdit={canEdit} submissions={submissions} tabs={tabs} setTab={setTab} close={close} />
  return <>{error && <p className="sr-only">Could not load test dashboard data: {error}</p>}<ScoreAnalysisModal stats={stats} attempts={submissions} tests={[test]} tabs={tabs} setTab={setTab} close={close} initialTestId={test.id} dashboardLabel="TEST DASHBOARD" dashboardName={test.title} lockedTest={test} canEdit={canEdit} /></>
}

export function GroupDashboardModal({ group, submissions, tests, edit, close }: { group: Group; submissions: Submission[]; tests: MockTest[]; edit: () => void; close: () => void }) {
  const [tab, setTab] = useState<ModalTab>('scores')
  const memberIds = new Set(group.members.map(member => member.userId))
  const attempts = submissions.filter(item => memberIds.has(item.userId))
  const groupTests = tests.filter(test => attempts.some(item => item.testId === test.id))
  const students = new Set(attempts.map(item => item.userId)).size
  const average = attempts.length ? attempts.reduce((sum, item) => sum + score(item), 0) / attempts.length : 0
  const stats: ExamStats = { exam: { id: group.id, name: group.name }, tests: groupTests.length, groups: 1, groupUsers: group.members.length, attempts: attempts.length, students, average, completion: group.members.length ? students / group.members.length * 100 : 0 }
  const tabs = [['scores', 'Score analysis'], ['details', 'Batch details'], ['users', 'Student list']] as const
  if (tab === 'scores') return <ScoreAnalysisModal stats={stats} attempts={attempts} tests={groupTests} tabs={tabs} setTab={setTab} close={close} dashboardLabel="BATCH DASHBOARD" dashboardName={group.name} action={{ label: 'Edit batch', onClick: edit }} scopeLabel="group" />
  return <DashboardModalShell label="BATCH DASHBOARD" name={group.name} activeTab={tab} tabs={tabs} setTab={setTab} edit={edit} close={close}>
    {tab === 'details' ? <section><h3 className="text-xl font-bold">Batch details</h3><dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[['Batch name', group.name], ['Members', String(group.members.length)], ['Exam goal', group.targetExamName || 'No exam goal'], ['Tests attempted', String(groupTests.length)], ['Total attempts', String(attempts.length)], ['Participation', group.members.length ? `${Math.round(stats.completion)}%` : '—']].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 font-semibold text-slate-900">{value}</dd></div>)}</dl></section> : <ExamUserList attempts={attempts} tests={groupTests} groups={[group]} assignments={[]} dashboardType="group" />}
  </DashboardModalShell>
}

export function OrganisationUserDashboardModal({ account, submissions, tests, goals, close }: { account: { uid: string; name: string; email: string }; submissions: Submission[]; tests: MockTest[]; goals: { id: string; name: string; examId?: string; examName?: string }[]; close: () => void }) {
  const [tab, setTab] = useState<ModalTab>('scores')
  const attempts = submissions.filter(item => item.userId === account.uid)
  const userTests = tests.filter(test => attempts.some(item => item.testId === test.id))
  const average = attempts.length ? attempts.reduce((sum, item) => sum + score(item), 0) / attempts.length : 0
  const stats: ExamStats = { exam: { id: account.uid, name: account.name }, tests: userTests.length, groups: goals.length, groupUsers: 1, attempts: attempts.length, students: attempts.length ? 1 : 0, average, completion: 0 }
  const tabs = [['scores', 'Score analysis'], ['goals', 'Exam goal progress'], ['attendance', 'Attendance']] as const
  if (tab === 'scores') return <ScoreAnalysisModal stats={stats} attempts={attempts} tests={userTests} tabs={tabs} setTab={setTab} close={close} dashboardLabel="STUDENT DASHBOARD" dashboardName={account.name} scopeLabel="user" />
  return <DashboardModalShell label="STUDENT DASHBOARD" name={account.name} activeTab={tab} tabs={tabs} setTab={setTab} close={close}>{tab === 'attendance' ? <StudentAttendancePanel studentId={account.uid} /> : <ExamGoalProgress goals={goals} attempts={attempts} tests={tests} />}</DashboardModalShell>
}

function ExamGoalProgress({ goals, attempts, tests }: { goals: { id: string; name: string; examId?: string; examName?: string }[]; attempts: Submission[]; tests: MockTest[] }) {
  const [page, setPage] = useState(1)
  const testMap = new Map(tests.map(test => [test.id, test]))
  const visibleGoals = paginate(goals, page, 5)
  if (!goals.length) return <Empty text="This student is not in a batch with an exam goal." />
  return <section className="space-y-6"><div><h3 className="text-xl font-bold tracking-tight text-slate-900">Exam goal progress</h3><p className="mt-1 text-sm text-slate-500">Performance is calculated from this student’s submissions for each exam assigned through their batches.</p></div>{visibleGoals.items.map(goal => {
    const goalAttempts = attempts.filter(item => (!!goal.examId && (item.testExamId === goal.examId || testMap.get(item.testId)?.examId === goal.examId)) || (!!goal.examName && (item.testExam === goal.examName || testMap.get(item.testId)?.exam === goal.examName)))
    const values = goalAttempts.map(score)
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
    const daily = new Map<string, number>()
    goalAttempts.forEach(item => { const date = item.submittedAt?.toDate?.(); if (date) { const key = date.toLocaleDateString(); daily.set(key, (daily.get(key) || 0) + 1) } })
    const labels = [...daily.keys()]
    const option = { tooltip: { trigger: 'axis' }, grid: { left: 42, right: 18, top: 28, bottom: 48 }, xAxis: { type: 'category', data: labels, axisLabel: { rotate: 35 } }, yAxis: { type: 'value', minInterval: 1, name: 'Tests' }, series: [{ name: 'Tests taken', type: 'line', smooth: true, data: labels.map(label => daily.get(label) || 0), areaStyle: { color: '#05966922' }, lineStyle: { color: '#059669', width: 3 }, itemStyle: { color: '#059669' } }] }
    return <article key={goal.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Exam goal</p><h4 className="mt-1 text-xl font-black text-slate-950">{goal.examName || 'Unassigned exam'}</h4><p className="mt-1 text-sm text-slate-500">Assigned through {goal.name}</p></div><p className="text-sm font-semibold text-slate-500">{new Set(goalAttempts.map(item => item.testId)).size} unique test{new Set(goalAttempts.map(item => item.testId)).size === 1 ? '' : 's'}</p></div><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><ModalStat label="Attempts" value={goalAttempts.length} /><ModalStat label="Average score" value={values.length ? `${Math.round(average)}%` : '—'} /><ModalStat label="Lowest score" value={values.length ? `${Math.round(Math.min(...values))}%` : '—'} /><ModalStat label="Highest score" value={values.length ? `${Math.round(Math.max(...values))}%` : '—'} /></div><div className="mt-6">{labels.length ? <Chart title="Tests taken by date" option={option} labels={[]} onDateSelect={() => undefined} /> : <Empty text="A dated submission for this exam is needed to show progress by date." />}</div></article>
  })}<Pagination page={visibleGoals.page} pageSize={5} totalItems={goals.length} onPageChange={setPage} itemLabel="exam goals" className="rounded-xl border border-slate-200 bg-white" /></section>
}

function DashboardModalShell({ label, name, activeTab, tabs, setTab, edit, close, children }: { label: string; name: string; activeTab: ModalTab; tabs: readonly (readonly [ModalTab, string])[]; setTab: (tab: ModalTab) => void; edit?: () => void; close: () => void; children: React.ReactNode }) {
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={close}><div className="h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()}><div className="flex items-start justify-between gap-3 border-b border-slate-200 p-6"><div><p className="text-xs font-bold tracking-widest text-indigo-600">{label}</p><h2 className="mt-1 text-2xl font-black">{name}</h2></div><div className="flex gap-2">{edit && <button type="button" onClick={edit} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-700">Edit batch</button>}<button type="button" onClick={close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Close</button></div></div><div className="flex overflow-x-auto border-b border-slate-200 px-4">{tabs.map(([id, tabLabel]) => <button key={id} type="button" onClick={() => setTab(id)} className={`shrink-0 border-b-2 px-3 py-3 text-sm font-bold ${id === activeTab ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'}`}>{tabLabel}</button>)}</div><div className="space-y-6 p-6">{children}</div></div></div>
}

function TestDetailsModal({ test, canEdit, tabs, setTab, close }: { test: MockTest; canEdit: boolean; tabs: readonly (readonly [ModalTab, string])[]; setTab: (tab: ModalTab) => void; close: () => void }) {
  const details = [['Exam', test.examAlias || test.exam || 'Unassigned exam'], ['Category', test.category || 'Uncategorised'], ['Questions', String(test.questionCount ?? test.questions?.length ?? 0)], ['Total marks', String(test.totalMarks ?? test.questions?.reduce((sum, item) => sum + item.marks, 0) ?? 0)], ['Duration', test.durationMinutes ? `${test.durationMinutes} min` : '—']]
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={close}><div className="h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()}><div className="flex items-start justify-between gap-3 border-b border-slate-200 p-6"><div><p className="text-xs font-bold tracking-widest text-indigo-600">TEST DASHBOARD</p><h2 className="mt-1 text-2xl font-black">{test.title}</h2></div><div className="flex gap-2">{canEdit && <Link href={`/tests/${test.id}/edit`} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-700">Edit test</Link>}<button type="button" onClick={close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Close</button></div></div><div className="flex overflow-x-auto border-b border-slate-200 px-4">{tabs.map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} className={`shrink-0 border-b-2 px-3 py-3 text-sm font-bold ${id === 'details' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'}`}>{label}</button>)}</div><div className="space-y-6 p-6"><section><h3 className="text-xl font-bold">Test details</h3><dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{details.map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 font-semibold text-slate-900">{value}</dd></div>)}</dl></section>{test.description && <section><h3 className="text-xl font-bold">Description</h3><p className="mt-2 text-slate-600">{test.description}</p></section>}</div></div></div>
}

function TestUserListModal({ test, canEdit, submissions, tabs, setTab, close }: { test: MockTest; canEdit: boolean; submissions: Submission[]; tabs: readonly (readonly [ModalTab, string])[]; setTab: (tab: ModalTab) => void; close: () => void }) {
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={close}><div className="h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()}><div className="flex items-start justify-between gap-3 border-b border-slate-200 p-6"><div><p className="text-xs font-bold tracking-widest text-indigo-600">TEST DASHBOARD</p><h2 className="mt-1 text-2xl font-black">{test.title}</h2></div><div className="flex gap-2">{canEdit && <Link href={`/tests/${test.id}/edit`} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-700">Edit test</Link>}<button type="button" onClick={close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Close</button></div></div><div className="flex overflow-x-auto border-b border-slate-200 px-4">{tabs.map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} className={`shrink-0 border-b-2 px-3 py-3 text-sm font-bold ${id === 'users' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'}`}>{label}</button>)}</div><div className="p-6"><ExamUserList attempts={submissions} tests={[test]} groups={[]} assignments={[]} dashboardType="test" /></div></div></div>
}

function PerformanceTestCard({ label, data, totalUsers }: { label: string; data?: { test: MockTest; average: number; highest: number; lowest: number; values: Submission[] }; totalUsers: number }) { const attemptedStudents = data ? new Set(data.values.map((item) => item.userId)).size : 0; const organisationUsers = totalUsers || attemptedStudents; const studentPercentage = organisationUsers ? Math.round(attemptedStudents / organisationUsers * 100) : 0; return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="text-xl font-bold tracking-tight text-slate-900">{label}</h3>{data ? <><p className="mt-4 truncate text-lg font-bold text-slate-900">{data.test.title}</p><div className="mt-5 grid grid-cols-2 justify-items-start gap-3 sm:grid-cols-4"><ScoreRing value={Math.round(data.average)} display={`${Math.round(data.average)}%`} label="Average" color="#7657f6" /><ScoreRing value={Math.round(data.highest)} display={`${Math.round(data.highest)}%`} label="Highest" color="#10b981" /><ScoreRing value={Math.round(data.lowest)} display={`${Math.round(data.lowest)}%`} label="Lowest" color="#f59e0b" /><ScoreRing value={studentPercentage} display={`${attemptedStudents}/${organisationUsers}`} label="Students" color="#0ea5e9" /></div></> : <Empty text="No completed tests yet." />}</section> }

function PerformanceUserCard({ label, data }: { label: string; data?: Submission }) { return <section><h3 className="text-xl font-bold tracking-tight text-slate-900">{label}</h3>{data ? <div className="mt-3"><SubmissionUserCard submission={data} /></div> : <Empty text="No learner attempts yet." />}</section> }

function SubmissionUserCard({ submission, average, attemptCount = 1 }: { submission: Submission; average?: number; attemptCount?: number }) { const percentage = Math.round(average ?? score(submission)); const correctPercentage = submission.questionCount ? Math.round(submission.correctAnswers / submission.questionCount * 100) : 0; return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="grid gap-5 xl:grid-cols-[minmax(11rem,.8fr)_minmax(18rem,1.4fr)_minmax(17rem,1.2fr)] xl:items-center xl:gap-0"><div className="min-w-0 xl:pr-5"><p className="truncate text-lg font-bold tracking-tight text-slate-900">{submission.userName || submission.userEmail || submission.userId}</p><p className="mt-1 truncate text-xs text-slate-500">{submission.userEmail || submission.userId}</p><SubmissionReviewButton submission={submission} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 hover:text-indigo-900 hover:underline"><span aria-hidden="true">↗</span>Open submission</SubmissionReviewButton></div><dl className="grid min-w-0 gap-2 border-y border-slate-100 py-4 text-sm xl:border-y-0 xl:border-x xl:px-5 xl:py-0"><div className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-2"><dt className="text-slate-500"><EmailIcon /></dt><dd className="truncate text-slate-600">{submission.userEmail || submission.userId}</dd></div><div className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-2"><dt className="text-slate-500"><TestIcon /></dt><dd className="truncate font-medium text-slate-800">{submission.testTitle}</dd></div><div className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-2"><dt className="text-slate-500"><GroupIcon /></dt><dd className="truncate text-slate-600">{submission.testCategory || 'Uncategorised'}</dd></div></dl><div className="grid grid-cols-3 justify-items-start gap-3 xl:px-5"><ScoreRing value={100} display={String(attemptCount)} label="Attempts" color="#6366f1" /><ScoreRing value={percentage} display={`${percentage}%`} label="Score" color="#7657f6" /><ScoreRing value={correctPercentage} display={`${correctPercentage}%`} label="Correct" color="#10b981" /></div></div></article> }

function Chart({ title, option, labels, onDateSelect }: { title: string; option: object; labels: string[]; onDateSelect: (date: string) => void }) { return <section className="rounded-xl border border-slate-200 p-4">
<h3 className="font-bold">{title}</h3>
<ReactECharts option={option} onEvents={{ click: (event: { dataIndex?: number }) => { if (typeof event.dataIndex === 'number' && labels[event.dataIndex]) onDateSelect(labels[event.dataIndex]) } }} style={{ height: 260 }} notMerge lazyUpdate />

</section> }
// Kept for backwards-compatible internal rendering paths.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function TestPerformance({ label, data }: { label: string;
data?: { test: MockTest;
average: number;
highest: number;
lowest: number } }) { return <section className="rounded-xl border border-slate-200 p-4">
<p className="text-sm font-bold text-slate-500">{label}</p>{data ? <>
<p className="mt-2 text-lg font-black">{data.test.title}</p>
<p className="mt-2 text-sm">Average score: <b>{Math.round(data.average)}%</b>
</p>
<p className="text-sm">Highest score: <b>{Math.round(data.highest)}%</b>
</p>
<p className="text-sm">Lowest score: <b>{Math.round(data.lowest)}%</b>
</p>
</> : <p className="mt-3 text-sm text-slate-500">No completed tests yet.</p>}</section> }
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function UserScore({ label, data }: { label: string;
data?: Submission }) { return <section className="rounded-xl border border-slate-200 p-4">
<p className="text-sm font-bold text-slate-500">{label}</p>{data ? <>
<div className="mt-2"><UserIdentity name={data.userName || data.userEmail || data.userId} email={data.userEmail || data.userId} /></div>
<p className="mt-2 text-sm">{data.score}/{data.totalMarks} · <b>{Math.round(score(data))}%</b>
</p>
<SubmissionReviewButton submission={data} className="mt-3 inline-block text-sm font-bold text-indigo-700 hover:underline">Open submission</SubmissionReviewButton>
</> : <p className="mt-3 text-sm text-slate-500">No learner attempts yet.</p>}</section> }

function UserIdentity({ name, email }: { name: string; email: string }) { return <div className="min-w-0"><p className="truncate font-semibold">{name}</p><p className="mt-1 truncate text-xs text-slate-500">{email}</p></div> }

function Metric({ icon, label, value, note }: { icon: 'tests' | 'students' | 'groups' | 'attempts'; label: string;
value: string | number;
note: string }) { return <div className="flex min-w-0 items-center gap-4 border-b border-slate-200 p-4 last:border-b-0 sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:border-r lg:last:border-r-0">
<span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-violet-100 bg-violet-50 text-violet-600"><DashboardIcon name={icon} className="h-7 w-7" /></span>
<div className="min-w-0"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-3xl font-bold leading-none text-slate-950">{value}</p><p className="mt-3 text-xs leading-relaxed text-slate-500">{note}</p></div>
</div> }
function DashboardIcon({ name, className }: { name: 'tests' | 'students' | 'groups' | 'attempts' | 'trophy' | 'star'; className: string }) {
  if (name === 'tests') return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4a3 3 0 0 1 6 0M9 10h6M9 14h6M9 18h4" /></svg>
  if (name === 'students') return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="4" /><path d="M2 21v-2a7 7 0 0 1 14 0v2M17 4a4 4 0 0 1 0 8M22 21v-2a7 7 0 0 0-3-6" /></svg>
  if (name === 'groups') return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="7" r="3" /><circle cx="5" cy="10" r="2" /><circle cx="19" cy="10" r="2" /><path d="M7 21v-1a5 5 0 0 1 10 0v1M1 20v-1a4 4 0 0 1 5-4M23 20v-1a4 4 0 0 0-5-4" /></svg>
  if (name === 'attempts') return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="7" r="4" /><path d="M4 22v-2a8 8 0 0 1 16 0v2" /></svg>
  if (name === 'trophy') return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM9 20h6M12 13v7M5 5H3v2a4 4 0 0 0 4 4M19 5h2v2a4 4 0 0 1-4 4" /></svg>
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2l-5-4.9 6.9-1Z" /></svg>
}
function Cell({ label, value }: { label: string;
value: string | number }) { return <div>
<p className="text-xs font-bold uppercase text-slate-400 lg:hidden">{label}</p>
<p className="font-bold text-indigo-700">{value}</p>
</div> }
function ModalStat({ label, value }: { label: string;
value: string | number }) { return <div className="rounded-xl bg-indigo-50 p-4">
<p className="text-sm font-bold text-indigo-800">{label}</p>
<p className="mt-2 text-2xl font-black">{value}</p>
</div> }
function Empty({ text }: { text: string }) { return <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{text}</p> }



