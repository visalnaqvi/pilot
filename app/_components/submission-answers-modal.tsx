'use client'

import { useEffect, useState } from 'react'
import { useAuth } from './auth-context'
import type { Submission, SubmissionAnswer } from './test-types'
import { authenticatedFetch } from '@/lib/authenticated-fetch'

type GradeDraft = Record<number, { awardedMarks: number; feedback: string }>

export function SubmissionAnswersModal({ submission: initialSubmission, close }: { submission: Submission; close: () => void }) {
  const { user } = useAuth()
  const [submission, setSubmission] = useState(initialSubmission)
  const [canGrade, setCanGrade] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [grades, setGrades] = useState<GradeDraft>({})

  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await authenticatedFetch(user, `/api/test-submissions/${encodeURIComponent(initialSubmission.id)}`, {
          signal: controller.signal,
        })
        const payload = await response.json().catch(() => ({})) as { submission?: Submission; canGrade?: boolean; error?: string }
        if (!response.ok || !payload.submission) throw new Error(payload.error || 'Unable to load answer details.')
        setSubmission(payload.submission)
        setCanGrade(Boolean(payload.canGrade))
        setGrades(Object.fromEntries((payload.submission.answers || [])
          .filter(answer => answer.kind === 'short_answer')
          .map(answer => [answer.questionIndex, {
            awardedMarks: answer.awardedMarks || 0,
            feedback: answer.feedback || '',
          }])))
      } catch (reason) {
        if (!controller.signal.aborted) setMessage(reason instanceof Error ? reason.message : 'Unable to load answer details.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [initialSubmission.id, user])

  async function saveGrades() {
    if (!user) return
    setSaving(true)
    setMessage('')
    try {
      const response = await authenticatedFetch(user, `/api/test-submissions/${encodeURIComponent(submission.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          answers: (submission.answers || []).flatMap(answer => {
            const grade = grades[answer.questionIndex]
            return grade && answer.id ? [{ id: answer.id, ...grade }] : []
          }),
        }),
      })
      const payload = await response.json().catch(() => ({})) as { error?: string; score?: number }
      if (!response.ok) throw new Error(payload.error || 'Unable to save grades.')
      setSubmission(current => ({
        ...current,
        score: payload.score ?? current.score,
        gradingStatus: 'graded',
        pendingMarks: 0,
        answers: (current.answers || []).map(answer => {
          const grade = grades[answer.questionIndex]
          return grade ? { ...answer, ...grade, gradingStatus: 'graded' as const } : answer
        }),
      }))
      setCanGrade(false)
      setMessage('Short answers graded. The final score is now available to the learner.')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to save grades.')
    } finally {
      setSaving(false)
    }
  }

  const answers = submission.answers || []
  return <div role="dialog" aria-modal="true" aria-label="Submission answers" className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/50 p-4" onMouseDown={close}>
    <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-6">
        <div>
          <p className="text-xs font-bold tracking-widest text-indigo-600">ANSWER REVIEW</p>
          <h2 className="mt-1 text-2xl font-black">{submission.testTitle}</h2>
          <p className="mt-1 text-sm text-slate-500">{submission.userEmail || submission.userId} · {submission.gradingStatus === 'pending' ? `${submission.mcqScore || 0}/${submission.mcqMarks || 0} MCQ marks, ${submission.pendingMarks || 0} pending` : `${submission.score}/${submission.totalMarks} marks`}</p>
        </div>
        <button type="button" onClick={close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Close</button>
      </div>
      <div className="space-y-4 p-6">
        {loading ? <p className="text-slate-500">Loading private answer details…</p> : answers.length ? answers.map(answer => (
          <AnswerCard
            key={answer.questionIndex}
            answer={answer}
            canGrade={canGrade}
            grade={grades[answer.questionIndex]}
            setGrade={(grade) => setGrades(current => ({ ...current, [answer.questionIndex]: grade }))}
          />
        )) : !message && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No saved answers were found for this submission.</p>}
        {message && <p className={`rounded-xl p-4 text-sm ${message.startsWith('Short answers') ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{message}</p>}
        {canGrade && <button type="button" disabled={saving} onClick={() => void saveGrades()} className="w-full rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white disabled:opacity-50">{saving ? 'Saving grades…' : 'Release final grade'}</button>}
      </div>
    </div>
  </div>
}

export function SubmissionReviewButton({ submission, className, children }: { submission: Submission; className: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return <><button type="button" onClick={() => setOpen(true)} className={className}>{children}</button>{open && <SubmissionAnswersModal submission={submission} close={() => setOpen(false)} />}</>
}

function AnswerCard({ answer, canGrade, grade, setGrade }: {
  answer: SubmissionAnswer
  canGrade: boolean
  grade?: { awardedMarks: number; feedback: string }
  setGrade: (grade: { awardedMarks: number; feedback: string }) => void
}) {
  if (answer.kind === 'short_answer') {
    return <article className="rounded-xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold">Question {answer.questionIndex + 1}</p><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">{answer.awardedMarks != null ? `${answer.awardedMarks}/${answer.marks} marks` : `${answer.marks} marks · review`}</span></div>
      <p className="mt-3 font-semibold">{answer.prompt}</p>
      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm whitespace-pre-wrap">{answer.response || <span className="text-slate-500">Not answered</span>}</div>
      {answer.modelAnswer && <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm"><b>Approved answer:</b> {answer.modelAnswer}</div>}
      {answer.rubric?.length ? <ul className="mt-3 list-inside list-disc text-sm text-slate-700">{answer.rubric.map((item, index) => <li key={index}>{item.criterion} ({item.marks})</li>)}</ul> : null}
      {canGrade && grade && <div className="mt-4 grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]"><label className="text-sm font-bold">Awarded marks<input type="number" min={0} max={answer.marks} step="0.5" value={grade.awardedMarks} onChange={event => setGrade({ ...grade, awardedMarks: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal" /></label><label className="text-sm font-bold">Feedback<textarea value={grade.feedback} onChange={event => setGrade({ ...grade, feedback: event.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal" /></label></div>}
      {!canGrade && answer.feedback && <p className="mt-3 text-sm"><b>Feedback:</b> {answer.feedback}</p>}
    </article>
  }

  const resolved = answer.isCorrect != null
  return <article className={`rounded-xl border p-5 ${!resolved ? 'border-slate-200 bg-slate-50' : answer.isCorrect ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold">Question {answer.questionIndex + 1}</p>{resolved && <span className={`rounded-full px-2 py-1 text-xs font-bold ${answer.isCorrect ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>{answer.isCorrect ? `Correct · ${answer.marks} mark${answer.marks === 1 ? '' : 's'}` : 'Incorrect'}</span>}</div>
    <p className="mt-3 font-semibold">{answer.prompt}</p>
    <div className="mt-3 space-y-2">{(answer.options || []).map((option, index) => <div key={index} className={`rounded-lg border px-3 py-2 text-sm ${index === answer.correctAnswer ? 'border-emerald-300 bg-emerald-100' : index === answer.selectedAnswer ? 'border-rose-300 bg-rose-100' : 'border-slate-200 bg-white'}`}><b>{String.fromCharCode(65 + index)}.</b> {option}{index === answer.correctAnswer && <span className="ml-2 text-xs font-bold text-emerald-700">Correct answer</span>}{index === answer.selectedAnswer && index !== answer.correctAnswer && <span className="ml-2 text-xs font-bold text-rose-700">Selected</span>}</div>)}</div>
    {answer.selectedAnswer === null && <p className="mt-3 text-sm font-bold text-rose-700">Not answered</p>}
    {answer.explanation && <p className="mt-3 text-sm text-slate-700"><b>Explanation:</b> {answer.explanation}</p>}
  </article>
}
