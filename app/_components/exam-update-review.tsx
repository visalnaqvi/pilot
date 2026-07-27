'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth-context'
import { paginate, Pagination } from './pagination'
import { SearchPicker } from './search-picker'

type ReviewEvidence = {
  excerpt: string
  sourceTitle: string
  url: string
  sourceKind?: 'official' | 'secondary'
}

type ReviewRevision = {
  id: string
  cycleId: string
  cycleLabel: string
  section: string
  before: unknown
  after: unknown
  evidence: Record<string, ReviewEvidence[]>
  summary: string
  confidence: number
  sourceTitle: string
  sourceUrl: string
  runId: string
  flowVersion?: string
  provisionallyPublishedAt?: string
  createdAt?: string
}

type ReviewExam = {
  id: string
  name: string
  revisions: ReviewRevision[]
}

type CatalogExam = { id: string; name: string }

export function ExamUpdateReview() {
  const { user, profile } = useAuth()
  const [exams, setExams] = useState<ReviewExam[]>([])
  const [catalog, setCatalog] = useState<CatalogExam[]>([])
  const [selectedExamId, setSelectedExamId] = useState('')
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState('')
  const [message, setMessage] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    if (!user || profile?.role !== 'admin') return
    try {
      const response = await fetch('/api/admin/exam-updates', {
        headers: { authorization: `Bearer ${await user.getIdToken()}` },
        cache: 'no-store',
      })
      const payload = await response.json() as {
        exams?: ReviewExam[]
        catalog?: CatalogExam[]
        error?: string
      }
      if (!response.ok) throw new Error(payload.error || 'Unable to load review queue.')
      setExams(payload.exams || [])
      setCatalog(payload.catalog || [])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load review queue.')
    } finally {
      setLoading(false)
    }
  }, [profile?.role, user])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function decide(body: Record<string, string>) {
    if (!user) return
    const key = `revision:${body.revisionId || body.runId}`
    setWorking(key)
    setMessage('')
    try {
      const response = await fetch('/api/admin/exam-updates/revisions/decision', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await user.getIdToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const payload = await response.json() as { error?: string; reviewed?: number }
      if (!response.ok) throw new Error(payload.error || 'Unable to save review decision.')
      setMessage(`${payload.reviewed || 1} revision${payload.reviewed === 1 ? '' : 's'} reviewed.`)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save review decision.')
    } finally {
      setWorking('')
    }
  }

  async function refreshExam() {
    if (!user || !selectedExamId) return
    setWorking('refresh')
    setMessage('')
    try {
      const response = await fetch('/api/admin/exam-updates/refresh', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await user.getIdToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ examId: selectedExamId }),
      })
      const payload = await response.json() as {
        error?: string
        result?: { changed?: number; unchanged?: number; skipped?: number; proposedRevisions?: number }
      }
      if (!response.ok) throw new Error(payload.error || 'Unable to refresh exam.')
      const result = payload.result
      setMessage(result?.changed
        ? `${result.proposedRevisions || 0} provisional update${result.proposedRevisions === 1 ? '' : 's'} published for review.`
        : result?.skipped
          ? 'Refresh skipped because an earlier provisional update is still awaiting review.'
          : 'Refresh completed; no supported changes were found.')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to refresh exam.')
    } finally {
      setWorking('')
    }
  }

  const visibleExams = paginate(exams, page, 5)

  if (profile?.role !== 'admin') {
    return <section><h1 className="text-3xl font-black">Access denied</h1><p className="mt-3 text-slate-600">Only admins can review exam information.</p></section>
  }

  return <section>
    <p className="text-sm font-bold tracking-widest text-indigo-600">ADMINISTRATION</p>
    <div className="mt-1 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <h1 className="text-4xl font-black">Exam update review</h1>
        <p className="mt-3 max-w-3xl text-slate-600">GPT checks the live web, publishes cited changes provisionally, and keeps them here for verification or rollback.</p>
      </div>
      <button type="button" onClick={() => { setLoading(true); void load() }} disabled={loading || Boolean(working)} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold hover:bg-slate-50 disabled:opacity-50">Refresh queue</button>
    </div>

    <section className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
      <h2 className="font-black text-indigo-950">Run an exam refresh</h2>
      <p className="mt-1 text-sm text-indigo-800">This searches the live web and immediately publishes supported changes as pending verification.</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="min-w-0 flex-1">
          <SearchPicker
            value={selectedExamId}
            options={catalog.map((exam) => ({ id: exam.id, label: exam.name }))}
            onChange={(option) => setSelectedExamId(option.id)}
            placeholder="Search exams"
            disabled={Boolean(working)}
          />
        </div>
        <button type="button" onClick={() => void refreshExam()} disabled={!selectedExamId || Boolean(working)} className="rounded-lg bg-indigo-600 px-5 py-2 font-bold text-white disabled:opacity-50">{working === 'refresh' ? 'Searching…' : 'Run now'}</button>
      </div>
    </section>

    {message && <p className="mt-5 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-800">{message}</p>}
    {loading ? <p className="mt-8 text-slate-500">Loading review queue…</p> : exams.length ? <div className="mt-8 space-y-8">{visibleExams.items.map((exam) => <section key={exam.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-200 bg-slate-50 px-5 py-4"><h2 className="text-xl font-black">{exam.name}</h2><p className="mt-1 text-xs text-slate-500">{exam.id} · {exam.revisions.length} live revision{exam.revisions.length === 1 ? '' : 's'} awaiting verification</p></header>
      <div className="p-5"><div className="flex items-center justify-between gap-3"><h3 className="font-black">Provisional content</h3><p className="text-xs text-slate-500">Rejecting restores the previous value and withdraws its notification.</p></div><div className="mt-3 space-y-4">{exam.revisions.map((revision) => <RevisionCard key={revision.id} examId={exam.id} revision={revision} working={working} decide={decide} />)}</div></div>
    </section>)}<Pagination page={visibleExams.page} pageSize={5} totalItems={exams.length} onPageChange={setPage} itemLabel="exams" className="rounded-xl border border-slate-200 bg-white" /></div> : <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><p className="font-bold">Review queue is clear</p><p className="mt-2 text-sm text-slate-500">Use Run now or the daily refresh command to check for new exam information.</p></div>}
  </section>
}

