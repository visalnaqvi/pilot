'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from './auth-context'
import { paginate, Pagination } from './pagination'
import type { MockTest } from './test-types'
import { useTeacherOrganisations } from './use-teacher-organisations'

const sort = (tests: MockTest[]) => [...tests].sort((a, b) => a.title.localeCompare(b.title))
export function ManageTests() {
  const { user, profile } = useAuth(); const [tests, setTests] = useState<MockTest[]>([]); const [showDeleted, setShowDeleted] = useState(false); const [loading, setLoading] = useState(true); const [message, setMessage] = useState(''); const [processing, setProcessing] = useState(''); const [page, setPage] = useState(1)
  const { organisations: teacherOrganisations, loading: teacherOrganisationsLoading } = useTeacherOrganisations(profile?.role === 'user' ? user : null)
  const isAdmin = profile?.role === 'admin'; const isTeacher = profile?.role === 'user' && teacherOrganisations.length > 0; const allowed = isAdmin || profile?.role === 'organisation' || isTeacher
  useEffect(() => {
    if (!user || !allowed) return
    let active = true
    void user.getIdToken()
      .then(token => fetch('/api/owned-tests', {
        headers: { authorization: `Bearer ${token}` },
      }))
      .then(async response => {
        const payload = await response.json().catch(() => ({})) as { tests?: MockTest[]; error?: string }
        if (!response.ok) throw new Error(payload.error || 'Unable to load tests.')
        if (active) {
          setTests(sort((payload.tests || []).filter(test => showDeleted ? test.deletedAt != null : test.deletedAt == null)))
          setLoading(false)
        }
      })
      .catch(reason => {
        if (active) {
          setMessage(`Could not load tests: ${reason instanceof Error ? reason.message : 'Unknown error'}`)
          setLoading(false)
        }
      })
    return () => { active = false }
  }, [allowed, showDeleted, user])
  async function remove(test: MockTest) { if (!user || !confirm(`Soft-delete “${test.title}”?`)) return; setProcessing(test.id); try { await updateDoc(doc(db, 'tests', test.id), { deletedAt: serverTimestamp(), deletedBy: user.uid }); setTests(items => items.filter(item => item.id !== test.id)) } catch { setMessage('Unable to delete this test.') } finally { setProcessing('') } }
  async function restore(test: MockTest) { setProcessing(test.id); try { await updateDoc(doc(db, 'tests', test.id), { deletedAt: null, deletedBy: null }); setTests(items => items.filter(item => item.id !== test.id)) } catch { setMessage('Unable to restore this test.') } finally { setProcessing('') } }
  const visibleTests = paginate(tests, page)
  if (teacherOrganisationsLoading) return <p className="text-slate-500">Checking teaching permissions…</p>
  if (!allowed) return <section><h1 className="text-3xl font-black">Access denied</h1></section>
  return <section><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="text-4xl font-black">Manage tests</h1><p className="mt-2 text-slate-600">{showDeleted ? 'Restore soft-deleted tests.' : isAdmin ? 'Edit or soft-delete any active test on the platform.' : 'Edit or soft-delete tests you created.'}</p></div><div className="flex flex-wrap gap-2">{!isTeacher && <Link href="/manage/tests/generate" className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 font-bold text-violet-700">Generate with AI</Link>}{!isTeacher && <Link href="/manage/questions" className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 font-bold text-indigo-700">Question bank</Link>}<Link href="/tests/create" className="rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white">+ Create mock test</Link></div></div><div className="mt-7 flex gap-2"><button onClick={() => { setLoading(true); setShowDeleted(false); setPage(1) }} className={`rounded-lg px-4 py-2 text-sm font-bold ${!showDeleted ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white'}`}>Active tests</button><button onClick={() => { setLoading(true); setShowDeleted(true); setPage(1) }} className={`rounded-lg px-4 py-2 text-sm font-bold ${showDeleted ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white'}`}>Deleted tests</button></div>{message && <p className="mt-6 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{message}</p>}<div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-bold tracking-wide text-slate-500"><span>TEST</span><span>ACTIONS</span></div>{loading ? <p className="p-6 text-slate-500">Loading tests…</p> : tests.length ? visibleTests.items.map(test => <div key={test.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-slate-100 px-5 py-4 last:border-0"><div><p className="truncate font-semibold">{test.title}</p><p className="mt-1 text-xs text-slate-500">{test.visibility} · {test.questionCount ?? test.questions?.length ?? 0} questions</p></div>{showDeleted ? <button disabled={processing === test.id} onClick={() => restore(test)} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">Restore</button> : <div className="flex gap-2"><Link href={`/tests/${test.id}/edit`} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-700">Edit</Link><button disabled={processing === test.id} onClick={() => remove(test)} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-bold text-rose-700">Delete</button></div>}</div>) : <p className="p-6 text-slate-500">No {showDeleted ? 'deleted' : 'active'} tests to manage.</p>}<Pagination page={visibleTests.page} totalItems={tests.length} onPageChange={setPage} itemLabel="tests" /></div></section>
}
