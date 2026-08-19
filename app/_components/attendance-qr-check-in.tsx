'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { authenticatedFetch } from '@/lib/authenticated-fetch'
import { useAuth } from './auth-context'

type CheckInState = 'checking' | 'success' | 'already' | 'error'

export function AttendanceQrCheckIn({ token }: { token?: string }) {
  const { user } = useAuth()
  const [state, setState] = useState<CheckInState>(token ? 'checking' : 'error')
  const [message, setMessage] = useState(token ? 'Verifying your secure check-in…' : 'This QR link is incomplete. Scan the current classroom code again.')
  const [checkedInAt, setCheckedInAt] = useState<string>()

  useEffect(() => {
    if (!user || !token) return
    let active = true
    void authenticatedFetch(user, '/api/attendance/check-in', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }).then(async response => {
      const result = await response.json().catch(() => ({})) as {
        error?: string
        alreadyCheckedIn?: boolean
        checkedInAt?: string
      }
      if (!active) return
      if (!response.ok) {
        setState('error')
        setMessage(result.error || 'Unable to complete check-in. Scan the current code again.')
        return
      }
      setCheckedInAt(result.checkedInAt)
      setState(result.alreadyCheckedIn ? 'already' : 'success')
      setMessage(result.alreadyCheckedIn
        ? 'You were already checked in for this class.'
        : 'Your attendance check-in was recorded successfully.')
    }).catch(() => {
      if (!active) return
      setState('error')
      setMessage('A network error interrupted check-in. Scan the current code again or ask your teacher for help.')
    })
    return () => { active = false }
  }, [token, user])

  const successful = state === 'success' || state === 'already'
  return <section className="mx-auto grid min-h-[65vh] max-w-xl place-items-center px-4">
    <div className={`w-full rounded-3xl border bg-white p-7 text-center shadow-xl sm:p-10 ${successful ? 'border-emerald-200' : state === 'error' ? 'border-rose-200' : 'border-indigo-200'}`}>
      <div className={`mx-auto grid h-16 w-16 place-items-center rounded-full text-3xl ${successful ? 'bg-emerald-100 text-emerald-700' : state === 'error' ? 'bg-rose-100 text-rose-700' : 'bg-indigo-100 text-indigo-700'}`}>
        {successful ? '✓' : state === 'error' ? '!' : '…'}
      </div>
      <p className="mt-6 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Secure attendance</p>
      <h1 className="mt-2 text-3xl font-black text-slate-950">
        {successful ? 'Check-in confirmed' : state === 'error' ? 'Check-in not completed' : 'Checking you in'}
      </h1>
      <p role="status" className="mt-4 text-sm font-semibold leading-6 text-slate-600">{message}</p>
      {checkedInAt && <p className="mt-3 text-xs text-slate-400">Recorded at {new Date(checkedInAt).toLocaleTimeString()}</p>}
      {state === 'error' && <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-800">QR codes rotate quickly. Make sure you are signed in, then scan the code currently displayed by your teacher.</p>}
      <Link href="/attendance" className="mt-7 inline-flex rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-slate-800">View my attendance</Link>
    </div>
  </section>
}
