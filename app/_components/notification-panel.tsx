'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { assignmentInstanceId } from '@/lib/assignment-instance'
import { useAuth } from './auth-context'

type DateValue = { toDate: () => Date }
type Assignment = {
  id: string
  testId: string
  testTitle?: string
  assignmentBatchId?: string
  assignmentName?: string
  assignedBy: string
  attemptsUsed?: number
  maxAttempts?: number
  startAt?: DateValue
  deadline: DateValue
  createdAt?: DateValue
}
type OrganisationInvite = {
  id: string
  organisationId: string
  organisationEmail?: string
  userName?: string
  userEmail: string
  initiatedBy?: 'organisation' | 'user'
  status: 'pending' | 'accepted' | 'declined'
  createdAt?: DateValue
  respondedAt?: DateValue
}
type OrganisationTest = {
  id: string
  title: string
  createdBy: string
  organisationId?: string
  visibility: 'public' | 'private' | 'assigned'
  createdAt?: DateValue
}
type OrganisationTask = {
  id: string
  title: string
  status: 'todo' | 'in_progress' | 'done'
  organisationId: string
  organisationName?: string
  createdByName?: string
  assignedUserIds: string[]
  createdAt?: DateValue
  startAt?: DateValue
  endAt?: DateValue
  lastStatusAt?: DateValue
  lastStatus?: 'todo' | 'in_progress' | 'done' | 'closed'
  lastStatusUserId?: string
  lastStatusUserName?: string
  lastStatusUpdatedBy?: string
  lastStatusUpdatedByName?: string
  isClosed?: boolean
  closedAt?: DateValue
  closedByName?: string
  lastCommentAt?: DateValue
  lastCommentAuthorId?: string
  lastCommentAuthorName?: string
  lastCommentPreview?: string
}
type PublishedTimetableNotice = {
  id: string
  name: string
  organisationName?: string
  assignedUserIds: string[]
  status: 'active' | 'archived'
  revision: number
  effectiveFrom: string
  effectiveTo: string
  publishedAt?: DateValue
  archivedAt?: DateValue
}
type Notice = {
  id: string
  title: string
  detail: string
  at: number
  href: string
  tone: 'indigo' | 'emerald' | 'amber' | 'violet'
  icon: 'assignment' | 'live' | 'reminder' | 'member' | 'test' | 'task' | 'comment' | 'timetable'
}

