'use client'

import { useState } from 'react'
import type { Submission, SubmissionAnswer } from './test-types'

export function SubmissionAnswersModal({ submission, close }: { submission: Submission; close: () => void }) {
  const answers = submission.answers || []
  return <div role="dialog" aria-modal="true" aria-label="Submission answers" className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/50 p-4" onMouseDown={close}><div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-4 border-b border-slate-200 p-6"><div><p className="text-xs font-bold tracking-widest text-indigo-600">ANSWER REVIEW</p><h2 className="mt-1 text-2xl font-black">{submission.testTitle}</h2><p className="mt-1 text-sm text-slate-500">{submission.userEmail || submission.userId} · {submission.correctAnswers}/{submission.questionCount} correct</p></div><button type="button" onClick={close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Close</button></div><div className="space-y-4 p-6">{answers.map((answer) => <AnswerCard key={answer.questionIndex} answer={answer} />)}</div></div></div>
}

export function SubmissionReviewButton({ submission, className, children }: { submission: Submission; className: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return <><button type="button" onClick={() => setOpen(true)} className={className}>{children}</button>{open && <SubmissionAnswersModal submission={submission} close={() => setOpen(false)} />}</>
}

function AnswerCard({ answer }: { answer: SubmissionAnswer }) { return <article className={`rounded-xl border p-5 ${answer.isCorrect ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}><div className="flex items-center justify-between gap-4"><p className="text-sm font-bold">Question {answer.questionIndex + 1}</p><span className={`rounded-full px-2 py-1 text-xs font-bold ${answer.isCorrect ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>{answer.isCorrect ? `Correct · ${answer.marks} mark${answer.marks === 1 ? '' : 's'}` : 'Incorrect'}</span></div><p className="mt-3 font-semibold">{answer.prompt}</p><div className="mt-3 space-y-2">{answer.options.map((option, index) => <div key={index} className={`rounded-lg border px-3 py-2 text-sm ${index === answer.correctAnswer ? 'border-emerald-300 bg-emerald-100' : index === answer.selectedAnswer ? 'border-rose-300 bg-rose-100' : 'border-slate-200 bg-white'}`}><b>{String.fromCharCode(65 + index)}.</b> {option}{index === answer.correctAnswer && <span className="ml-2 text-xs font-bold text-emerald-700">Correct answer</span>}{index === answer.selectedAnswer && index !== answer.correctAnswer && <span className="ml-2 text-xs font-bold text-rose-700">Selected</span>}</div>)}</div>{answer.selectedAnswer === null && <p className="mt-3 text-sm font-bold text-rose-700">Not answered</p>}</article> }
