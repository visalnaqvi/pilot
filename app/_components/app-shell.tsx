'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useAuth } from './auth-context'
import { NotificationPanel } from './notification-panel'
import { PendingJoinRequestsBanner } from './pending-join-requests-banner'

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, profile, actualProfile, ready, isImpersonating, stopImpersonating } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    if (ready && !user) router.replace('/login')
  }, [ready, router, user])
  useEffect(() => {
    if (!mobileMenuOpen) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false)
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [mobileMenuOpen])

  if (!ready || !user) {
    return <main className="grid min-h-screen place-items-center text-slate-500">Loading MockPilot…</main>
  }

  const role = profile?.role ?? 'user'
  const roleLabel = role === 'organisation' ? 'Institute' : role
  const canManage = role === 'admin' || role === 'organisation'
  const organisationProfileId = profile?.uid || user.uid
  const workPath = pathname === '/assignments' || pathname === '/tasks' || pathname === '/timetables' || pathname === '/calendar'
  const testPath = pathname === '/tests'
    || pathname.startsWith('/tests/')
    || pathname === '/manage/tests'
    || pathname.startsWith('/manage/tests/')
    || pathname === '/submissions'
  const managePath = pathname.startsWith('/organisation/')
    || pathname.startsWith('/admin/')
    || pathname === '/invitations'
  const isTakingTest = /^\/tests\/[^/]+$/.test(pathname) && pathname !== '/tests/create'
  const workHref = canManage ? '/assignments' : role === 'user' ? '/tasks' : '/calendar'
  const manageHref = role === 'organisation'
    ? '/organisation/groups'
    : role === 'admin'
      ? '/admin/exam-updates'
      : '/invitations'

  const navClass = (active: boolean) => `inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-2 py-2 text-xs font-semibold transition-colors sm:px-3 sm:text-sm ${
    active ? 'bg-indigo-100 text-indigo-800' : 'text-indigo-700 hover:bg-indigo-50'
  }`
  const workspaceTab = (path: string) => `relative -mb-px flex shrink-0 items-center gap-2 rounded-t-xl border px-3 py-2.5 text-xs font-bold transition-colors sm:gap-3 sm:px-4 sm:py-3 sm:text-sm ${
    pathname === path
      ? 'z-10 border-slate-200 border-b-white bg-white text-indigo-700 shadow-[0_-2px_8px_rgb(15_23_42/0.04)]'
      : 'border-transparent text-slate-500 hover:bg-white/70 hover:text-slate-900'
  }`

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {!isTakingTest && (
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-3 sm:px-5 sm:py-4">
            <div className="flex items-center gap-3">
              <Link href="/dashboard" className="text-xl font-black tracking-tight text-indigo-600">MOCKPILOT</Link>
              <span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold capitalize text-slate-600 sm:inline">
                {roleLabel}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <nav aria-label="Primary navigation" className="hidden items-center justify-end gap-2 sm:flex">
                <Link href="/dashboard" className={navClass(pathname === '/dashboard')}>Dashboard</Link>
                <Link href={workHref} className={navClass(workPath)}>Work</Link>
                <Link href="/tests" className={navClass(testPath)}>Tests</Link>
                <Link href={manageHref} className={navClass(managePath)}>
                  {role === 'user' ? 'Invitations' : 'Manage'}
                </Link>
              </nav>
              <NotificationPanel />
              <div className="hidden sm:block">
                <AccountMenu
                  email={profile?.email || user.email || ''}
                  name={profile?.name || profile?.email || user.email || roleLabel}
                  profileHref={role === 'organisation' ? `/organisations/${organisationProfileId}` : undefined}
                />
              </div>
              <button
                type="button"
                aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                aria-controls="mobile-navigation"
                aria-expanded={mobileMenuOpen}
                onClick={() => setMobileMenuOpen(open => !open)}
                className="grid h-10 w-10 place-items-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 sm:hidden"
              >
                <MenuIcon open={mobileMenuOpen} />
              </button>
            </div>
          </div>
          {mobileMenuOpen && (
            <MobileNavigation
              pathname={pathname}
              workHref={workHref}
              workActive={workPath}
              testsActive={testPath}
              manageHref={manageHref}
              manageActive={managePath}
              manageLabel={role === 'user' ? 'Invitations' : 'Manage'}
              email={profile?.email || user.email || ''}
              name={profile?.name || profile?.email || user.email || roleLabel}
              profileHref={role === 'organisation' ? `/organisations/${organisationProfileId}` : undefined}
              close={() => setMobileMenuOpen(false)}
            />
          )}
        </header>
      )}

      {isImpersonating && (
        <aside className="sticky top-0 z-40 border-b border-violet-300 bg-violet-700 text-white shadow-lg" aria-label="Impersonation status">
          <div className="mx-auto flex max-w-7xl flex-col justify-between gap-3 px-5 py-3 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm font-black">Viewing as {profile?.name || profile?.email}</p>
              <p className="mt-0.5 text-xs text-violet-100">{profile?.email} · {roleLabel} · View-only preview by {actualProfile?.email}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                stopImpersonating()
                router.replace('/dashboard')
              }}
              className="rounded-lg bg-white px-4 py-2 text-sm font-black text-violet-700 hover:bg-violet-50"
            >
              Exit impersonation
            </button>
          </div>
        </aside>
      )}

      <fieldset
        disabled={isImpersonating}
        className="contents"
        onDragStart={event => {
          if (isImpersonating) event.preventDefault()
        }}
      >
        <div
          key={profile?.uid || 'account'}
          className={`mx-auto min-w-0 max-w-7xl px-3 py-6 sm:px-5 sm:py-10 ${
            isImpersonating ? '[&_button]:cursor-not-allowed [&_input]:cursor-not-allowed [&_select]:cursor-not-allowed' : ''
          }`}
        >
          {pathname === '/dashboard' && role === 'organisation' && <PendingJoinRequestsBanner key={profile?.uid || user.uid} />}

          {workPath && (
            <nav aria-label="Work workspace" className="mb-7 overflow-x-auto border-b border-slate-200">
              <div className="flex min-w-max gap-1 px-1">
                {canManage && <Link href="/assignments" className={workspaceTab('/assignments')}>Assignments</Link>}
                {(role === 'organisation' || role === 'user') && <Link href="/tasks" className={workspaceTab('/tasks')}>Tasks</Link>}
                {(role === 'organisation' || role === 'user') && <Link href="/timetables" className={workspaceTab('/timetables')}>Timetables</Link>}
                <Link href="/calendar" className={workspaceTab('/calendar')}>Calendar</Link>
              </div>
            </nav>
          )}

          {testPath && !isTakingTest && (
            <nav aria-label="Test workspace" className="mb-7 overflow-x-auto border-b border-slate-200">
              <div className="flex min-w-max gap-1 px-1">
                <Link href="/tests" className={workspaceTab('/tests')}>Tests</Link>
                {canManage && <Link href="/manage/tests" className={workspaceTab('/manage/tests')}>Manage tests</Link>}
                {canManage && <Link href="/manage/tests/generate" className={workspaceTab('/manage/tests/generate')}>AI generator</Link>}
                <Link href="/submissions" className={workspaceTab('/submissions')}>Submissions</Link>
              </div>
            </nav>
          )}

          {managePath && role !== 'user' && (
            <nav aria-label="Management workspace" className="mb-7 overflow-x-auto border-b border-slate-200">
              <div className="flex min-w-max gap-1 px-1">
                {role === 'organisation' ? (
                  <>
                    <Link href="/organisation/groups" className={workspaceTab('/organisation/groups')}>Groups</Link>
                    <Link href="/organisation/users" className={workspaceTab('/organisation/users')}>Users</Link>
                  </>
                ) : (
                  <>
                    <Link href="/admin/exam-updates" className={workspaceTab('/admin/exam-updates')}>Exam updates</Link>
                    <Link href="/admin/users" className={workspaceTab('/admin/users')}>Users</Link>
                  </>
                )}
              </div>
            </nav>
          )}

          {children}
        </div>
      </fieldset>
    </main>
  )
}

