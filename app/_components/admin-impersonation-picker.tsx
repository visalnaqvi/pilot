'use client'

import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { db } from '@/lib/firebase'
import { useAuth, type UserProfile } from './auth-context'
import { SearchPicker } from './search-picker'

export function AdminImpersonationPicker() {
  const { actualProfile, isImpersonating, startImpersonating } = useAuth()
  const router = useRouter()
  const [accounts, setAccounts] = useState<UserProfile[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (actualProfile?.role !== 'admin' || isImpersonating) return
    return onSnapshot(query(collection(db, 'users'), orderBy('email')), snapshot => {
      setAccounts(snapshot.docs
        .map(item => ({ uid: item.id, ...item.data() }) as UserProfile)
        .filter(account => account.role === 'user' || account.role === 'organisation'))
      setError('')
    }, reason => setError(`Could not load accounts: ${reason.message}`))
  }, [actualProfile?.role, isImpersonating])

  const options = useMemo(() => accounts.map(account => ({
    id: account.uid,
    label: account.name?.trim() || account.email,
    detail: `${account.email} · ${account.role === 'organisation' ? 'Institute' : 'Student'}`,
  })), [accounts])

  if (actualProfile?.role !== 'admin' || isImpersonating) return null

  return <section className="mb-8 overflow-visible rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 via-white to-indigo-50 p-5 shadow-sm">
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] lg:items-end">
      <div>
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-xl bg-violet-600 text-xl text-white">◎</span>
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-violet-700">Admin view</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">Impersonate an account</h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Search by name or email to preview the entire app exactly as a student or institute sees it. Impersonation is view-only.</p>
      </div>
      <label className="block text-sm font-bold text-slate-800">
        Student or institute
        <span className="mt-2 block font-normal">
          <SearchPicker value="" options={options} onChange={option => {
            const target = accounts.find(account => account.uid === option.id)
            if (!target) return
            startImpersonating(target)
            router.replace('/dashboard')
          }} placeholder="Search name or email" />
        </span>
      </label>
    </div>
    {error && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>}
  </section>
}
