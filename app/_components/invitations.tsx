'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { authenticatedFetch } from '@/lib/authenticated-fetch'
import { useAuth, type UserProfile } from './auth-context'
import { useBrand } from './brand-provider'
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
  const {
    organizationName: deploymentOrganizationName,
    logoUrl: deploymentLogoUrl,
  } = useBrand()
  const [invites, setInvites] = useState<OrganisationInvite[]>([])
  const [organisations, setOrganisations] = useState<UserProfile[]>([])
  const [directoryLoading, setDirectoryLoading] = useState(true)
  const [organisationNames, setOrganisationNames] = useState<Record<string, string>>({})
  const [term, setTerm] = useState('')
  const [message, setMessage] = useState('')
  const [updating, setUpdating] = useState('')
  const allowed = !profile || profile.role === 'user'

  useEffect(() => {
    if (!user || !allowed) return
    let active = true
    void Promise.all([
      authenticatedFetch(user, '/api/memberships', { cache: 'no-store' }),
      authenticatedFetch(user, '/api/organizations?directory=1', { cache: 'no-store' }),
    ]).then(async ([membershipResponse, organizationResponse]) => {
      const [membershipData, organizationData] = await Promise.all([membershipResponse.json(), organizationResponse.json()])
      if (!membershipResponse.ok) throw new Error(membershipData.error || 'Could not load invitations.')
      if (!organizationResponse.ok) throw new Error(organizationData.error || 'Could not load institutes.')
      if (!active) return
      setInvites((membershipData.items || []).map((item: {
        organizationId: string
        organizationName: string
        userId: string
        email: string
        name?: string
        initiatedBy?: string
        status: OrganisationInvite['status']
      }) => ({
        id: `${item.organizationId}:${item.userId}`,
        organisationId: item.organizationId,
        organisationName: item.organizationName,
        organisationEmail: item.organizationName,
        userId: item.userId,
        userName: item.name,
        userEmail: item.email,
        initiatedBy: item.initiatedBy === item.userId ? 'user' : 'organisation',
        status: item.status,
      })))
      setOrganisations((organizationData.items || []).map((item: { id: string; name: string; address?: string; logoUrl?: string }) => ({
        uid: item.id,
        email: item.name,
        name: item.name,
        role: 'organisation' as const,
        address: item.address,
        logoUrl: item.logoUrl,
      })).sort((a: UserProfile, b: UserProfile) => (a.name || a.email).localeCompare(b.name || b.email)))
      setOrganisationNames(Object.fromEntries((organizationData.items || []).map((item: { id: string; name: string }) => [item.id, item.name])))
    }).catch(reason => {
      if (active) setMessage(reason instanceof Error ? reason.message : 'Could not load institutes.')
    }).finally(() => {
      if (active) setDirectoryLoading(false)
    })
    return () => { active = false }
  }, [allowed, user])

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
      const current = inviteFrom(organisation.uid)
      if (current) {
        if (current.status === 'accepted') throw new Error('You have already joined this institute.')
        if (current.status === 'pending') throw new Error(current.initiatedBy === 'user' ? 'Your request is already pending.' : 'This institute has already invited you.')
      }
      const response = await authenticatedFetch(user, '/api/memberships', {
        method: 'POST',
        body: JSON.stringify({ organizationId: organisation.uid, role: 'student' }),
      })
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to send join request.')
      setInvites(items => [...items.filter(item => item.organisationId !== organisation.uid), {
        id: requestId,
        organisationId: organisation.uid,
        organisationName: organisation.name || organisation.email,
        organisationEmail: organisation.email,
        userId: user.uid,
        userName: profile.name || profile.email,
        userEmail: profile.email,
        initiatedBy: 'user',
        status: 'pending',
      }])
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
      if (!user) return
      const response = await authenticatedFetch(user, '/api/memberships', {
        method: 'PATCH',
        body: JSON.stringify({ organizationId: invite.organisationId, userId: invite.userId, status }),
      })
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to respond to invitation.')
      setInvites(items => items.map(item => item.id === invite.id ? { ...item, status } : item))
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
      if (!user) return
      const response = await authenticatedFetch(user, `/api/memberships?organizationId=${invite.organisationId}&userId=${encodeURIComponent(invite.userId)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to leave institute.')
      setInvites(items => items.filter(item => item.id !== invite.id))
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
  const deploymentOrganisation = deploymentOrganizationName ? organisations[0] : undefined
  const deploymentMembership = deploymentOrganisation ? inviteFrom(deploymentOrganisation.uid) : undefined
  const deploymentRequestBusy = Boolean(deploymentOrganisation && updating === `${deploymentOrganisation.uid}_${user?.uid}`)

  return <section className="mx-auto max-w-3xl">
    <p className="text-sm font-bold tracking-widest text-indigo-600">MEMBERSHIP</p>
    <h1 className="mt-1 text-4xl font-black">Institute invitations</h1>
    <p className="mt-3 text-slate-600">Accept an invitation or request to join an institute.</p>

    {deploymentOrganizationName ? <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-xl font-black text-slate-950">Your institute</h2>
      <p className="mt-1 text-sm text-slate-500">This portal is for students of {deploymentOrganizationName}.</p>
      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
        {directoryLoading
          ? <p className="p-5 text-sm text-slate-500">Loading institute...</p>
          : deploymentOrganisation
            ? <div className="flex flex-col justify-between gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <OrganisationIdentity organisation={deploymentOrganisation} fallbackLogoUrl={deploymentLogoUrl} />
                <Link href={`/organisations/${encodeURIComponent(deploymentOrganisation.uid)}`} className="rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-bold text-slate-700 hover:bg-slate-50">Info</Link>
                {deploymentMembership?.status === 'accepted'
                  ? <StatusBadge tone="accepted">Joined</StatusBadge>
                  : deploymentMembership?.status === 'pending'
                    ? <StatusBadge tone="pending">{deploymentMembership.initiatedBy === 'user' ? 'Request pending' : 'Invitation waiting'}</StatusBadge>
                    : <button type="button" disabled={deploymentRequestBusy} onClick={() => void requestToJoin(deploymentOrganisation)} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{deploymentRequestBusy ? 'Sending...' : deploymentMembership?.status === 'declined' ? 'Request again' : 'Request to join'}</button>}
              </div>
            : <p className="p-5 text-sm text-rose-600">{deploymentOrganizationName} is not available. Please contact support.</p>}
      </div>
    </section> : <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
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
    </section>}

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

function OrganisationIdentity({ organisation, fallbackLogoUrl }: { organisation: UserProfile; fallbackLogoUrl?: string }) {
  const logoUrl = organisation.logoUrl || fallbackLogoUrl
  return <div className="flex min-w-0 flex-1 items-center gap-3"><span className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-indigo-50 font-black text-indigo-600">{logoUrl ? <Image src={logoUrl} alt="" fill sizes="44px" className="object-contain p-1" /> : (organisation.name || organisation.email).slice(0, 1).toUpperCase()}</span><div className="min-w-0"><p className="truncate font-bold text-slate-900">{organisation.name || organisation.email}</p><p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{organisation.address || organisation.email}</p></div></div>
}

function StatusBadge({ tone, children }: { tone: 'accepted' | 'pending'; children: React.ReactNode }) {
  return <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold ${tone === 'accepted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{children}</span>
}

function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
}
