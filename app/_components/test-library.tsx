'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { authenticatedFetch } from '@/lib/authenticated-fetch'
import { useAuth } from './auth-context'
import { SearchPicker } from './search-picker'
import { TestDashboardModal } from './exam-dashboard'
import { paginate, Pagination } from './pagination'
import type { MockTest } from './test-types'

type LibraryTest = MockTest & { assignmentBatchId?: string; assignmentName?: string; assignmentAttemptsUsed?: number; assignmentMaxAttempts?: number; assignmentStartAt?: { toDate: () => Date }; assignmentDeadline?: { toDate: () => Date } }

const categoryName = (test: MockTest) => test.category?.trim() || 'Uncategorized'
const createdAt = (test: MockTest) => !test.createdAt ? 0 : typeof test.createdAt === 'string' ? new Date(test.createdAt).getTime() : test.createdAt.toDate().getTime()
const byNewest = <T extends MockTest,>(tests: T[]) => [...tests].sort((a, b) => createdAt(b) - createdAt(a) || b.id.localeCompare(a.id))
const pageSize = 8
const count = (test: MockTest) => ({
  questions: test.questionCount ?? test.questions?.length ?? 0,
  marks: test.totalMarks ?? test.questions?.reduce((sum, item) => sum + item.marks, 0) ?? 0,
})

