'use client'

import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from './auth-context'
import { SearchPicker } from './search-picker'
import { paginate, Pagination } from './pagination'
import type { Submission } from './test-types'
import { SubmissionAnswersModal } from './submission-answers-modal'

type Invite = { organisationId: string; organisationEmail: string; status: 'accepted' | 'pending' | 'declined' }
type TestMetadata = { exam: string; category: string }

const dateOf = (submission: Submission) => submission.submittedAt?.toDate?.()
const formatDate = (submission: Submission) => dateOf(submission)?.toLocaleString() ?? 'Saving…'

export function SubmissionsDashboard({ initialSubmissionId, initialUserId }: { initialSubmissionId?: string; initialUserId?: string }) {
  const { user, profile } = useAuth()
  const role = profile?.role ?? 'user'
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [testMetadata, setTestMetadata] = useState<Record<string, TestMetadata>>({})
  const [invites, setInvites] = useState<Invite[]>([])
  const [error, setError] = useState('')
  const [testId, setTestId] = useState('')
  const [exam, setExam] = useState('')
  const [category, setCategory] = useState('')
  const [userId, setUserId] = useState(initialUserId || '')
  const [organisationId, setOrganisationId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sortBy, setSortBy] = useState<'newest' | 'highest-score' | 'lowest-score'>('newest')
  const [reviewing, setReviewing] = useState<Submission | null>(null)
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (!user) return
    const source = role === 'admin' ? collection(db, 'submissions') : role === 'organisation' ? query(collection(db, 'submissions'), where('organisationIds', 'array-contains', user.uid)) : query(collection(db, 'submissions'), where('userId', '==', user.uid))
    return onSnapshot(source, (snapshot) => {
      const loaded = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Submission).sort((a, b) => (dateOf(b)?.getTime() ?? 0) - (dateOf(a)?.getTime() ?? 0))
      setSubmissions(loaded)
      const requestedSubmission = initialSubmissionId ? loaded.find((item) => item.id === initialSubmissionId) : undefined
      if (requestedSubmission) setReviewing(requestedSubmission)
      setError('')
    }, (reason) => setError(`Could not load submissions: ${reason.message}`))
  }, [initialSubmissionId, role, user])

  useEffect(() => {
    let active = true
    const testIds = [...new Set(submissions.map((item) => item.testId))]
    if (testIds.length === 0) return
    void Promise.all(testIds.map(async (id) => {
      const result = await getDoc(doc(db, 'tests', id))
      const data = result.exists() ? result.data() : null
      return [id, { exam: typeof data?.exam === 'string' ? data.exam : 'Unassigned', category: typeof data?.category === 'string' ? data.category : 'Uncategorised' }] as const
    })).then((entries) => { if (active) setTestMetadata(Object.fromEntries(entries)) }).catch(() => { if (active) setTestMetadata({}) })
    return () => { active = false }
  }, [submissions])

  useEffect(() => {
    if (!user || role !== 'user') return
    return onSnapshot(query(collection(db, 'organisationInvites'), where('userId', '==', user.uid)), (snapshot) => setInvites(snapshot.docs.map((item) => item.data() as Invite).filter((item) => item.status === 'accepted')))
  }, [role, user])

  const tests = useMemo(() => [...new Map(submissions.map((item) => [item.testId, item.testTitle])).entries()], [submissions])
  const submissionExam = (item: Submission) => testMetadata[item.testId]?.exam || item.testExam || 'Unassigned'
  const submissionCategory = (item: Submission) => testMetadata[item.testId]?.category || item.testCategory
  const exams = [...new Set(submissions.map(submissionExam))].sort()
  const categories = [...new Set(submissions.filter((item) => !exam || submissionExam(item) === exam).map(submissionCategory))].sort()
  const users = useMemo(() => {
    const uniqueUsers = new Map<string, { id: string; label: string; detail?: string }>()
    submissions.forEach((item) => {
      if (uniqueUsers.has(item.userId)) return
      const email = item.userEmail || item.userId
      const name = item.userName?.trim()
      uniqueUsers.set(item.userId, { id: item.userId, label: name || email, detail: name && name !== email ? email : undefined })
    })
    return [...uniqueUsers.values()]
  }, [submissions])
  const organisations = useMemo(() => {
    const labels = new Map(invites.map((item) => [item.organisationId, item.organisationEmail]))
    submissions.flatMap((item) => item.organisationIds ?? []).forEach((id) => { if (!labels.has(id)) labels.set(id, id) })
    return [...labels.entries()]
  }, [invites, submissions])
  const filtered = submissions.filter((item) => {
    const date = dateOf(item)
    return (!testId || item.testId === testId) && (!exam || submissionExam(item) === exam) && (!category || submissionCategory(item) === category) && (!userId || item.userId === userId) && (!organisationId || item.organisationIds?.includes(organisationId)) && (!from || (date && date >= new Date(`${from}T00:00:00`))) && (!to || (date && date <= new Date(`${to}T23:59:59.999`)))
  }).sort((a, b) => {
    const scoreOf = (item: Submission) => item.totalMarks ? item.score / item.totalMarks : 0
    if (sortBy === 'highest-score') return scoreOf(b) - scoreOf(a)
    if (sortBy === 'lowest-score') return scoreOf(a) - scoreOf(b)
    return (dateOf(b)?.getTime() ?? 0) - (dateOf(a)?.getTime() ?? 0)
  })
  const title = role === 'admin' ? 'All submissions' : role === 'organisation' ? 'Member submissions' : 'My submissions'
  const visibleSubmissions = paginate(filtered, page)

  if (!user) return null
  return <section>
    <h1 className="text-4xl font-black">{title}</h1>
    <p className="mt-3 text-slate-600">{role === 'admin' ? 'Review every saved test attempt.' : role === 'organisation' ? 'Review attempts from users who were members of your institute when they submitted.' : 'Review your completed mock-test attempts.'}</p>
    <div className="mt-7 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-3">
      <Filter label="Test"><SearchPicker value={testId} options={[{ id: '', label: 'All tests' }, ...tests.map(([id, label]) => ({ id, label }))]} onChange={(option) => { setTestId(option.id); setPage(1) }} placeholder="Search tests" /></Filter>
      <Filter label="Exam"><SearchPicker value={exam} options={[{ id: '', label: 'All exams' }, ...exams.map((label) => ({ id: label, label }))]} onChange={(option) => { setExam(option.id); setCategory(''); setTestId(''); setPage(1) }} placeholder="Search exams" /></Filter>
      <Filter label="Test category"><SearchPicker value={category} options={[{ id: '', label: 'All categories' }, ...categories.map((label) => ({ id: label, label }))]} onChange={(option) => { setCategory(option.id); setTestId(''); setPage(1) }} placeholder="Search categories" /></Filter>
      {role !== 'user' && <Filter label="User"><SearchPicker value={userId} options={[{ id: '', label: 'All users' }, ...users]} onChange={(option) => { setUserId(option.id); setPage(1) }} placeholder="Search by name or email" /></Filter>}
      {role !== 'organisation' && <Filter label="Institute"><SearchPicker value={organisationId} options={[{ id: '', label: 'All institutes' }, ...organisations.map(([id, label]) => ({ id, label }))]} onChange={(option) => { setOrganisationId(option.id); setPage(1) }} placeholder="Search institutes" /></Filter>}
      <Filter label="From date"><input value={from} onChange={(event) => { setFrom(event.target.value); setPage(1) }} type="date" /></Filter>
      <Filter label="To date"><input value={to} onChange={(event) => { setTo(event.target.value); setPage(1) }} type="date" /></Filter>
      <Filter label="Sort submissions"><SearchPicker value={sortBy} options={[{ id: 'newest', label: 'Newest first' }, { id: 'highest-score', label: 'Highest score' }, { id: 'lowest-score', label: 'Lowest score' }]} onChange={(option) => { setSortBy(option.id as typeof sortBy); setPage(1) }} placeholder="Choose sort order" /></Filter>
    </div>
    {error && <p className="mt-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
    <div className="mt-7 space-y-3">
      {visibleSubmissions.items.map((item) => <SubmissionCard key={item.id} submission={item} exam={submissionExam(item)} openAnswers={() => setReviewing(item)} />)}
      {filtered.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">No submissions match these filters.</p>}
      <Pagination page={visibleSubmissions.page} totalItems={filtered.length} onPageChange={setPage} itemLabel="submissions" className="rounded-xl border border-slate-200 bg-white" />
    </div>
    {reviewing && <SubmissionAnswersModal submission={reviewing} close={() => setReviewing(null)} />}
  </section>
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-bold text-slate-700">{label}<span className="mt-2 block [&_input]:w-full [&_input]:rounded-lg [&_input]:border [&_input]:border-slate-300 [&_input]:px-3 [&_input]:py-2">{children}</span></label>
}

function ScoreDonut({ score, total }: { score: number; total: number }) {
  const percentage = total ? Math.round(score / total * 100) : 0
  const radius = 20
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.max(0, Math.min(100, percentage)) / 100)

  return <div className="grid justify-items-center gap-1" aria-label={`Score: ${score} out of ${total}, ${percentage}%`}>
    <div className="relative grid h-[4.5rem] w-[4.5rem] place-items-center">
      <svg aria-hidden="true" viewBox="0 0 52 52" className="absolute inset-0 h-full w-full -rotate-90"><circle cx="26" cy="26" r={radius} fill="none" stroke="#e0e7ff" strokeWidth="5" /><circle cx="26" cy="26" r={radius} fill="none" stroke="#4f46e5" strokeWidth="5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} /></svg>
      <span className="relative text-base font-black text-indigo-700">{percentage}%</span>
    </div>
    <span className="text-sm font-bold text-slate-800">{score}/{total}</span>
  </div>
}

