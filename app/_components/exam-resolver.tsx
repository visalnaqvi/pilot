'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from './auth-context'
import type {
  ExamCatalogEntry,
  ExamResolution,
  ExamSelectionStatus,
} from '@/lib/exam-catalog'
import { authenticatedFetch } from '@/lib/authenticated-fetch'

export function ExamResolver({
  autoFocus = false,
  autoResolveInitialName = false,
  initialName = '',
  onResolved,
}: {
  autoFocus?: boolean
  autoResolveInitialName?: boolean
  initialName?: string
  onResolved: (exam: ExamCatalogEntry, status: ExamSelectionStatus) => void
}) {
  const { user } = useAuth()
  const [name, setName] = useState(initialName)
  const [suggestions, setSuggestions] = useState<ExamCatalogEntry[]>([])
  const [proposal, setProposal] = useState<ExamCatalogEntry | null>(null)
  const [proposalSource, setProposalSource] = useState<'ai' | 'input'>('input')
  const [resolving, setResolving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const initialResolutionStarted = useRef(false)

  const requestResolution = useCallback(async (body: Record<string, unknown>) => {
    if (!user) throw new Error('Sign in before adding an exam.')
    const response = await authenticatedFetch(user, '/api/exams/resolve', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const result = await response.json() as ExamResolution | { error?: string }
    if (!response.ok || !('status' in result)) {
      throw new Error('error' in result && result.error ? result.error : 'Unable to resolve this exam.')
    }
    return result
  }, [user])

  const showResolution = useCallback((result: ExamResolution) => {
    if (result.status === 'matches') {
      setProposal(null)
      setSuggestions(result.exams)
      return
    }
    if (result.status === 'proposed') {
      setSuggestions([])
      setProposal(result.exam)
      setProposalSource(result.source || 'input')
      return
    }
    onResolved(result.exam, result.status)
  }, [onResolved])

  const resolveExam = useCallback(async () => {
    const examName = name.trim()
    if (!examName) {
      setError('Enter a valid exam name.')
      return
    }

    setResolving(true)
    setError('')
    setSuggestions([])
    setProposal(null)
    try {
      showResolution(await requestResolution({ name: examName }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to find this exam.')
    } finally {
      setResolving(false)
    }
  }, [name, requestResolution, showResolution])

  useEffect(() => {
    if (!autoResolveInitialName || !user || !initialName.trim() || initialResolutionStarted.current) return
    initialResolutionStarted.current = true
    const timer = window.setTimeout(() => void resolveExam(), 0)
    return () => window.clearTimeout(timer)
  }, [autoResolveInitialName, initialName, resolveExam, user])

  async function createExam() {
    if (!proposal) return
    setCreating(true)
    setError('')
    try {
      showResolution(await requestResolution({ proposal }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create this exam.')
    } finally {
      setCreating(false)
    }
  }

  async function selectSuggestion(exam: ExamCatalogEntry) {
    setResolving(true)
    setError('')
    try {
      showResolution(await requestResolution({ selectionId: exam.id }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to select this exam.')
    } finally {
      setResolving(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={event => {
            setName(event.target.value)
            setSuggestions([])
            setProposal(null)
            setError('')
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void resolveExam()
            }
          }}
          placeholder="Exam name, abbreviation, or alias"
          autoFocus={autoFocus}
          className="min-w-52 flex-1 rounded-lg border border-slate-200 px-3 py-2"
        />
        <button
          type="button"
          disabled={resolving || creating}
          onClick={() => void resolveExam()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {resolving ? 'Finding…' : 'Find exam'}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
      {suggestions.length > 0 && (
        <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50 p-3">
          <p className="text-sm font-bold text-indigo-950">Existing exams found</p>
          <p className="mt-1 text-sm text-indigo-800">Select the exam you meant instead of creating a duplicate.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map(exam => (
              <button
                key={exam.id}
                type="button"
                disabled={resolving || creating}
                onClick={() => void selectSuggestion(exam)}
                className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-left text-sm text-indigo-800 hover:bg-indigo-100"
              >
                <span className="block font-bold">{exam.name}</span>
                {exam.primaryAlias && exam.primaryAlias !== exam.name && <span className="mt-0.5 block text-xs text-indigo-600">{exam.primaryAlias}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {proposal && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-emerald-700">{proposalSource === 'ai' ? 'Suggested catalog exam' : 'New exam proposal'}</p>
          <p className="mt-2 text-lg font-black text-slate-950">{proposal.name}</p>
          {proposal.primaryAlias && proposal.primaryAlias !== proposal.name && <p className="mt-1 text-sm text-slate-600">Display alias: {proposal.primaryAlias}</p>}
          <p className="mt-3 text-sm leading-6 text-emerald-900">{proposalSource === 'ai' ? 'This canonical name was suggested from your search. Review it, then confirm before adding it to the catalog.' : 'No existing exam was selected. Review this name, then confirm before adding it to the catalog.'}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={creating} onClick={() => void createExam()} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50">{creating ? 'Creating…' : 'Create exam'}</button>
            <button type="button" disabled={creating} onClick={() => setProposal(null)} className="rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">Change search</button>
          </div>
        </div>
      )}
    </div>
  )
}