export function TestLibrary() {
  const { user, profile } = useAuth()
  const role = profile?.role
  const [teacherMember, setTeacherMember] = useState(false)
  const canManage = role === 'admin' || role === 'organisation' || profile?.membershipRole === 'teacher' || teacherMember
  const [publicTests, setPublicTests] = useState<MockTest[]>([])
  const [privateTests, setPrivateTests] = useState<MockTest[]>([])
  const [assignedTests, setAssignedTests] = useState<LibraryTest[]>([])
  const [memberOrganisationIds, setMemberOrganisationIds] = useState<string[]>([])
  const [organisationNames, setOrganisationNames] = useState<Record<string, string>>({})
  const [exam, setExam] = useState('')
  const [category, setCategory] = useState('')
  const [testId, setTestId] = useState('')
  const [access, setAccess] = useState('')
  const [organisationId, setOrganisationId] = useState('')
  const [page, setPage] = useState(1)
  const [openedTest, setOpenedTest] = useState<MockTest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const allTests = useMemo(() => [...publicTests, ...privateTests, ...assignedTests], [assignedTests, privateTests, publicTests])
  const organisationOptions = useMemo(() => {
    const ids = role === 'user'
      ? memberOrganisationIds
      : role === 'admin' ? Object.keys(organisationNames) : profile?.organizationId ? [profile.organizationId] : []
    return ids.map(id => ({ id, label: organisationNames[id] || id })).sort((a, b) => a.label.localeCompare(b.label))
  }, [memberOrganisationIds, organisationNames, profile, role])
  const exams = useMemo(
    () => [...new Map(allTests.filter(test => test.exam).map(test => [
      test.examId || `legacy:${test.exam}`,
      { id: test.examId || `legacy:${test.exam}`, label: test.exam || '' },
    ])).values()].sort((a, b) => a.label.localeCompare(b.label)),
    [allTests],
  )
  const categories = useMemo(
    () => [...new Set(allTests
      .filter(test => !exam || test.examId === exam || (!test.examId && `legacy:${test.exam}` === exam))
      .map(categoryName))]
      .sort((a, b) => a.localeCompare(b)),
    [allTests, exam],
  )
  const tests = useMemo(
    () => allTests
      .filter(test => test.published !== false)
      .filter(test => !exam || test.examId === exam || (!test.examId && `legacy:${test.exam}` === exam))
      .filter(test => !category || categoryName(test) === category)
      .map(test => ({ id: test.id, label: test.title, detail: `${test.examAlias || test.exam || 'Unassigned exam'} · ${categoryName(test)}` })),
    [allTests, category, exam],
  )
  const visibleTests = byNewest<LibraryTest>(([...publicTests, ...privateTests, ...assignedTests] as LibraryTest[]).filter(test =>
    test.published !== false
    && (!exam || test.examId === exam || (!test.examId && `legacy:${test.exam}` === exam))
    && (!category || categoryName(test) === category)
    && (!testId || test.id === testId)
    && (!organisationId || (test.organisationId || test.createdBy) === organisationId)
    && (!access || (role === 'user'
      ? access === 'assignments' ? test.visibility === 'assigned' : test.visibility !== 'assigned'
      : test.visibility === access)),
  ))
  const pagedTests = paginate(visibleTests, page, pageSize)

  useEffect(() => {
    if (!user || !role) return
    let active = true
    const testsUrl = canManage ? '/api/tests?owned=1' : '/api/tests'
    void Promise.all([
      authenticatedFetch(user, testsUrl, { cache: 'no-store' }),
      authenticatedFetch(user, '/api/assignments', { cache: 'no-store' }),
      authenticatedFetch(user, '/api/organizations', { cache: 'no-store' }),
    ]).then(async ([testResponse, assignmentResponse, organizationResponse]) => {
      const [testData, assignmentData, organizationData] = await Promise.all([
        testResponse.json(),
        assignmentResponse.json(),
        organizationResponse.json(),
      ])
      if (!testResponse.ok) throw new Error(testData.error || 'Unable to load tests.')
      if (!assignmentResponse.ok) throw new Error(assignmentData.error || 'Unable to load assignments.')
      if (!organizationResponse.ok) throw new Error(organizationData.error || 'Unable to load institutes.')
      if (!active) return

      const available = ((testData.items || []) as MockTest[]).map(test => ({
        ...test,
        createdAt: typeof test.createdAt === 'string' ? { toDate: () => new Date(test.createdAt as string) } : test.createdAt,
      }))
      const memberships = (organizationData.memberships || []) as Array<{ organizationId: string; role: string }>
      const organizationItems = (organizationData.items || []) as Array<{ id: string; name: string }>
      const joinedIds = memberships.map(item => item.organizationId)
      const teacherIds = memberships.filter(item => item.role === 'teacher' || item.role === 'owner').map(item => item.organizationId)
      setMemberOrganisationIds(joinedIds)
      setTeacherMember(teacherIds.length > 0 || profile?.membershipRole === 'teacher')
      setOrganisationNames(Object.fromEntries(organizationItems.map(item => [item.id, item.name])))

      setPublicTests(byNewest(available.filter(test => test.visibility === 'public')))
      setPrivateTests(byNewest(available.filter(test => test.visibility === 'private')))

      if (canManage) {
        setAssignedTests(byNewest(available.filter(test => test.visibility === 'assigned') as LibraryTest[]))
      } else {
        const assignments = (assignmentData.assignments || []) as Array<{
          id: string
          name: string
          testId: string
          maxAttempts?: number
          startAt?: string
          deadline: string
          recipients?: Array<{ userId: string; attemptsUsed?: number }>
        }>
        setAssignedTests(byNewest(assignments.flatMap(assignment => {
          const recipient = assignment.recipients?.find(item => item.userId === user.uid)
          const test = available.find(item => item.id === assignment.testId)
          if (!recipient || !test) return []
          return [{
            ...test,
            assignmentBatchId: assignment.id,
            assignmentName: assignment.name,
            assignmentAttemptsUsed: recipient.attemptsUsed || 0,
            assignmentMaxAttempts: assignment.maxAttempts || 1,
            assignmentStartAt: assignment.startAt ? { toDate: () => new Date(assignment.startAt!) } : undefined,
            assignmentDeadline: { toDate: () => new Date(assignment.deadline) },
          } satisfies LibraryTest]
        })))
      }
      setLoading(false)
      setError('')
    }).catch(reason => {
      if (active) {
        setError(reason instanceof Error ? reason.message : 'Unable to load tests.')
        setLoading(false)
      }
    })
    return () => { active = false }
  }, [canManage, profile?.membershipRole, role, user])

  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
    <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-50/80 via-white to-white p-1">
      <div className="relative z-10 max-w-2xl">
        <p className="text-xs font-black tracking-widest text-indigo-600">TEST LIBRARY</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Ready to sharpen up?</h1>
        <p className="mt-2 text-slate-600">{canManage ? 'Choose a mock test or manage your test library.' : 'Choose a mock test from the public library or your institutes.'}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          {canManage && <ActionLink href="/tests/create" primary icon="plus">Create test</ActionLink>}
        </div>
      </div>
    </header>

    <div className="mt-6 grid gap-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-2 lg:grid-cols-3">
      <PickerField label={role === 'user' ? 'Filter by library' : 'Filter by access'} icon="access">
        <SearchPicker
          value={access}
          options={role === 'user'
            ? [{ id: '', label: 'All tests' }, { id: 'tests', label: 'My tests' }, { id: 'assignments', label: 'My assignments' }]
            : [{ id: '', label: 'All access types' }, { id: 'public', label: 'Public' }, { id: 'private', label: 'Private' }, { id: 'assigned', label: 'Assignment' }]}
          onChange={option => { setAccess(option.id); setPage(1) }}
          placeholder={role === 'user' ? 'Choose test library' : 'Choose access type'}
        />
      </PickerField>
      {(role === 'user' || role === 'admin') && <PickerField label="Filter by institute" icon="organisation">
        <SearchPicker
          value={organisationId}
          options={[{ id: '', label: 'All institutes' }, ...organisationOptions]}
          onChange={option => { setOrganisationId(option.id); setPage(1) }}
          placeholder="Search institutes"
        />
      </PickerField>}
      <PickerField label="Filter by exam" icon="exam">
        <SearchPicker
          value={exam}
          options={[{ id: '', label: 'All exams' }, ...exams]}
          onChange={option => {
            setExam(option.id)
            setCategory('')
            setTestId('')
            setPage(1)
          }}
          placeholder="Search exams"
        />
      </PickerField>
      <PickerField label="Filter by category" icon="folder">
        <SearchPicker
          value={category}
          options={[{ id: '', label: 'All categories' }, ...categories.map(item => ({ id: item, label: item }))]}
          onChange={option => {
            setCategory(option.id)
            setTestId('')
            setPage(1)
          }}
          placeholder="Search categories"
        />
      </PickerField>
      <PickerField label="Filter by test" icon="document">
        <SearchPicker
          value={testId}
          options={[{ id: '', label: 'All tests' }, ...tests]}
          onChange={option => { setTestId(option.id); setPage(1) }}
          placeholder="Search tests"
        />
      </PickerField>
    </div>

    {error && <p className="mt-6 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">Could not load tests: {error}</p>}

    <div className="mt-8 flex items-center justify-between gap-3">
      <p className="text-sm font-semibold text-slate-600">{visibleTests.length} test{visibleTests.length === 1 ? '' : 's'} · newest first</p>
      {visibleTests.length > pageSize && <p className="text-sm text-slate-500">Page {pagedTests.page} of {pagedTests.totalPages}</p>}
    </div>
    <div className="mt-5 grid gap-5 md:grid-cols-2">
      {loading ? <p className="text-slate-500">Loading tests…</p> : pagedTests.items.length ? pagedTests.items.map(test => <TestCard key={`${test.visibility}-${test.id}-${test.assignmentBatchId || ''}`} test={test} openTestDashboard={setOpenedTest} />) : <div className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-500 md:col-span-2">No tests match these filters.</div>}
    </div>
    <Pagination page={pagedTests.page} pageSize={pageSize} totalItems={visibleTests.length} onPageChange={setPage} itemLabel="tests" className="mt-7 rounded-xl border border-slate-200 bg-white" />
    {openedTest && <TestDashboardModal test={openedTest} close={() => setOpenedTest(null)} />}
  </section>
}

function ActionLink({ href, primary = false, icon, children }: { href: string; primary?: boolean; icon: 'plus' | 'document' | 'chart'; children: React.ReactNode }) {
  return <Link href={href} className={`inline-flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-bold transition-colors ${primary ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700' : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'}`}>
    <UiIcon name={icon} className="h-4 w-4" />
    {children}
  </Link>
}

function PickerField({ label, icon, children }: { label: string; icon: 'exam' | 'folder' | 'document' | 'access' | 'organisation'; children: React.ReactNode }) {
  return <div>
    <p className="mb-2 text-xs font-bold text-slate-800">{label}</p>
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-indigo-600"><UiIcon name={icon} className="h-4 w-4" /></span>
      <div className="[&_input]:pl-10">{children}</div>
    </div>
  </div>
}

function TestCard({ test, openTestDashboard }: { test: LibraryTest; openTestDashboard: (test: MockTest) => void }) {
  const stats = count(test)
  const isUserAssignment = test.visibility === 'assigned' && typeof test.assignmentMaxAttempts === 'number'
  const attemptsExhausted = isUserAssignment && (test.assignmentAttemptsUsed || 0) >= (test.assignmentMaxAttempts || 1)
  const visibilityLabel = test.visibility === 'assigned' ? 'Assignment' : test.visibility === 'private' ? 'Private' : 'Public'
  return <article className="relative rounded-xl border border-slate-200 bg-white p-5 shadow-md shadow-slate-200/50 transition-transform hover:-translate-y-0.5">
    <span className={`absolute right-4 top-4 rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${test.visibility === 'public' ? 'bg-emerald-50 text-emerald-700' : test.visibility === 'private' ? 'bg-amber-50 text-amber-700' : 'bg-violet-50 text-violet-700'}`}>{visibilityLabel}</span>
    <h3 className="truncate pr-28 text-lg font-bold text-slate-950">{test.assignmentName || test.title}</h3>
    {test.assignmentName && <p className="mt-1 truncate pr-28 text-xs font-semibold text-slate-500">{test.title}</p>}
    <p className="mt-2 text-sm font-semibold text-indigo-600">{test.examAlias || test.exam || 'Unassigned exam'}</p>
    <p className="mt-1 text-sm text-slate-500">{categoryName(test)}</p>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1.5 text-xs font-bold text-indigo-700"><UiIcon name="document" className="h-3.5 w-3.5" />{stats.questions} questions</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1.5 text-xs font-bold text-violet-700"><UiIcon name="star" className="h-3.5 w-3.5" />{stats.marks} marks</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1.5 text-xs font-bold text-sky-700"><UiIcon name="clock" className="h-3.5 w-3.5" />{test.durationMinutes || '—'} min</span>
        {isUserAssignment && <span className="inline-flex rounded-full bg-violet-50 px-2.5 py-1.5 text-xs font-bold text-violet-700">{Math.max(0, (test.assignmentMaxAttempts || 1) - (test.assignmentAttemptsUsed || 0))} attempts left</span>}
      </div>
      <div className="flex items-center gap-2">{!isUserAssignment && <button type="button" onClick={() => openTestDashboard(test)} aria-label={`Open dashboard for ${test.title}`} title="Test dashboard" className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"><UiIcon name="info" className="h-4 w-4" /></button>}{test.visibility === 'assigned' && !isUserAssignment ? <Link href="/assignments" className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-700">Create assignment</Link> : attemptsExhausted ? <span className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold text-slate-500">Attempt limit reached</span> : <Link href={`/tests/${test.id}${test.assignmentBatchId ? `?assignment=${encodeURIComponent(test.assignmentBatchId)}` : ''}`} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">Start test <span aria-hidden="true">→</span></Link>}</div>
    </div>
  </article>
}

function UiIcon({ name, className }: { name: 'plus' | 'document' | 'chart' | 'exam' | 'folder' | 'access' | 'organisation' | 'public' | 'private' | 'assigned' | 'clock' | 'star' | 'info'; className: string }) {
  if (name === 'plus') return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
  if (name === 'document') return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>
  if (name === 'chart') return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 20V10M12 20V4M19 20v-7" /></svg>
  if (name === 'exam') return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-5 9 5-9 5-9-5Z" /><path d="M7 12v5c3 2 7 2 10 0v-5M21 9v6" /></svg>
  if (name === 'folder') return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" /></svg>
  if (name === 'access') return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
  if (name === 'organisation') return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V8l8-4 8 4v13M9 21v-4h6v4M8 10h.01M12 10h.01M16 10h.01M8 13h.01M12 13h.01M16 13h.01" /></svg>
  if (name === 'public') return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>
  if (name === 'private') return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
  if (name === 'assigned') return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4a3 3 0 0 1 6 0M9 12h6M9 16h4" /><path d="m15 8 1.5 1.5L20 6" /></svg>
  if (name === 'clock') return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  if (name === 'info') return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2l-5-4.9 6.9-1Z" /></svg>
}