function SubmissionCard({ submission, exam, openAnswers }: { submission: Submission; exam: string; openAnswers: () => void }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60 sm:p-6">
    <div className="grid gap-5 lg:grid-cols-[minmax(13rem,1.2fr)_minmax(14rem,1.15fr)_7rem_minmax(13rem,1fr)] lg:items-center lg:gap-0">
      <div className="min-w-0 lg:pr-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2"><p className="truncate text-lg font-black text-slate-900">{submission.testTitle}</p>{submission.autoSubmitted && <span className="inline-flex shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-amber-800">Auto-submitted</span>}</div>
        <p className="mt-1 truncate text-sm font-semibold text-indigo-600">{exam}</p>
        <p className="mt-1 text-sm text-slate-500">{submission.testCategory || 'Uncategorised'}</p>
        <span className="mt-3 inline-flex rounded-md bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">{submission.testCategory || 'Uncategorised'}</span>
      </div>
      <div className="flex min-w-0 items-center gap-3 border-t border-slate-100 pt-5 lg:border-l lg:border-t-0 lg:px-6 lg:py-0">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-indigo-100 bg-indigo-50 text-indigo-600"><UserIcon /></span>
        <div className="min-w-0"><p className="truncate font-bold text-slate-900">{submission.userName || submission.userEmail || submission.userId}</p><p className="mt-1 truncate text-sm text-slate-500">{submission.userEmail || submission.userId}</p></div>
      </div>
      <div className="border-t border-slate-100 pt-5 lg:border-l lg:border-t-0 lg:px-5 lg:py-0"><ScoreDonut score={submission.score} total={submission.totalMarks} /></div>
      <div className="border-t border-slate-100 pt-5 text-sm text-slate-500 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <p className="flex items-center gap-2"><CalendarIcon />{formatDate(submission)}</p>
        <p className="mt-3 flex items-center gap-2"><CheckIcon />{submission.correctAnswers}/{submission.questionCount} correct</p>
        {submission.answers?.length ? <button type="button" onClick={openAnswers} className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-indigo-600 hover:text-indigo-800">View answers <span aria-hidden="true">›</span></button> : <p className="mt-4 text-xs text-slate-400">Answer detail unavailable</p>}
      </div>
    </div>
  </article>
}

function UserIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20c.8-4 3.3-6 7.5-6s6.7 2 7.5 6" /></svg> }
function CalendarIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-indigo-500" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg> }
function CheckIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-indigo-500" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="8" /><path d="m8.5 12 2.3 2.3 4.7-4.7" /></svg> }
