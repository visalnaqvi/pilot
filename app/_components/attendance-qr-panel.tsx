'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import QRCode from 'qrcode'
import type { AttendanceQrWindow } from '@/lib/attendance'
import { ATTENDANCE_QR_ROTATION_MS } from '@/lib/attendance-qr-config'
import { authenticatedFetch } from '@/lib/authenticated-fetch'
import { useAuth } from './auth-context'

type WindowResponse = {
  window?: AttendanceQrWindow | null
  checkInUrl?: string
  tokenExpiresAt?: string
  error?: string
}

export function AttendanceQrPanel({
  sessionId,
  rosterSize,
  onActiveChange,
  onRosterRefresh,
}: {
  sessionId: string
  rosterSize: number
  onActiveChange: (active: boolean) => void
  onRosterRefresh: (sessionId: string) => Promise<void>
}) {
  const { user } = useAuth()
  const panelRef = useRef<HTMLDivElement>(null)
  const [qrWindow, setQrWindow] = useState<AttendanceQrWindow | null>(null)
  const [checkInUrl, setCheckInUrl] = useState('')
  const [qrImage, setQrImage] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(true)
  const [message, setMessage] = useState('')
  const [active, setActive] = useState(false)

  const refreshWindow = useCallback(async (quiet = false) => {
    if (!user) return
    try {
      const response = await authenticatedFetch(user, `/api/attendance/sessions/${encodeURIComponent(sessionId)}/qr-window`, {
        cache: 'no-store',
      })
      const result = await response.json().catch(() => ({})) as WindowResponse
      if (!response.ok) throw new Error(result.error || 'Unable to refresh the QR code.')
      const nextWindow = result.window || null
      const nextActive = Boolean(nextWindow?.active && new Date(nextWindow.expiresAt).getTime() > Date.now())
      setQrWindow(nextWindow)
      setCheckInUrl(nextActive ? result.checkInUrl || '' : '')
      if (!nextActive) setQrImage('')
      setActive(nextActive)
      setConnected(true)
      if (!quiet) setMessage('')
      onActiveChange(nextActive)
    } catch (reason) {
      setConnected(false)
      setMessage(reason instanceof Error ? reason.message : 'Unable to refresh the QR code.')
    }
  }, [onActiveChange, sessionId, user])

  // The authenticated request starts asynchronously after the panel mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshWindow(true) }, [refreshWindow])

  useEffect(() => {
    if (!checkInUrl) {
      return
    }
    let current = true
    void QRCode.toDataURL(checkInUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 720,
      color: { dark: '#020617', light: '#ffffff' },
    }).then(value => { if (current) setQrImage(value) })
      .catch(() => { if (current) setMessage('Unable to render the QR code. Restart the check-in window.') })
    return () => { current = false }
  }, [checkInUrl])

  useEffect(() => {
    if (!active || !qrWindow) return
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((new Date(qrWindow.expiresAt).getTime() - Date.now()) / 1_000))
      setSecondsLeft(remaining)
      if (!remaining) {
        onActiveChange(false)
        setActive(false)
        setCheckInUrl('')
        setQrImage('')
        void onRosterRefresh(sessionId)
      }
    }
    updateCountdown()
    const countdown = window.setInterval(updateCountdown, 1_000)
    const rotation = window.setInterval(() => void refreshWindow(true), ATTENDANCE_QR_ROTATION_MS)
    const roster = window.setInterval(() => void onRosterRefresh(sessionId), 3_000)
    return () => {
      window.clearInterval(countdown)
      window.clearInterval(rotation)
      window.clearInterval(roster)
    }
  }, [active, onActiveChange, onRosterRefresh, qrWindow, refreshWindow, sessionId])

  async function start() {
    if (!user || busy) return
    setBusy(true)
    setMessage('')
    try {
      const response = await authenticatedFetch(user, `/api/attendance/sessions/${encodeURIComponent(sessionId)}/qr-window`, {
        method: 'POST',
      })
      const result = await response.json().catch(() => ({})) as WindowResponse
      if (!response.ok) throw new Error(result.error || 'Unable to start QR check-in.')
      await refreshWindow()
      await onRosterRefresh(sessionId)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to start QR check-in.')
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    if (!user || busy) return
    setBusy(true)
    setMessage('')
    try {
      const response = await authenticatedFetch(user, `/api/attendance/sessions/${encodeURIComponent(sessionId)}/qr-window`, {
        method: 'DELETE',
      })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Unable to stop QR check-in.')
      setCheckInUrl('')
      setQrImage('')
      setQrWindow(current => current ? { ...current, active: false, closedAt: new Date().toISOString() } : null)
      setActive(false)
      onActiveChange(false)
      await onRosterRefresh(sessionId)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to stop QR check-in.')
    } finally {
      setBusy(false)
    }
  }

  async function enterFullscreen() {
    try {
      await panelRef.current?.requestFullscreen()
    } catch {
      setMessage('Fullscreen is unavailable in this browser. The QR code can still be scanned here.')
    }
  }

  const minutes = Math.floor(secondsLeft / 60)
  const seconds = String(secondsLeft % 60).padStart(2, '0')

  return <section ref={panelRef} className="mt-6 rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-950 via-slate-950 to-slate-900 p-5 text-white shadow-xl sm:p-7 fullscreen:overflow-auto fullscreen:rounded-none fullscreen:p-10">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-300">Secure QR check-in</p>
        <h2 className="mt-2 text-2xl font-black">{active ? 'Student check-in is open' : 'Start classroom check-in'}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">The code rotates every 10 seconds. Students must use their verified account and be on this class roster.</p>
      </div>
      <span className={`rounded-full px-3 py-1.5 text-xs font-black ${connected ? 'bg-emerald-400/20 text-emerald-200' : 'bg-rose-400/20 text-rose-200'}`}>
        {connected ? 'Connected' : 'Connection issue'}
      </span>
    </div>

    {active ? <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(18rem,28rem)_1fr] lg:items-center">
      <div className="rounded-3xl bg-white p-4 shadow-2xl">
        {qrImage
          ? <Image src={qrImage} alt="Secure rotating attendance QR code" width={720} height={720} unoptimized className="aspect-square w-full" />
          : <div className="grid aspect-square place-items-center text-sm font-bold text-slate-500">Refreshing secure code…</div>}
      </div>
      <div>
        <p className="text-sm font-bold text-slate-300">Window closes in</p>
        <p className="mt-1 text-6xl font-black tabular-nums text-white">{minutes}:{seconds}</p>
        <p className="mt-6 text-sm font-bold text-slate-300">QR check-ins</p>
        <p className="mt-1 text-4xl font-black text-emerald-300">{qrWindow?.checkInCount || 0}<span className="text-xl text-slate-400">/{rosterSize}</span></p>
        <div className="mt-7 flex flex-wrap gap-3">
          <button type="button" onClick={() => void enterFullscreen()} className="rounded-xl border border-white/30 px-4 py-3 text-sm font-black hover:bg-white/10">Fullscreen</button>
          <button type="button" disabled={busy} onClick={() => void stop()} className="rounded-xl bg-rose-500 px-4 py-3 text-sm font-black text-white hover:bg-rose-400 disabled:opacity-50">{busy ? 'Stopping…' : 'Stop and review'}</button>
        </div>
      </div>
    </div> : <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white/10 p-5">
      <div><p className="font-black">10-minute teacher-controlled window</p><p className="mt-1 text-sm text-slate-300">Available from 15 minutes before class until 30 minutes after it ends.</p></div>
      <button type="button" disabled={busy} onClick={() => void start()} className="rounded-xl bg-indigo-400 px-5 py-3 text-sm font-black text-slate-950 hover:bg-indigo-300 disabled:opacity-50">{busy ? 'Starting…' : qrWindow ? 'Reopen QR check-in' : 'Start QR check-in'}</button>
    </div>}
    {message && <p role="status" className="mt-4 rounded-xl bg-rose-400/15 p-3 text-sm font-semibold text-rose-100">{message}</p>}
  </section>
}
