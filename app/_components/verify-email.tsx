'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { authenticatedFetch } from '@/lib/authenticated-fetch'
import {
  pendingDisplayNameKey,
  verificationErrorMessage,
} from '@/lib/email-verification'
import {
  requestVerificationEmail,
  VerificationEmailDeliveryError,
} from '@/lib/verification-email-client'
import { BrandLogo } from './brand-logo'
import { useAuth } from './auth-context'
import { useBrand } from './brand-provider'

type DeliveryState = 'sent' | 'failed' | 'cooldown' | null

export function VerifyEmail({
  returnedFromEmail,
  initialDelivery,
  initialCooldown,
}: {
  returnedFromEmail: boolean
  initialDelivery: DeliveryState
  initialCooldown: number
}) {
  const brand = useBrand()
  const router = useRouter()
  const { user, ready, refreshProfile } = useAuth()
  const [checking, setChecking] = useState(false)
  const [resending, setResending] = useState(false)
  const [cooldown, setCooldown] = useState(initialCooldown || (initialDelivery === 'sent' ? 60 : 0))
  const [notice, setNotice] = useState(() => {
    if (initialDelivery === 'sent') return 'Verification email sent. Check your inbox and spam folder.'
    if (initialDelivery === 'cooldown') return 'A verification email was sent recently. Use the latest email in your inbox.'
    if (initialDelivery === 'failed') return 'We could not send the first email. Use the resend button below to try again.'
    return ''
  })
  const [error, setError] = useState('')
  const automaticCheckStarted = useRef(false)
  const checkingRef = useRef(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setInterval(() => setCooldown(value => Math.max(0, value - 1)), 1_000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  const completeVerification = useCallback(async (fromEmailLink = false) => {
    if (!user || checkingRef.current) return false
    checkingRef.current = true
    setChecking(true)
    setError('')

    try {
      await user.reload()
      if (!user.emailVerified) {
        setError(fromEmailLink
          ? 'We still cannot confirm your email. The link may have expired or already been used; request a new email and try again.'
          : 'Your email is not verified yet. Open the latest verification email, follow its link, then check again.')
        return false
      }

      await user.getIdToken(true)
      const displayNameKey = pendingDisplayNameKey(user.uid)
      const pendingDisplayName = window.sessionStorage.getItem(displayNameKey)?.trim()
      const response = await authenticatedFetch(user, '/api/auth/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ name: user.displayName?.trim() || pendingDisplayName || undefined }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || 'Unable to create your profile.')
      }
      window.sessionStorage.removeItem(displayNameKey)
      await refreshProfile()
      router.replace('/dashboard')
      return true
    } catch (reason) {
      setError(verificationErrorMessage(reason, reason instanceof Error
        ? reason.message.replace('Firebase: ', '')
        : 'Unable to confirm your email.'))
      return false
    } finally {
      checkingRef.current = false
      setChecking(false)
    }
  }, [refreshProfile, router, user])

  useEffect(() => {
    if (!ready || !user || automaticCheckStarted.current) return
    if (!user.emailVerified && !returnedFromEmail) return
    automaticCheckStarted.current = true
    const timer = window.setTimeout(() => void completeVerification(returnedFromEmail), 0)
    return () => window.clearTimeout(timer)
  }, [completeVerification, ready, returnedFromEmail, user])

  useEffect(() => {
    if (!ready || !user || user.emailVerified) return
    const checkOnFocus = () => {
      if (document.visibilityState === 'visible') void completeVerification(false)
    }
    window.addEventListener('focus', checkOnFocus)
    document.addEventListener('visibilitychange', checkOnFocus)
    return () => {
      window.removeEventListener('focus', checkOnFocus)
      document.removeEventListener('visibilitychange', checkOnFocus)
    }
  }, [completeVerification, ready, user])

  async function resend() {
    if (!user || cooldown > 0 || resending) return
    setResending(true)
    setError('')
    setNotice('')
    try {
      const delivery = await requestVerificationEmail(user)
      setCooldown(delivery.cooldownSeconds)
      setNotice('A new verification email was sent. Use the latest email in your inbox.')
    } catch (reason) {
      if (reason instanceof VerificationEmailDeliveryError && reason.retryAfterSeconds) {
        setCooldown(reason.retryAfterSeconds)
      }
      setError(verificationErrorMessage(
        reason,
        reason instanceof Error ? reason.message : 'Unable to resend the verification email. Please try again.',
      ))
    } finally {
      setResending(false)
    }
  }

  async function leave() {
    await signOut(auth)
    router.replace('/login')
  }

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-4 text-slate-900 sm:grid sm:place-items-center sm:px-5 sm:py-12">
      <section className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl shadow-slate-950/30 sm:rounded-3xl md:grid-cols-[1.1fr_.9fr]">
        <div className="bg-indigo-600 p-6 text-white sm:p-12">
          <BrandLogo inverse />
          <h1 className="mt-6 text-3xl font-bold leading-tight sm:mt-10 sm:text-5xl">Verify your email</h1>
          <p className="mt-4 max-w-md text-base leading-7 text-indigo-100 sm:mt-5 sm:text-lg sm:leading-8">
            One quick check keeps {brand.name} accounts secure and ensures important test updates reach the right inbox.
          </p>
        </div>

        <div className="p-6 sm:p-12">
          {!ready ? (
            <p className="text-slate-500">Loading your account…</p>
          ) : !user ? (
            <>
              <p className="text-sm font-semibold text-indigo-600">EMAIL VERIFICATION</p>
              <h2 className="mt-2 text-2xl font-bold sm:text-3xl">Sign in to continue</h2>
              <p className="mt-5 leading-7 text-slate-600">
                If you completed the verification link in this browser, your email may already be verified. Sign in to finish opening your account.
              </p>
              <Link href="/login" className="mt-7 block w-full rounded-xl bg-indigo-600 px-4 py-3 text-center font-bold text-white hover:bg-indigo-700">
                Go to sign in
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-indigo-600">CHECK YOUR INBOX</p>
              <h2 className="mt-2 text-2xl font-bold sm:text-3xl">Confirm your email address</h2>
              <p className="mt-5 leading-7 text-slate-600">
                We sent a verification link to <strong className="break-all text-slate-900">{user.email}</strong>. Follow the link, then return here.
              </p>

              {notice && <p className="mt-5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
              {error && <p role="alert" className="mt-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

              <button
                type="button"
                disabled={checking}
                onClick={() => void completeVerification(false)}
                className="mt-7 w-full rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {checking ? 'Checking…' : 'I’ve verified my email'}
              </button>
              <button
                type="button"
                disabled={resending || cooldown > 0}
                onClick={() => void resend()}
                className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {resending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend verification email'}
              </button>
              <button type="button" onClick={() => void leave()} className="mt-5 w-full text-sm font-semibold text-slate-500 hover:text-slate-900">
                Sign out and use another account
              </button>
            </>
          )}
        </div>
      </section>
    </main>
  )
}