function MobileNavigation({
  pathname,
  workHref,
  workActive,
  testsActive,
  manageHref,
  manageActive,
  manageLabel,
  email,
  name,
  profileHref,
  close,
}: {
  pathname: string
  workHref: string
  workActive: boolean
  testsActive: boolean
  manageHref: string
  manageActive: boolean
  manageLabel: string
  email: string
  name: string
  profileHref?: string
  close: () => void
}) {
  const itemClass = (active: boolean) => `flex items-center justify-between rounded-xl px-4 py-3 text-sm font-bold ${
    active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100'
  }`
  return (
    <div className="fixed inset-0 z-[70] sm:hidden">
      <button type="button" aria-label="Close navigation menu" onClick={close} className="absolute inset-0 bg-slate-950/45" />
      <aside id="mobile-navigation" aria-label="Mobile navigation" className="absolute right-0 top-0 flex h-dvh w-[min(20rem,88vw)] flex-col bg-white p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-2 pb-4">
          <div className="min-w-0">
            <p className="truncate font-black text-slate-950">{name}</p>
            {email && email !== name && <p className="mt-1 truncate text-xs text-slate-500">{email}</p>}
          </div>
          <button type="button" aria-label="Close navigation menu" onClick={close} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-300 text-slate-700">
            <MenuIcon open />
          </button>
        </div>
        <nav aria-label="Mobile primary navigation" className="mt-4 space-y-1">
          <Link href="/dashboard" onClick={close} className={itemClass(pathname === '/dashboard')}>Dashboard <span aria-hidden="true">›</span></Link>
          <Link href={workHref} onClick={close} className={itemClass(workActive)}>Work <span aria-hidden="true">›</span></Link>
          <Link href="/tests" onClick={close} className={itemClass(testsActive)}>Tests <span aria-hidden="true">›</span></Link>
          <Link href={manageHref} onClick={close} className={itemClass(manageActive)}>{manageLabel} <span aria-hidden="true">›</span></Link>
        </nav>
        <div className="mt-auto space-y-1 border-t border-slate-200 pt-4">
          {profileHref && <Link href={profileHref} onClick={close} className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-100"><UserIcon />Profile</Link>}
          <button type="button" onClick={() => { close(); void signOut(auth) }} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-bold text-rose-700 hover:bg-rose-50"><SignOutIcon />Sign out</button>
        </div>
      </aside>
    </div>
  )
}

function AccountMenu({
  email,
  name,
  profileHref,
}: {
  email: string
  name: string
  profileHref?: string
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const initial = name.trim().charAt(0).toUpperCase() || 'U'

  useEffect(() => {
    if (!open) return

    const closeMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label="Open account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className={`grid h-10 w-10 place-items-center rounded-full text-sm font-black transition-colors ${
          open ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
        }`}
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-300/60"
        >
          <div className="border-b border-slate-100 px-3 py-2.5">
            <p className="truncate text-sm font-bold text-slate-900">{name}</p>
            {email && email !== name && <p className="mt-0.5 truncate text-xs text-slate-500">{email}</p>}
          </div>
          <div className="pt-2">
            {profileHref && (
              <Link
                href={profileHref}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                <UserIcon />
                Profile
              </Link>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                void signOut(auth)
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50"
            >
              <SignOutIcon />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function MenuIcon({ open }: { open: boolean }) {
  return open ? (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 17l5-5-5-5M15 12H3M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
    </svg>
  )
}
