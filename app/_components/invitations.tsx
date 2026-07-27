'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth, type UserProfile } from './auth-context'
import { paginate, Pagination } from './pagination'

type OrganisationInvite = {
  id: string
  organisationId: string
  organisationName?: string
  organisationEmail: string
  userId: string
  userName?: string
  userEmail: string
  initiatedBy?: 'organisation' | 'user'
  status: 'pending' | 'accepted' | 'declined'
}

export function Invitations() {
  const { user, profile } = useAuth()
  const [invites, setInvites] = useState<OrganisationInvite[]>([])
  const [organisations, setOrganisations] = useState<UserProfile[]>([])
  const [organisationNames, setOrganisationNames] = useState<Record<string, string>>({})
  const [term, setTerm] = useState('')
  const [message, setMessage] = useState('')
  const [updating, setUpdating] = useState('')
  const allowed = !profile || profile.role === 'user'

  useEffect(() => {
    if (!user || !allowed) return
    return onSnapshot(
      query(collection(db, 'organisationInvites'), where('userId', '==', user.uid)),
      snapshot => setInvites(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as OrganisationInvite)),
      reason => setMessage(`Could not load invitations: ${reason.message}`),
    )
  }, [allowed, user])

  useEffect(() => {
    if (!user || !allowed) return
    let active = true
    void getDocs(query(collection(db, 'users'), where('role', '==', 'organisation')))
      .then(snapshot => {
        if (active) setOrganisations(snapshot.docs
          .map(item => ({ uid: item.id, ...item.data() }) as UserProfile)
          .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)))
      })
      .catch(reason => setMessage(reason instanceof Error ? reason.message : 'Could not load institutes.'))
    return () => { active = false }
  }, [allowed, user])

  useEffect(() => {
    let active = true
    const missing = [...new Map(invites
      .filter(invite => !invite.organisationName && !organisationNames[invite.organisationId])
      .map(invite => [invite.organisationId, invite]))
      .values()]
    if (!missing.length) return
    void Promise.all(missing.map(async invite => {
      try {
        const snapshot = await getDoc(doc(db, 'users', invite.organisationId))
        const name = snapshot.data()?.name
        return [invite.organisationId, typeof name === 'string' && name.trim() ? name : invite.organisationEmail] as const
      } catch {
        return [invite.organisationId, invite.organisationEmail] as const
      }
    })).then(entries => {
      if (active) setOrganisationNames(current => ({ ...current, ...Object.fromEntries(entries) }))
    })
    return () => { active = false }
  }, [invites, organisationNames])

  const nameOf = (invite: OrganisationInvite) => invite.organisationName || organisationNames[invite.organisationId] || invite.organisationEmail
  const inviteFrom = (organisationId: string) => invites.find(invite => invite.organisationId === organisationId)
  const normalizedTerm = term.trim().toLowerCase()
  const matches = useMemo(
    () => normalizedTerm
      ? organisations.filter(organisation => `${organisation.name || ''} ${organisation.email}`.toLowerCase().includes(normalizedTerm)).slice(0, 8)
      : [],
    [normalizedTerm, organisations],
  )

  async function requestToJoin(organisation: UserProfile) {
    if (!user || !profile) return
    const requestId = `${organisation.uid}_${user.uid}`
    setUpdating(requestId)
    setMessage('')
    try {
      const requestRef = doc(db, 'organisationInvites', requestId)
      const current = inviteFrom(organisation.uid)
      if (current) {
        if (current.status === 'accepted') throw new Error('You have already joined this institute.')
        if (current.status === 'pending') throw new Error(current.initiatedBy === 'user' ? 'Your request is already pending.' : 'This institute has already invited you.')
        await updateDoc(requestRef, { status: 'pending', initiatedBy: 'user', createdAt: serverTimestamp() })
      } else {
        await setDoc(requestRef, {
          organisationId: organisation.uid,
          organisationName: organisation.name || organisation.email,
          organisationEmail: organisation.email,
          userId: user.uid,
          userName: profile.name || profile.email,
          userEmail: profile.email,
          initiatedBy: 'user',
          status: 'pending',
          createdAt: serverTimestamp(),
        })
      }
      setMessage(`Request sent to ${organisation.name || organisation.email}.`)
      setTerm('')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to send join request.')
    } finally {
      setUpdating('')
    }
  }

  async function respond(invite: OrganisationInvite, status: 'accepted' | 'declined') {
    setUpdating(invite.id)
    setMessage('')
    try {
      await updateDoc(doc(db, 'organisationInvites', invite.id), { status, respondedAt: serverTimestamp() })
      setMessage(status === 'accepted' ? `You joined ${nameOf(invite)}.` : 'Invitation declined.')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to respond to invitation.')
    } finally {
      setUpdating('')
    }
  }

  async function leaveOrganisation(invite: OrganisationInvite) {
    if (!window.confirm(`Leave ${nameOf(invite)}? You will lose access to this institute's private tests and assignments.`)) return
    setUpdating(invite.id)
    setMessage('')
    try {
      await deleteDoc(doc(db, 'organisationInvites', invite.id))
      setMessage(`You left ${nameOf(invite)}.`)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to leave institute.')
    } finally {
      setUpdating('')
    }
  }

  if (!allowed) return <section><h1 className="text-3xl font-black">Access denied</h1><p className="mt-3 text-slate-600">Institute accounts cannot join another institute.</p></section>

  const pendingInvitations = invites.filter(invite => invite.status === 'pending' && invite.initiatedBy !== 'user')
  const sentRequests = invites.filter(invite => invite.status === 'pending' && invite.initiatedBy === 'user')
  const joined = invites.filter(invite => invite.status === 'accepted')

  return <section className="mx-auto max-w-3xl">
    <p className="text-sm font-bold tracking-widest text-indigo-600">MEMBERSHIP</p>
    <h1 className="mt-1 text-4xl font-black">Institute invitations</h1>
    <p className="mt-3 text-slate-600">Accept an invitation or request to join an institute.</p>

    <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-xl font-black text-slate-950">Find an institute</h2>
      <p className="mt-1 text-sm text-slate-500">Search by institute name or email and send a join request.</p>
      <label className="mt-4 block text-sm font-bold text-slate-800">
        Search institutes
        <div className="relative mt-2">
          <SearchIcon />
          <input value={term} onChange={event => setTerm(event.target.value)} type="search" placeholder="Start typing a name or email" className="w-full rounded-xl border border-slate-300 py-3 pl-11 pr-4 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
        </div>
      </label>
      {normalizedTerm && <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
        {matches.map(organisation => {
          const existing = inviteFrom(organisation.uid)
          const busy = updating === `${organisation.uid}_${user?.uid}`
          return <div key={organisation.uid} className="flex flex-col justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0 sm:flex-row sm:items-center">
            <OrganisationIdentity organisation={organisation} />
            <Link href={`/organisations/${encodeURIComponent(organisation.uid)}`} className="rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-bold text-slate-700 hover:bg-slate-50">Info</Link>
            {existing?.status === 'accepted'
              ? <StatusBadge tone="accepted">Joined</StatusBadge>
              : existing?.status === 'pending'
                ? <StatusBadge tone="pending">{existing.initiatedBy === 'user' ? 'Request pending' : 'Invitation waiting'}</StatusBadge>
                : <button type="button" disabled={busy} onClick={() => void requestToJoin(organisation)} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Sending…' : existing?.status === 'declined' ? 'Request again' : 'Request to join'}</button>}
          </div>
        })}
        {!matches.length && <p className="p-5 text-sm text-slate-500">No institutes match that name or email.</p>}
      </div>}
    </section>

    {message && <p className="mt-5 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-800">{message}</p>}

    <InviteList title="Pending invitations" empty="You have no pending invitations." invites={pendingInvitations} nameOf={nameOf} action={invite => <div className="flex gap-2"><button type="button" disabled={updating === invite.id} onClick={() => void respond(invite, 'declined')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold disabled:opacity-50">Decline</button><button type="button" disabled={updating === invite.id} onClick={() => void respond(invite, 'accepted')} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Accept</button></div>} />
    <InviteList title="Sent requests" empty="You have no pending join requests." invites={sentRequests} nameOf={nameOf} action={() => <StatusBadge tone="pending">Awaiting approval</StatusBadge>} />
    <InviteList title="Joined institutes" empty="You have not joined an institute yet." invites={joined} nameOf={nameOf} action={invite => <button type="button" disabled={updating === invite.id} onClick={() => void leaveOrganisation(invite)} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50">{updating === invite.id ? 'Leaving…' : 'Leave'}</button>} />
  </section>
}

function InviteList({ title, empty, invites, nameOf, action }: { title: string; empty: string; invites: OrganisationInvite[]; nameOf: (invite: OrganisationInvite) => string; action?: (invite: OrganisationInvite) => React.ReactNode }) {
  const [page, setPage] = useState(1)
  const visibleInvites = paginate(invites, page)
  return <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <h2 className="border-b border-slate-200 bg-slate-50 px-5 py-4 font-bold">{title} <span className="text-slate-400">({invites.length})</span></h2>
    {!invites.length
      ? <p className="p-5 text-sm text-slate-500">{empty}</p>
      : visibleInvites.items.map(invite => <div key={invite.id} className="flex flex-col justify-between gap-3 border-b border-slate-100 px-5 py-4 last:border-0 sm:flex-row sm:items-center"><div className="min-w-0"><p className="truncate font-bold text-slate-900">{nameOf(invite)}</p><p className="mt-1 truncate text-sm text-slate-500">{invite.organisationEmail}</p></div>{action?.(invite)}</div>)}
    <Pagination page={visibleInvites.page} totalItems={invites.length} onPageChange={setPage} itemLabel="invitations" />
  </div>
}

function OrganisationIdentity({ organisation }: { organisation: UserProfile }) {
  return <div className="flex min-w-0 flex-1 items-center gap-3"><span className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-indigo-50 font-black text-indigo-600">{organisation.logoUrl ? <Image src={organisation.logoUrl} alt="" fill sizes="44px" className="object-cover" /> : (organisation.name || organisation.email).slice(0, 1).toUpperCase()}</span><div className="min-w-0"><p className="truncate font-bold text-slate-900">{organisation.name || organisation.email}</p><p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{organisation.address || organisation.email}</p></div></div>
}

function StatusBadge({ tone, children }: { tone: 'accepted' | 'pending'; children: React.ReactNode }) {
  return <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold ${tone === 'accepted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{children}</span>
}

function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
}