const minute = 60_000
const day = 24 * 60 * minute
const time = (value?: DateValue) => value?.toDate().getTime() || 0
const formatDate = (value: number) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function NotificationPanel() {
  const { user, profile } = useAuth()
  const role = profile?.role
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [invites, setInvites] = useState<OrganisationInvite[]>([])
  const [tests, setTests] = useState<OrganisationTest[]>([])
  const [tasks, setTasks] = useState<OrganisationTask[]>([])
  const [timetables, setTimetables] = useState<PublishedTimetableNotice[]>([])
  const [organisationIds, setOrganisationIds] = useState<string[]>([])
  const [failedSourcesByContext, setFailedSourcesByContext] = useState<Record<string, string[]>>({})
  const [readIds, setReadIds] = useState<string[]>(() => {
    if (typeof window === 'undefined' || !user) return []
    try {
      const stored = JSON.parse(window.localStorage.getItem(`mockpilot-notifications-read:${user.uid}`) || '[]')
      return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  })
  const [now, setNow] = useState(() => Date.now())
  const storageKey = user ? `mockpilot-notifications-read:${user.uid}` : ''
  const listenerContext = `${user?.uid || 'signed-out'}:${role || 'unknown'}`
  const failedSources = failedSourcesByContext[listenerContext] || []
  const handleSnapshotError = useCallback((source: string, reason: Error) => {
    console.warn(`Notification listener failed (${source})`, reason)
    setFailedSourcesByContext(current => {
      const failedSourcesForContext = current[listenerContext] || []
      if (failedSourcesForContext.includes(source)) return current
      return { ...current, [listenerContext]: [...failedSourcesForContext, source] }
    })
  }, [listenerContext])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), minute)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!open) return
    const closePanel = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closePanel)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closePanel)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useEffect(() => {
    if (!user || role !== 'user') return
    void user.getIdToken().then(token => fetch('/api/test-session?list=assignments', {
      headers: { authorization: `Bearer ${token}` },
    })).catch(() => undefined)
    return onSnapshot(
      query(collection(db, 'testAssignments'), where('userId', '==', user.uid)),
      snapshot => setAssignments(snapshot.docs
        .map(item => ({ id: item.id, ...item.data() }) as Assignment)
        .filter(item => !!item.assignmentBatchId && item.id === assignmentInstanceId(item.assignmentBatchId, user.uid))),
      reason => handleSnapshotError('assignments', reason),
    )
  }, [handleSnapshotError, role, user])

  useEffect(() => {
    if (!user || role !== 'user') return
    return onSnapshot(
      query(collection(db, 'organisationInvites'), where('userId', '==', user.uid)),
      snapshot => setOrganisationIds(snapshot.docs
        .map(item => item.data() as OrganisationInvite)
        .filter(item => item.status === 'accepted')
        .map(item => item.organisationId)),
      reason => handleSnapshotError('organisations', reason),
    )
  }, [handleSnapshotError, role, user])

  useEffect(() => {
    if (!user || !role) return
    if (role === 'organisation') {
      return onSnapshot(
        query(collection(db, 'organisationInvites'), where('organisationId', '==', user.uid)),
        snapshot => setInvites(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as OrganisationInvite)),
        reason => handleSnapshotError('institute invites', reason),
      )
    }
    if (role === 'admin') {
      return onSnapshot(
        query(collection(db, 'organisationInvites'), where('status', '==', 'accepted')),
        snapshot => setInvites(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as OrganisationInvite)),
        reason => handleSnapshotError('institute invites', reason),
      )
    }
  }, [handleSnapshotError, role, user])

  useEffect(() => {
    if (!user || !role) return
    if (role === 'admin') {
      return onSnapshot(
        query(collection(db, 'tests'), where('deletedAt', '==', null)),
        snapshot => setTests(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as OrganisationTest)),
        reason => handleSnapshotError('tests', reason),
      )
    }
    if (role === 'organisation') {
      return onSnapshot(
        query(collection(db, 'tests'), where('visibility', '==', 'public'), where('deletedAt', '==', null)),
        snapshot => setTests(snapshot.docs
          .map(item => ({ id: item.id, ...item.data() }) as OrganisationTest)
          .filter(test => test.createdBy !== user.uid)),
        reason => handleSnapshotError('tests', reason),
      )
    }
    if (role !== 'user') return

    const testGroups = new Map<string, OrganisationTest[]>()
    const updateTests = (key: string, items: OrganisationTest[]) => {
      testGroups.set(key, items)
      setTests([...testGroups.values()].flat())
    }
    const stops = [
      onSnapshot(
        query(collection(db, 'tests'), where('visibility', '==', 'public'), where('deletedAt', '==', null)),
        snapshot => updateTests('public', snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as OrganisationTest)),
        reason => handleSnapshotError('public tests', reason),
      ),
    ]
    organisationIds.forEach(organisationId => {
      stops.push(onSnapshot(
        query(collection(db, 'tests'), where('visibility', '==', 'private'), where('organisationId', '==', organisationId), where('deletedAt', '==', null)),
        snapshot => updateTests(`private:${organisationId}`, snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as OrganisationTest)),
        reason => handleSnapshotError(`tests for institute ${organisationId}`, reason),
      ))
    })
    return () => stops.forEach(stop => stop())
  }, [handleSnapshotError, organisationIds, role, user])

  useEffect(() => {
    if (!user || (role !== 'organisation' && role !== 'user')) return
    const taskQuery = role === 'organisation'
      ? query(collection(db, 'tasks'), where('organisationId', '==', user.uid))
      : query(collection(db, 'tasks'), where('assignedUserIds', 'array-contains', user.uid))
    return onSnapshot(
      taskQuery,
      snapshot => setTasks(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as OrganisationTask)),
      reason => handleSnapshotError('tasks', reason),
    )
  }, [handleSnapshotError, role, user])

  useEffect(() => {
    if (!user || role !== 'user') return
    return onSnapshot(
      query(collection(db, 'timetables'), where('assignedUserIds', 'array-contains', user.uid)),
      snapshot => setTimetables(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as PublishedTimetableNotice)),
      reason => handleSnapshotError('timetables', reason),
    )
  }, [handleSnapshotError, role, user])

  const notices = useMemo(() => {
    const items: Notice[] = []

    if (role === 'user') {
      assignments.forEach(assignment => {
        const start = time(assignment.startAt) || time(assignment.createdAt)
        const end = time(assignment.deadline)
        const remainingAttempts = (assignment.maxAttempts || 1) - (assignment.attemptsUsed || 0)
        const name = assignment.assignmentName || assignment.testTitle || 'Assignment'
        if (!start || now > end || remainingAttempts <= 0) return
        if (now >= start) {
          items.push({
            id: `live:${assignment.id}`,
            title: `${name} is live`,
            detail: `Available until ${formatDate(end)} · ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} left`,
            at: start,
            href: `/tests/${assignment.testId}${assignment.assignmentBatchId ? `?assignment=${encodeURIComponent(assignment.assignmentBatchId)}` : ''}`,
            tone: 'emerald',
            icon: 'live',
          })
          return
        }
        items.push({
          id: `upcoming:${assignment.id}`,
          title: 'Upcoming assignment',
          detail: `${name} starts ${formatDate(start)}`,
          at: time(assignment.createdAt) || start,
          href: '/calendar',
          tone: 'indigo',
          icon: 'assignment',
        })
        const minutesUntilStart = Math.ceil((start - now) / minute)
        if (minutesUntilStart <= 30) {
          items.push({
            id: `reminder-30:${assignment.id}`,
            title: 'Assignment starts in 30 minutes',
            detail: `${name} starts at ${formatDate(start)}`,
            at: start - 30 * minute,
            href: '/calendar',
            tone: 'amber',
            icon: 'reminder',
          })
        }
        if (minutesUntilStart <= 15) {
          items.push({
            id: `reminder-15:${assignment.id}`,
            title: 'Assignment starts in 15 minutes',
            detail: `${name} starts at ${formatDate(start)}`,
            at: start - 15 * minute,
            href: '/calendar',
            tone: 'amber',
            icon: 'reminder',
          })
        }
      })
      timetables.forEach(timetable => {
        const eventAt = timetable.status === 'archived'
          ? time(timetable.archivedAt)
          : time(timetable.publishedAt)
        if (!eventAt || eventAt < now - 30 * day) return
        const withdrawn = timetable.status === 'archived'
        items.push({
          id: `timetable:${timetable.id}:${timetable.revision}:${timetable.status}`,
          title: withdrawn
            ? 'Timetable withdrawn'
            : timetable.revision > 1
              ? 'Timetable updated'
              : 'New timetable published',
          detail: `${timetable.name} · ${timetable.organisationName || 'Institute'} · ${timetable.effectiveFrom} to ${timetable.effectiveTo}`,
          at: eventAt,
          href: '/timetables',
          tone: withdrawn ? 'violet' : 'indigo',
          icon: 'timetable',
        })
      })
    }

    if (role === 'organisation') {
      invites.filter(invite => invite.status === 'pending' && invite.initiatedBy === 'user').forEach(invite => {
        items.push({
          id: `join-request:${invite.id}:${time(invite.createdAt)}`,
          title: 'New student join request',
          detail: `${invite.userName || invite.userEmail} requested to join your institute`,
          at: time(invite.createdAt),
          href: '/organisation/users#join-requests',
          tone: 'amber',
          icon: 'member',
        })
      })
    }

    invites.filter(invite => invite.status === 'accepted' && time(invite.respondedAt) >= now - 30 * day).forEach(invite => {
      items.push({
        id: `member:${invite.id}`,
        title: 'New member joined',
        detail: role === 'admin' ? `${invite.userEmail} joined ${invite.organisationEmail || 'an institute'}` : `${invite.userEmail} joined your institute`,
        at: time(invite.respondedAt),
        href: role === 'admin' ? '/admin/users' : '/organisation/users',
        tone: 'violet',
        icon: 'member',
      })
    })

    tests.filter(test => time(test.createdAt) >= now - 14 * day && (role === 'admin' || test.visibility !== 'assigned')).forEach(test => {
      items.push({
        id: `test:${test.id}`,
        title: 'New institute test',
        detail: `${test.title} · ${test.visibility === 'private' ? 'Private' : test.visibility === 'assigned' ? 'Assignment' : 'Public'}`,
        at: time(test.createdAt),
        href: '/tests',
        tone: 'indigo',
        icon: 'test',
      })
    })

    if (user && (role === 'organisation' || role === 'user')) {
      tasks.forEach(task => {
        const createdAt = time(task.createdAt)
        const startAt = time(task.startAt)
        if (role === 'user' && startAt > now) return
        const statusAt = time(task.lastStatusAt)
        const commentAt = time(task.lastCommentAt)
        const closedAt = time(task.closedAt)
        const statusLabel = task.lastStatus === 'in_progress' ? 'In progress' : task.lastStatus === 'done' ? 'Done' : task.lastStatus === 'closed' ? 'Closed' : 'To do'

        const assignedNoticeAt = Math.max(createdAt, startAt)
        if (role === 'user' && assignedNoticeAt >= now - 30 * day) {
          items.push({
            id: `task-assigned:${task.id}`,
            title: 'New task assigned',
            detail: `${task.title} · ${task.organisationName || task.createdByName || 'Institute'}`,
            at: assignedNoticeAt,
            href: '/tasks',
            tone: 'indigo',
            icon: 'task',
          })
        }
        if (statusAt > createdAt
          && task.lastStatusUpdatedBy !== user.uid
          && statusAt >= now - 30 * day
          && (role === 'organisation' || task.lastStatusUserId === user.uid)) {
          items.push({
            id: `task-status:${task.id}:${statusAt}`,
            title: `Task moved to ${statusLabel}`,
            detail: role === 'organisation'
              ? `${task.title} · ${task.lastStatusUserName || 'Assigned student'} updated by ${task.lastStatusUpdatedByName || 'a student'}`
              : `${task.title} · Updated by ${task.lastStatusUpdatedByName || 'your institute'}`,
            at: statusAt,
            href: '/tasks',
            tone: task.lastStatus === 'done' ? 'emerald' : task.lastStatus === 'closed' ? 'violet' : 'indigo',
            icon: 'task',
          })
        }
        if (commentAt && task.lastCommentAuthorId !== user.uid && commentAt >= now - 30 * day) {
          items.push({
            id: `task-comment:${task.id}:${commentAt}`,
            title: `New comment on ${task.title}`,
            detail: `${task.lastCommentAuthorName || 'Someone'}: ${task.lastCommentPreview || 'Open the task to read it.'}`,
            at: commentAt,
            href: '/tasks',
            tone: 'violet',
            icon: 'comment',
          })
        }
        if (role === 'user' && task.isClosed && closedAt >= now - 30 * day) {
          items.push({
            id: `task-closed:${task.id}:${closedAt}`,
            title: 'Task closed',
            detail: `${task.title} · Closed by ${task.closedByName || 'your institute'}`,
            at: closedAt,
            href: '/tasks',
            tone: 'violet',
            icon: 'task',
          })
        }
      })
    }

    return items.sort((a, b) => b.at - a.at).slice(0, 20)
  }, [assignments, invites, now, role, tasks, tests, timetables, user])

  const unreadCount = notices.filter(notice => !readIds.includes(notice.id)).length
  const persistReadIds = (ids: string[]) => {
    const next = [...new Set(ids)].slice(-200)
    setReadIds(next)
    if (storageKey) window.localStorage.setItem(storageKey, JSON.stringify(next))
  }
  const markRead = (id: string) => persistReadIds([...readIds, id])
  const markAllRead = () => persistReadIds([...readIds, ...notices.map(notice => notice.id)])

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
        {unreadCount > 0 && <button type="button" onClick={markAllRead} className="text-xs font-bold text-indigo-700 hover:underline">Mark all read</button>}
      </header>
      {failedSources.length > 0 && <p className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">Some notifications could not be loaded. Refresh after your account permissions are updated.</p>}
      <div className="max-h-[min(32rem,70vh)] overflow-y-auto">
        {notices.map(notice => {
          const unread = !readIds.includes(notice.id)
          return <Link key={notice.id} href={notice.href} onClick={() => { markRead(notice.id); setOpen(false) }} className={`grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 border-b border-slate-100 px-4 py-3.5 last:border-0 hover:bg-slate-50 ${unread ? 'bg-indigo-50/40' : ''}`}>
            <span className={`grid h-9 w-9 place-items-center rounded-full ${notice.tone === 'emerald' ? 'bg-emerald-100 text-emerald-700' : notice.tone === 'amber' ? 'bg-amber-100 text-amber-700' : notice.tone === 'violet' ? 'bg-violet-100 text-violet-700' : 'bg-indigo-100 text-indigo-700'}`}><NoticeIcon name={notice.icon} /></span>
            <span className="min-w-0"><span className="flex items-start gap-2"><b className="min-w-0 flex-1 text-sm text-slate-900">{notice.title}</b>{unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-600" />}</span><span className="mt-1 block text-xs leading-5 text-slate-600">{notice.detail}</span><span className="mt-1 block text-[11px] font-medium text-slate-400">{relativeTime(notice.at, now)}</span></span>
          </Link>
        })}
        {!notices.length && <div className="px-6 py-10 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><BellIcon /></span><p className="mt-3 font-bold text-slate-800">No notifications</p><p className="mt-1 text-sm text-slate-500">Tasks, assignments, and institute updates will appear here.</p></div>}
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

function NoticeIcon({ name }: { name: Notice['icon'] }) {
  if (name === 'comment') return <span aria-hidden="true" className="text-sm font-black">···</span>
  if (name === 'task') return <span aria-hidden="true" className="text-sm font-black">✓</span>
  if (name === 'timetable') return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 5h16v14H4zM4 10h16M9 5v14M15 5v14" /></svg>
  if (name === 'member') return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1M18 8v6M15 11h6" /></svg>
  if (name === 'test') return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>
  if (name === 'live') return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="2" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" /></svg>
  if (name === 'reminder') return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 2h6" /></svg>
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>
}