function RevisionCard({ examId, revision, working, decide }: {
  examId: string
  revision: ReviewRevision
  working: string
  decide: (body: Record<string, string>) => Promise<void>
}) {
  const evidence = Object.entries(revision.evidence)
  return <article className="rounded-xl border border-violet-200 p-4">
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-bold uppercase text-indigo-700">{revision.section}</span><span className="text-sm font-bold">{revision.cycleLabel}</span><span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-700">Live · pending verification</span><span className="text-xs text-slate-500">{Math.round(revision.confidence * 100)}% confidence</span></div><p className="mt-2 text-sm text-slate-700">{revision.summary}</p></div><div className="flex shrink-0 flex-wrap gap-2"><button type="button" disabled={Boolean(working)} onClick={() => void decide({ examId, runId: revision.runId, decision: 'approved' })} className="rounded-lg border border-indigo-300 px-3 py-2 text-sm font-bold text-indigo-700 disabled:opacity-50">Approve run</button><button type="button" disabled={Boolean(working)} onClick={() => void decide({ examId, revisionId: revision.id, decision: 'rejected' })} className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-bold text-rose-700 disabled:opacity-50">Reject &amp; revert</button><button type="button" disabled={Boolean(working)} onClick={() => void decide({ examId, revisionId: revision.id, decision: 'approved' })} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Verify</button></div></div>
    <div className="mt-4 grid gap-3 lg:grid-cols-2"><DiffBlock label="Previous" value={revision.before} /><DiffBlock label="Provisionally live" value={revision.after} accent /></div>
    <details className="mt-4 rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-bold">Cited evidence ({evidence.length} fields)</summary><div className="mt-3 space-y-3">{evidence.map(([path, references]) => <div key={path}><p className="font-mono text-xs font-bold text-slate-500">{path}</p>{references.map((reference, index) => <div key={`${path}-${index}`} className="mt-2 border-l-2 border-indigo-300 pl-3 text-sm text-slate-700"><p>{reference.excerpt}</p><a href={reference.url} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all text-xs font-bold text-indigo-600 hover:underline">{reference.sourceTitle} · {reference.sourceKind || 'source'} ↗</a></div>)}</div>)}</div></details>
  </article>
}

function DiffBlock({ label, value, accent = false }: { label: string; value: unknown; accent?: boolean }) {
  return <div className={`min-w-0 overflow-hidden rounded-lg border p-3 ${accent ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700">{JSON.stringify(value, null, 2)}</pre></div>
}
