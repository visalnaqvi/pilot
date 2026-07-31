'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { authenticatedFetch } from '@/lib/authenticated-fetch'
import { useAuth } from './auth-context'

type NoticeIconName = 'comment' | 'task' | 'timetable' | 'member' | 'test' | 'live' | 'reminder' | 'calendar' | 'assignment'
type Notification = {
  id: string
  title: string
  detail: string
  href: string
  tone: string
  icon: NoticeIconName
  read: boolean
  visibleAt: string
}

const minute = 60_000
const day = 24 * 60 * minute

export function NotificationPanel() {
  const { user } = useAuth()
  const [items, setItems] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(0)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    if (!user || document.visibilityState !== 'visible') return
    const response = await authenticatedFetch(user, '/api/notifications', { cache: 'no-store' })
    if (response.ok) setItems((await response.json()).items || [])
  }, [user])

  useEffect(() => {
    queueMicrotask(() => setNow(Date.now()))
    queueMicrotask(() => void load())
    const poller = window.setInterval(() => void load(), 30_000)
    const clock = window.setInterval(() => setNow(Date.now()), minute)
    const onVisibility = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(poller)
      window.clearInterval(clock)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  async function markRead(ids: string[]) {
    if (!user || !ids.length) return
    setItems(current => current.map(item => ids.includes(item.id) ? { ...item, read: true } : item))
    await authenticatedFetch(user, '/api/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ ids }),
    })
  }

  const unreadCount = items.filter(item => !item.read).length
  return <div ref={panelRef} className="relative">
    <button
      type="button"
      aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
      aria-expanded={open}
      onClick={() => setOpen(value => !value)}
      className="relative grid h-10 w-10 place-items-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
    >
      <BellIcon />
      {unreadCount > 0 && <span className="absolute -right-1.5 -top-1.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white ring-2 ring-white">{unreadCount > 9 ? '9+' : unreadCount}</span>}
    </button>

    {open && <section aria-label="Notifications" className="notification-popover absolute right-0 top-12 z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-300/60">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div><h2 className="font-black text-slate-950">Notifications</h2><p className="mt-0.5 text-xs text-slate-500">{unreadCount ? `${unreadCount} unread` : 'You’re all caught up'}</p></div>
        {unreadCount > 0 && <button type="button" onClick={() => void markRead(items.filter(item => !item.read).map(item => item.id))} className="text-xs font-bold text-indigo-700 hover:underline">Mark all read</button>}
      </header>
      <div className="max-h-[min(32rem,70vh)] overflow-y-auto">
        {items.map(notice => <Link key={notice.id} href={notice.href} onClick={() => { void markRead([notice.id]); setOpen(false) }} className={`grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 border-b border-slate-100 px-4 py-3.5 last:border-0 hover:bg-slate-50 ${notice.read ? '' : 'bg-indigo-50/40'}`}>
          <span className={`grid h-9 w-9 place-items-center rounded-full ${notice.tone === 'emerald' ? 'bg-emerald-100 text-emerald-700' : notice.tone === 'amber' ? 'bg-amber-100 text-amber-700' : notice.tone === 'violet' ? 'bg-violet-100 text-violet-700' : 'bg-indigo-100 text-indigo-700'}`}><NoticeIcon name={notice.icon} /></span>
          <span className="min-w-0"><span className="flex items-start gap-2"><b className="min-w-0 flex-1 text-sm text-slate-900">{notice.title}</b>{!notice.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-600" />}</span><span className="mt-1 block text-xs leading-5 text-slate-600">{notice.detail}</span><span className="mt-1 block text-[11px] font-medium text-slate-400">{relativeTime(new Date(notice.visibleAt).getTime(), now)}</span></span>
        </Link>)}
        {!items.length && <div className="px-6 py-10 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><BellIcon /></span><p className="mt-3 font-bold text-slate-800">No notifications</p><p className="mt-1 text-sm text-slate-500">Tasks, assignments, and institute updates will appear here.</p></div>}
      </div>
    </section>}
  </div>
}

function relativeTime(value: number, now: number) {
  if (!value) return 'Pending review'
  const difference = now - value
  if (difference < minute) return 'Just now'
  if (difference < 60 * minute) return `${Math.floor(difference / minute)}m ago`
  if (difference < day) return `${Math.floor(difference / (60 * minute))}h ago`
  if (difference < 7 * day) return `${Math.floor(difference / day)}d ago`
  return new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function BellIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
}

function NoticeIcon({ name }: { name: NoticeIconName }) {
  if (name === 'comment') return <span aria-hidden="true" className="text-sm font-black">···</span>
  if (name === 'task') return <span aria-hidden="true" className="text-sm font-black">✓</span>
  if (name === 'timetable') return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 5h16v14H4zM4 10h16M9 5v14M15 5v14" /></svg>
  if (name === 'member') return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1M18 8v6M15 11h6" /></svg>
  if (name === 'test') return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>
  if (name === 'live') return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="2" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" /></svg>
  if (name === 'reminder') return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 2h6" /></svg>
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>
}
