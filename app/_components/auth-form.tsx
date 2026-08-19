'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useAuth } from './auth-context'
import { BrandLogo } from './brand-logo'
import { useBrand } from './brand-provider'
import {
  pendingDisplayNameKey,
  verificationErrorMessage,
} from '@/lib/email-verification'
import {
  requestVerificationEmail,
  VerificationEmailDeliveryError,
} from '@/lib/verification-email-client'
import { safeReturnTo } from '@/lib/auth-return'

export function AuthForm({ mode, returnTo }: { mode: 'login' | 'signup'; returnTo?: string }) {
  const brand = useBrand()
  const { user, ready } = useAuth()
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submittingRef = useRef(false)
  const destination = safeReturnTo(returnTo)

  useEffect(() => {
    if (!ready || !user || submittingRef.current) return
    router.replace(user.emailVerified ? destination : '/verify-email')
  }, [destination, ready, router, user])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSaving(true)
    submittingRef.current = true

    if (mode === 'signup') {
      const displayName = name.trim()
      if (!displayName) {
        setError('Enter your name.')
        setSaving(false)
        submittingRef.current = false
        return
      }

      try {
        const credential = await createUserWithEmailAndPassword(auth, email, password)
        window.sessionStorage.setItem(pendingDisplayNameKey(credential.user.uid), displayName)
        try {
          await updateProfile(credential.user, { displayName })
        } catch (reason) {
          console.error(reason)
        }
        try {
          const delivery = await requestVerificationEmail(credential.user)
          router.replace(`/verify-email?delivery=sent&cooldown=${delivery.cooldownSeconds}`)
        } catch (reason) {
          console.error(reason)
          const retryAfter = reason instanceof VerificationEmailDeliveryError
            ? reason.retryAfterSeconds
            : undefined
          const query = new URLSearchParams({ delivery: retryAfter ? 'cooldown' : 'failed' })
          if (retryAfter) query.set('cooldown', String(retryAfter))
          router.replace(`/verify-email?${query}`)
        }
      } catch (reason) {
        setError(verificationErrorMessage(
          reason,
          reason instanceof Error ? reason.message.replace('Firebase: ', '') : 'Unable to create your account.',
        ))
        setSaving(false)
        submittingRef.current = false
      }
      return
    }

    try {
      const credential = await signInWithEmailAndPassword(auth, email, password)
      router.replace(credential.user.emailVerified ? destination : '/verify-email')
    } catch (reason) {
      setError(verificationErrorMessage(
        reason,
        reason instanceof Error ? reason.message.replace('Firebase: ', '') : 'Unable to sign in.',
      ))
      setSaving(false)
      submittingRef.current = false
    }
  }
  return <main className="min-h-screen bg-slate-950 px-3 py-4 text-slate-900 sm:grid sm:place-items-center sm:px-5 sm:py-12"><section className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl shadow-slate-950/30 sm:rounded-3xl md:grid-cols-[1.1fr_.9fr]"><div className="bg-indigo-600 p-6 text-white sm:p-12"><BrandLogo inverse /><h1 className="mt-6 text-3xl font-bold leading-tight sm:mt-10 sm:text-5xl">{brand.tagline}</h1><p className="mt-4 max-w-md text-base leading-7 text-indigo-100 sm:mt-5 sm:text-lg sm:leading-8">Take marked mock tests and receive your score the moment you submit.</p></div><form onSubmit={submit} className="p-6 sm:p-12"><p className="text-sm font-semibold text-indigo-600">WELCOME</p><h2 className="mt-2 text-2xl font-bold sm:text-3xl">{mode === 'login' ? 'Sign in to continue' : 'Create your account'}</h2>{mode === 'signup' && <label className="mt-6 block text-sm font-semibold sm:mt-8">Name<input value={name} onChange={event => setName(event.target.value)} required className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-indigo-500" /></label>}<label className={`${mode === 'signup' ? 'mt-5' : 'mt-6 sm:mt-8'} block text-sm font-semibold`}>Email<input value={email} onChange={event => setEmail(event.target.value)} type="email" required className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-indigo-500" /></label><label className="mt-5 block text-sm font-semibold">Password<input value={password} onChange={event => setPassword(event.target.value)} type="password" minLength={6} required className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-indigo-500" /></label>{error && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<button disabled={saving} className="mt-7 w-full rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button><Link href={mode === 'login' ? '/signup' : '/login'} className="mt-5 block text-center text-sm font-semibold text-indigo-600">{mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}</Link></form></section></main>
}
