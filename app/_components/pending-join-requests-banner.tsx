'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from './auth-context'

type DateValue = { toDate: () => Date }
type JoinRequest = {
  id: string
  initiatedBy?: 'organisation' | 'user'
  status: 'pending' | 'accepted' | 'declined'
  createdAt?: DateValue
}

const requestToken = (request: JoinRequest) => `${request.id}:${request.createdAt?.toDate().getTime() || 0}`

export function PendingJoinRequestsBanner() {
  const { user, profile } = useAuth()
  const organisationId = profile?.role === 'organisation' ? profile.uid : ''
  const storageKey = `mockpilot-dismissed-join-requests:${organisationId}`
  const [requests, setRequests] = useState<JoinRequest[]>([])
  const [dismissedTokens, setDismissedTokens] = useState<string[]>(() => {
    if (typeof window === 'undefined' || !organisationId) return []
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) || '[]')
      return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    if (!user || !organisationId) return
    return onSnapshot(
      query(collection(db, 'organisationInvites'), where('organisationId', '==', organisationId)),
      snapshot => setRequests(snapshot.docs
        .map(item => ({ id: item.id, ...item.data() }) as JoinRequest)
        .filter(request => request.status === 'pending' && request.initiatedBy === 'user')),
    )
  }, [organisationId, user])

  const currentTokens = useMemo(() => requests.map(requestToken), [requests])
  const hasUndismissedRequest = currentTokens.some(token => !dismissedTokens.includes(token))

  function dismiss() {
    const next = [...new Set([...dismissedTokens, ...currentTokens])].slice(-100)
    setDismissedTokens(next)
    window.localStorage.setItem(storageKey, JSON.stringify(next))
  }

  if (!requests.length || !hasUndismissedRequest) return null

  return <aside aria-label="Pending join requests" className="mb-6 flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
    <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-100 text-indigo-700">
      <UserPlusIcon />
    </span>
    <p className="min-w-0 flex-1">
      <span className="font-black">Approval needed:</span>{' '}
      You have {requests.length} pending student join request{requests.length === 1 ? '' : 's'}.
      {' '}<Link href="/organisation/users#join-requests" className="font-black text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900">Review now</Link>
    </p>
    <button type="button" onClick={dismiss} aria-label="Dismiss pending join requests reminder" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xl leading-none text-indigo-500 hover:bg-indigo-100 hover:text-indigo-800">×</button>
  </aside>
}

function UserPlusIcon() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1M18 8v6M15 11h6" /></svg>
}
