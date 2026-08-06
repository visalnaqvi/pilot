'use client'

import { useEffect, useMemo, useState } from 'react'
import { authenticatedFetch } from '@/lib/authenticated-fetch'
import { useAuth, type UserProfile } from './auth-context'
import { OrganisationUserDashboardModal } from './exam-dashboard'
import { paginate, Pagination } from './pagination'
import type { MockTest, Submission } from './test-types'
import { memberRole, type MemberRole, type OrganizationMembershipRole } from '@/lib/membership'

type OrganisationInvite = { id: string; organisationId: string; organisationName?: string; organisationEmail: string; userId: string; userName?: string; userEmail: string; initiatedBy?: 'organisation' | 'user'; status: 'pending' | 'accepted' | 'declined'; memberRole?: OrganizationMembershipRole; notificationEmails: string[] }
type Group = { id: string; name: string; targetExamId?: string; targetExamName?: string; members: { userId: string }[] }
type AttendanceSessionSummary = { status: string; roster: { userId: string; status?: string; mark?: string }[] }
type OrganisationOption = { id: string; name: string }

const score = (item: Submission) => item.totalMarks ? item.score / item.totalMarks * 100 : 0

export function OrganisationUsers() {
  const { user, profile } = useAuth()
  const allowed = profile?.role === 'organisation' || profile?.role === 'admin'
  const [organisations, setOrganisations] = useState<OrganisationOption[]>([])
  const [adminOrganizationId, setAdminOrganizationId] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [studentFilter, setStudentFilter] = useState('')
  const [accounts, setAccounts] = useState<UserProfile[]>([])
  const [invites, setInvites] = useState<OrganisationInvite[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [openedUser, setOpenedUser] = useState<UserProfile | null>(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState('')
  const [responding, setResponding] = useState('')
  const [removing, setRemoving] = useState('')
  const [changingRole, setChangingRole] = useState('')
  const [savingNotificationEmails, setSavingNotificationEmails] = useState(false)
  const [managingStudent, setManagingStudent] = useState<{ account: UserProfile; membership: OrganisationInvite } | null>(null)
  const [notificationEmailDraft, setNotificationEmailDraft] = useState('')
  const [managementMessage, setManagementMessage] = useState('')
  const [attendance, setAttendance] = useState<Record<string, { present: number; absent: number }>>({})
  const [requestsPage, setRequestsPage] = useState(1)
  const [joinedPage, setJoinedPage] = useState(1)
  const [teachersPage, setTeachersPage] = useState(1)
  const [invitesPage, setInvitesPage] = useState(1)
  const organizationId = profile?.role === 'organisation' ? profile.organizationId : adminOrganizationId
  const organizationName = organisations.find(item => item.id === organizationId)?.name || profile?.name || 'Institute'

  useEffect(() => {
    if (!user || profile?.role !== 'admin') return
    let active = true
    void authenticatedFetch(user, '/api/organizations', { cache: 'no-store' }).then(async response => {
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to load institutes.')
      const items = (payload.items || []) as OrganisationOption[]
      if (!active) return
      setOrganisations(items)
      setAdminOrganizationId(current => current || items[0]?.id || '')
    }).catch(reason => {
      if (active) setMessage(reason instanceof Error ? reason.message : 'Unable to load institutes.')
    })
    return () => { active = false }
  }, [profile?.role, user])

  useEffect(() => {
    if (!user || !allowed || !organizationId) return
    let active = true
    void Promise.all([
      authenticatedFetch(user, `/api/memberships?organizationId=${organizationId}`, { cache: 'no-store' }),
      authenticatedFetch(user, '/api/users?directory=1', { cache: 'no-store' }),
      authenticatedFetch(user, '/api/test-submissions', { cache: 'no-store' }),
      authenticatedFetch(user, `/api/groups?organizationId=${organizationId}`, { cache: 'no-store' }),
    ]).then(async responses => {
      const payloads = await Promise.all(responses.map(response => response.json()))
      const failed = responses.findIndex(response => !response.ok)
      if (failed >= 0) throw new Error(payloads[failed].error || 'Unable to load institute members.')
      if (!active) return
      setInvites((payloads[0].items || []).map((item: {
        organizationId: string
        organizationName: string
        userId: string
        email: string
        name?: string
        status: OrganisationInvite['status']
        role: OrganizationMembershipRole
        initiatedBy?: string
        notificationEmails?: string[]
      }) => ({
        id: `${item.organizationId}:${item.userId}`,
        organisationId: item.organizationId,
        organisationName: item.organizationName,
        organisationEmail: profile?.email || '',
        userId: item.userId,
        userName: item.name,
        userEmail: item.email,
        initiatedBy: item.initiatedBy === item.userId ? 'user' : 'organisation',
        status: item.status,
        memberRole: item.role,
        notificationEmails: item.notificationEmails || [],
      })))
      setAccounts((payloads[1].items || []) as UserProfile[])
      setSubmissions(((payloads[2].items || []) as Submission[]).filter(item => item.gradingStatus !== 'pending').map(item => typeof item.submittedAt === 'string'
        ? { ...item, submittedAt: { toDate: () => new Date(item.submittedAt as string) } }
        : item))
      setGroups((payloads[3].items || []) as Group[])
      setMessage('')
    }).catch(reason => {
      if (active) setMessage(reason instanceof Error ? reason.message : 'Unable to load institute members.')
    })
    return () => { active = false }
  }, [allowed, organizationId, profile?.email, user])
  useEffect(() => {
    if (!user || !allowed || !organizationId) return
    let active = true
    void authenticatedFetch(user, `/api/attendance?organizationId=${organizationId}`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Unable to load attendance summaries.')))
      .then((payload: { sessions?: AttendanceSessionSummary[] }) => {
        if (!active) return
        const values: Record<string, { present: number; absent: number }> = {}
        ;(payload.sessions || []).filter(session => session.status === 'submitted').forEach(session => {
          session.roster.forEach(record => {
            const current = values[record.userId] || { present: 0, absent: 0 }
            if ((record.status || record.mark) === 'present') current.present += 1
            if ((record.status || record.mark) === 'absent') current.absent += 1
            values[record.userId] = current
          })
        })
        setAttendance(values)
      }).catch(() => undefined)
    return () => { active = false }
  }, [allowed, organizationId, user])
  const tests = useMemo(() => [...new Map(submissions.map(item => [item.testId, { id: item.testId, title: item.testTitle, exam: item.testExam, examId: item.testExamId, category: item.testCategory, description: '', durationMinutes: 0, createdBy: '', visibility: 'public' as const } satisfies MockTest])).values()], [submissions])
  const pending = invites.filter(invite => invite.status === 'pending' && invite.initiatedBy !== 'user')
  const joinRequests = invites.filter(invite => invite.status === 'pending' && invite.initiatedBy === 'user')
  const studentMemberships = invites.filter(invite => invite.userId !== user?.uid && invite.status === 'accepted' && memberRole(invite.memberRole) === 'student')
  const teacherMemberships = invites.filter(invite => invite.userId !== user?.uid && invite.status === 'accepted' && memberRole(invite.memberRole) === 'teacher')
  const joined = studentMemberships.map(invite => accounts.find(account => account.uid === invite.userId) || { uid: invite.userId, email: invite.userEmail, name: invite.userEmail, role: 'user' as const })
  const teachers = teacherMemberships.map(invite => accounts.find(account => account.uid === invite.userId) || { uid: invite.userId, email: invite.userEmail, name: invite.userEmail, role: 'user' as const })
  const normalizedStudentFilter = studentFilter.trim().toLowerCase()
  const filteredJoined = normalizedStudentFilter
    ? joined.filter(account => `${account.name || ''} ${account.email}`.toLowerCase().includes(normalizedStudentFilter))
    : joined
  const visibleRequests = paginate(joinRequests, requestsPage)
  const visibleJoined = paginate(filteredJoined, joinedPage)
  const visibleTeachers = paginate(teachers, teachersPage)
  const visibleInvites = paginate(pending, invitesPage)
  const normalizedTerm = term.trim().toLowerCase()
  const suggestions = normalizedTerm ? accounts.filter(account => account.uid !== user?.uid && account.role !== 'admin' && `${account.name || ''} ${account.email}`.toLowerCase().includes(normalizedTerm)).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).slice(0, 8) : []

  async function invite(account: UserProfile) {
    if (!user || !profile || !organizationId) return
    setSending(account.uid); setMessage('')
    try {
      const response = await authenticatedFetch(user, '/api/memberships', {
        method: 'POST',
        body: JSON.stringify({ organizationId, email: account.email, role: 'student' }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to send invitation.')
      setInvites(current => [...current.filter(item => item.userId !== account.uid), {
        id: `${organizationId}:${account.uid}`,
        organisationId: organizationId,
        organisationName: organizationName,
        organisationEmail: profile.email,
        userId: account.uid,
        userName: account.name || account.email,
        userEmail: account.email,
        initiatedBy: 'organisation',
        status: 'pending',
        memberRole: 'student',
        notificationEmails: [],
      }])
      setMessage(`Invitation sent to ${account.email}.`); setTerm('')
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to send invitation.') } finally { setSending('') }
  }
  async function withdraw(invite: OrganisationInvite) {
    try {
      if (!user) return
      const response = await authenticatedFetch(user, `/api/memberships?organizationId=${invite.organisationId}&userId=${encodeURIComponent(invite.userId)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to withdraw invitation.')
      setInvites(current => current.filter(item => item.id !== invite.id))
      setMessage(`Invitation to ${invite.userEmail} withdrawn.`)
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to withdraw invitation.') }
  }
  async function respondToRequest(invite: OrganisationInvite, status: 'accepted' | 'declined') {
    setResponding(invite.id)
    setMessage('')
    try {
      if (!user) return
      const response = await authenticatedFetch(user, '/api/memberships', {
        method: 'PATCH',
        body: JSON.stringify({ organizationId: invite.organisationId, userId: invite.userId, status }),
      })
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to respond to join request.')
      setInvites(current => current.map(item => item.id === invite.id ? { ...item, status } : item))
      setMessage(status === 'accepted' ? `${invite.userName || invite.userEmail} joined your institute.` : 'Join request declined.')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to respond to join request.')
    } finally {
      setResponding('')
    }
  }
  async function removeMember(invite: OrganisationInvite) {
    const memberName = invite.userName || invite.userEmail
    if (!window.confirm(`Remove ${memberName} from your institute? They will lose access to private tests and assignments.`)) return
    setRemoving(invite.id)
    setMessage('')
    try {
      if (!user) return
      const response = await authenticatedFetch(user, `/api/memberships?organizationId=${invite.organisationId}&userId=${encodeURIComponent(invite.userId)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to remove member.')
      setInvites(current => current.filter(item => item.id !== invite.id))
      if (openedUser?.uid === invite.userId) setOpenedUser(null)
      if (managingStudent?.membership.id === invite.id) setManagingStudent(null)
      setMessage(`${memberName} was removed from your institute.`)
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : 'Unable to remove member.'
      setMessage(detail)
      setManagementMessage(detail)
    } finally {
      setRemoving('')
    }
  }
  async function changeMemberRole(invite: OrganisationInvite, nextRole: MemberRole) {
    if (!user) return
    const action = nextRole === 'teacher' ? 'promote this student to teacher' : 'demote this teacher to student'
    if (!window.confirm(`Are you sure you want to ${action}?`)) return
    setChangingRole(invite.id)
    setMessage('')
    try {
      const response = await authenticatedFetch(user, '/api/memberships', {
        method: 'PATCH',
        body: JSON.stringify({ organizationId: invite.organisationId, userId: invite.userId, role: nextRole }),
      })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Unable to update the institute role.')
      setInvites(current => current.map(item => item.id === invite.id ? { ...item, memberRole: nextRole } : item))
      setManagingStudent(null)
      setMessage(nextRole === 'teacher' ? `${invite.userName || invite.userEmail} is now a teacher.` : `${invite.userName || invite.userEmail} is now a student.`)
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : 'Unable to update the institute role.'
      setMessage(detail)
      setManagementMessage(detail)
    } finally {
      setChangingRole('')
    }
  }

  async function saveStudentNotificationEmails() {
    if (!user || !managingStudent) return
    const notificationEmails = [...new Set(notificationEmailDraft
      .split(/\r?\n|,|;/)
      .map(item => item.trim().toLowerCase())
      .filter(Boolean))]
    setSavingNotificationEmails(true)
    setManagementMessage('')
    try {
      const response = await authenticatedFetch(user, '/api/memberships', {
        method: 'PATCH',
        body: JSON.stringify({
          organizationId: managingStudent.membership.organisationId,
          userId: managingStudent.membership.userId,
          notificationEmails,
        }),
      })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Unable to save notification emails.')
      setInvites(current => current.map(item => item.id === managingStudent.membership.id
        ? { ...item, notificationEmails }
        : item))
      setManagingStudent(current => current ? {
        ...current,
        membership: { ...current.membership, notificationEmails },
      } : current)
      setNotificationEmailDraft(notificationEmails.join('\n'))
      setManagementMessage('Notification emails saved.')
      setMessage(`Notification emails updated for ${managingStudent.account.name || managingStudent.account.email}.`)
    } catch (reason) {
      setManagementMessage(reason instanceof Error ? reason.message : 'Unable to save notification emails.')
    } finally {
      setSavingNotificationEmails(false)
    }
  }

  if (!allowed) return <section><h1 className="text-3xl font-black">Access denied</h1><p className="mt-3 text-slate-600">Only institute accounts and administrators can manage members.</p></section>
  return <section className="mx-auto max-w-6xl"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-bold tracking-widest text-indigo-600">INSTITUTE</p><h1 className="mt-1 text-4xl font-black">Manage students</h1><p className="mt-3 text-slate-600">Invite registered students and review joined members&apos; performance.</p></div><button type="button" disabled={!organizationId} onClick={() => { setInviteOpen(value => !value); setTerm('') }} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">{inviteOpen ? 'Close invite search' : 'Invite student'}</button></div>
    {profile?.role === 'admin' && <label className="mt-6 block max-w-md text-sm font-black text-slate-800">Institute<select value={adminOrganizationId} onChange={event => { setAdminOrganizationId(event.target.value); setInvites([]); setAccounts([]); setSubmissions([]); setGroups([]); setAttendance({}); setInviteOpen(false); setTerm(''); setStudentFilter(''); setMessage(''); setManagingStudent(null); setRequestsPage(1); setJoinedPage(1); setTeachersPage(1); setInvitesPage(1) }} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"><option value="">Select an institute</option>{organisations.map(organisation => <option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}</select></label>}
    {inviteOpen && <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><label className="block text-sm font-bold text-slate-800">Search registered students<div className="relative mt-2"><SearchIcon /><input value={term} onChange={event => setTerm(event.target.value)} type="search" autoFocus placeholder="Start typing a name or email" className="w-full rounded-xl border border-slate-300 py-3 pl-11 pr-4 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></div></label>{normalizedTerm && <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">{suggestions.map(account => { const existing = invites.find(invite => invite.userId === account.uid); return <div key={account.uid} className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-0"><UserIdentity account={account} />{existing ? <span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${existing.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' : existing.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{existing.status}</span> : <button type="button" disabled={sending === account.uid} onClick={() => void invite(account)} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{sending === account.uid ? 'Sending…' : 'Invite'}</button>}</div> })}{!suggestions.length && <p className="p-5 text-sm text-slate-500">No registered students match that name or email.</p>}</div>}</section>}
    {message && <p className="mt-5 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-800">{message}</p>}
    <section id="join-requests" className="mt-8 scroll-mt-24"><div className="flex items-end justify-between gap-4"><div><h2 className="text-2xl font-black">Join requests</h2><p className="mt-1 text-sm text-slate-500">Students who have requested access to your institute.</p></div><span className="text-sm font-bold text-slate-400">{joinRequests.length} pending</span></div><div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">{visibleRequests.items.map(invite => { const account = accounts.find(item => item.uid === invite.userId) || { uid: invite.userId, name: invite.userName || invite.userEmail, email: invite.userEmail, role: 'user' as const }; return <div key={invite.id} className="flex flex-col justify-between gap-3 border-b border-slate-100 px-5 py-4 last:border-0 sm:flex-row sm:items-center"><UserIdentity account={account} /><div className="flex gap-2"><button type="button" disabled={responding === invite.id} onClick={() => void respondToRequest(invite, 'declined')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold disabled:opacity-50">Decline</button><button type="button" disabled={responding === invite.id} onClick={() => void respondToRequest(invite, 'accepted')} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{responding === invite.id ? 'Updating…' : 'Approve'}</button></div></div> })}{!joinRequests.length && <p className="p-5 text-sm text-slate-500">No pending join requests.</p>}<Pagination page={visibleRequests.page} totalItems={joinRequests.length} onPageChange={setRequestsPage} itemLabel="requests" /></div></section>
    <section className="mt-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><h2 className="text-2xl font-black">Joined students</h2><p className="mt-1 text-sm text-slate-500">Attempts, scores and attendance for active student members.</p></div>
        <span className="text-sm font-bold text-slate-400">{normalizedStudentFilter ? `${filteredJoined.length} of ${joined.length}` : joined.length} students</span>
      </div>
      <label className="mt-5 block text-sm font-bold text-slate-800">Search joined students
        <div className="relative mt-2 max-w-xl"><SearchIcon /><input value={studentFilter} onChange={event => { setStudentFilter(event.target.value); setJoinedPage(1) }} type="search" placeholder="Search by name or email" className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-4 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></div>
      </label>
      <div className="mt-5 space-y-4">
        {visibleJoined.items.map((account, index) => {
          const membership = studentMemberships.find(invite => invite.userId === account.uid)
          return <JoinedUserCard key={account.uid} account={account} rank={visibleJoined.startIndex + index + 1} submissions={submissions.filter(item => item.userId === account.uid)} attendance={attendance[account.uid]} groups={groups.filter(group => group.members.some(member => member.userId === account.uid))} open={() => setOpenedUser(account)} manage={() => { if (!membership) return; setManagingStudent({ account, membership }); setNotificationEmailDraft(membership.notificationEmails.join('\n')); setManagementMessage('') }} />
        })}
        {!joined.length && <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-8 text-center text-slate-500">No students have joined yet.</p>}
        {Boolean(joined.length) && !filteredJoined.length && <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-8 text-center text-slate-500">No joined students match that name or email.</p>}
        <Pagination page={visibleJoined.page} totalItems={filteredJoined.length} onPageChange={setJoinedPage} itemLabel="students" className="rounded-xl border border-slate-200 bg-white" />
      </div>
    </section>
    <section className="mt-8"><div className="flex items-end justify-between gap-4"><div><h2 className="text-2xl font-black">Teachers</h2><p className="mt-1 text-sm text-slate-500">Assign teachers to classes from the timetable builder.</p></div><span className="text-sm font-bold text-slate-400">{teachers.length} teachers</span></div><div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">{visibleTeachers.items.map(account => { const membership = teacherMemberships.find(invite => invite.userId === account.uid); return <div key={account.uid} className="flex flex-col justify-between gap-4 border-b border-slate-100 px-5 py-4 last:border-0 sm:flex-row sm:items-center"><UserIdentity account={account} /><div className="flex gap-4"><button type="button" disabled={!membership || changingRole === membership.id} onClick={() => { if (membership) void changeMemberRole(membership, 'student') }} className="text-sm font-bold text-indigo-700 hover:underline disabled:opacity-50">{membership && changingRole === membership.id ? 'Updating…' : 'Demote to student'}</button>{membership && <button type="button" disabled={removing === membership.id} onClick={() => void removeMember(membership)} className="text-sm font-bold text-rose-600 hover:underline disabled:opacity-50">Remove</button>}</div></div> })}{!teachers.length && <p className="p-6 text-sm text-slate-500">No teachers yet. Promote a joined student to create one.</p>}<Pagination page={visibleTeachers.page} totalItems={teachers.length} onPageChange={setTeachersPage} itemLabel="teachers" /></div></section>
    <section className="mt-8"><h2 className="text-xl font-black">Pending invitations <span className="text-slate-400">({pending.length})</span></h2><div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">{visibleInvites.items.map(invite => <div key={invite.id} className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4 last:border-0"><p className="min-w-0 truncate font-semibold">{invite.userEmail}</p><button type="button" onClick={() => void withdraw(invite)} className="text-sm font-bold text-rose-600">Withdraw</button></div>)}{!pending.length && <p className="p-5 text-sm text-slate-500">No pending invitations.</p>}<Pagination page={visibleInvites.page} totalItems={pending.length} onPageChange={setInvitesPage} itemLabel="invitations" /></div></section>
    {openedUser && <OrganisationUserDashboardModal account={{ uid: openedUser.uid, name: openedUser.name || openedUser.email, email: openedUser.email }} submissions={submissions} tests={tests} goals={groups.filter(group => group.members.some(member => member.userId === openedUser.uid) && (group.targetExamId || group.targetExamName)).map(group => ({ id: group.id, name: group.name, examId: group.targetExamId, examName: group.targetExamName }))} close={() => setOpenedUser(null)} />}
    {managingStudent && <StudentInfoModal account={managingStudent.account} membership={managingStudent.membership} notificationEmails={notificationEmailDraft} setNotificationEmails={setNotificationEmailDraft} message={managementMessage} saving={savingNotificationEmails} changingRole={changingRole === managingStudent.membership.id} removing={removing === managingStudent.membership.id} close={() => setManagingStudent(null)} save={() => void saveStudentNotificationEmails()} promote={() => void changeMemberRole(managingStudent.membership, 'teacher')} remove={() => void removeMember(managingStudent.membership)} />}
  </section>
}

function JoinedUserCard({ account, rank, submissions, attendance, groups, open, manage }: { account: UserProfile; rank: number; submissions: Submission[]; attendance?: { present: number; absent: number }; groups: Group[]; open: () => void; manage: () => void }) {
  const attempts = submissions.slice().sort((a, b) => (typeof b.submittedAt === 'string' ? new Date(b.submittedAt).getTime() : b.submittedAt?.toDate().getTime() || 0) - (typeof a.submittedAt === 'string' ? new Date(a.submittedAt).getTime() : a.submittedAt?.toDate().getTime() || 0))
  const average = attempts.length ? attempts.reduce((sum, item) => sum + score(item), 0) / attempts.length : 0
  const best = attempts.slice().sort((a, b) => score(b) - score(a))[0]
  const attendanceTotal = (attendance?.present || 0) + (attendance?.absent || 0)
  const attendancePercent = attendanceTotal ? (attendance?.present || 0) / attendanceTotal * 100 : 0
  return <article className="relative rounded-2xl border border-slate-200 bg-white p-5 pr-16 shadow-sm shadow-slate-200/60 sm:p-6 sm:pr-16"><button type="button" onClick={manage} aria-label={`Manage ${account.name || account.email}`} title="Student information and options" className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-300"><InfoIcon /></button><div className="grid gap-5 xl:grid-cols-[minmax(11rem,.8fr)_minmax(18rem,1.4fr)_minmax(22rem,1.4fr)] xl:items-center xl:gap-0"><div className="flex min-w-0 gap-4 xl:pr-5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-violet-50 text-lg font-bold text-violet-600">{rank}</span><div className="min-w-0"><p className="truncate text-lg font-bold tracking-tight text-slate-900">{account.name || account.email}</p><button type="button" onClick={open} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 hover:text-indigo-900 hover:underline"><span aria-hidden="true">↗</span>Open more details</button></div></div><dl className="grid min-w-0 gap-2 border-y border-slate-100 py-4 text-sm xl:border-y-0 xl:border-x xl:px-5 xl:py-0"><InfoRow icon={<EmailIcon />} value={account.email} /><InfoRow icon={<TestIcon />} value={best?.testTitle || 'No tests completed'} /><InfoRow icon={<GroupIcon />} value={groups.map(group => group.name).join(', ') || 'No exam batch'} /></dl><div className="grid grid-cols-4 justify-items-start gap-3 xl:px-5"><ScoreRing value={attempts.length ? 100 : 0} display={String(attempts.length)} label="Attempts" color="var(--color-indigo-500)" /><ScoreRing value={Math.round(average)} display={attempts.length ? `${Math.round(average)}%` : '—'} label="Average" color="var(--color-violet-600)" /><ScoreRing value={best ? Math.round(score(best)) : 0} display={best ? `${Math.round(score(best))}%` : '—'} label="Best" color="#10b981" /><ScoreRing value={attendancePercent} display={attendanceTotal ? `${Math.round(attendancePercent)}%` : '—'} label="Attendance" color="#0d9488" /></div></div></article>
}

function StudentInfoModal({ account, membership, notificationEmails, setNotificationEmails, message, saving, changingRole, removing, close, save, promote, remove }: { account: UserProfile; membership: OrganisationInvite; notificationEmails: string; setNotificationEmails: (value: string) => void; message: string; saving: boolean; changingRole: boolean; removing: boolean; close: () => void; save: () => void; promote: () => void; remove: () => void }) {
  const busy = saving || changingRole || removing
  return <div role="dialog" aria-modal="true" aria-labelledby="student-info-title" className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/55 p-4" onMouseDown={close}><section className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()}><header className="flex items-start justify-between gap-4 border-b border-slate-200 p-6"><div><p className="text-xs font-black tracking-widest text-indigo-600">STUDENT INFORMATION</p><h2 id="student-info-title" className="mt-2 text-2xl font-black text-slate-950">{account.name || account.email}</h2><p className="mt-1 text-sm text-slate-500">{account.email}</p></div><button type="button" disabled={busy} onClick={close} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold disabled:opacity-50">Close</button></header><div className="space-y-6 p-6">{message && <p role="status" className={`rounded-xl p-3 text-sm font-semibold ${message.includes('saved') ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{message}</p>}<div><label htmlFor="student-notification-emails" className="text-sm font-black text-slate-800">Notification emails</label><textarea id="student-notification-emails" rows={4} value={notificationEmails} onChange={event => setNotificationEmails(event.target.value)} placeholder={'One email per line\nparent@example.com'} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /><p className="mt-2 text-xs leading-5 text-slate-500">Add up to 20 addresses. When this student&apos;s assignment results are sent, each address receives the same private result email.</p><button type="button" disabled={busy} onClick={save} className="mt-3 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save notification emails'}</button></div><div className="border-t border-slate-200 pt-5"><h3 className="text-sm font-black text-slate-900">Student options</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><button type="button" disabled={busy} onClick={promote} className="rounded-xl border border-indigo-300 px-4 py-3 text-sm font-black text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">{changingRole ? 'Promoting…' : 'Promote to teacher'}</button><button type="button" disabled={busy} onClick={remove} className="rounded-xl border border-rose-300 px-4 py-3 text-sm font-black text-rose-700 hover:bg-rose-50 disabled:opacity-50">{removing ? 'Removing…' : 'Remove student'}</button></div></div><p className="text-xs text-slate-400">Institute membership: {membership.status}</p></div></section></div>
}

function ScoreRing({ value, display, label, color }: { value: number; display: string; label: string; color: string }) { const radius = 39; const circumference = 2 * Math.PI * radius; const offset = circumference * (1 - Math.max(0, Math.min(100, value)) / 100); return <div className="grid justify-items-center gap-2"><div className="relative grid h-20 w-20 place-items-center"><svg aria-hidden="true" viewBox="0 0 96 96" className="absolute inset-0 h-full w-full -rotate-90"><circle cx="48" cy="48" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="8" /><circle cx="48" cy="48" r={radius} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} /></svg><p className="relative text-base font-black leading-none text-slate-900">{display}</p></div><p className="text-xs font-semibold text-slate-500">{label}</p></div> }
function UserIdentity({ account }: { account: UserProfile }) { return <div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-indigo-50 font-black text-indigo-600">{(account.name || account.email).slice(0, 1).toUpperCase()}</span><div className="min-w-0"><p className="truncate font-bold text-slate-900">{account.name || account.email}</p><p className="mt-0.5 truncate text-sm text-slate-500">{account.email}</p></div></div> }
function InfoRow({ icon, value }: { icon: React.ReactNode; value: string }) { return <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-2"><dt className="text-slate-500">{icon}</dt><dd className="truncate text-slate-600">{value}</dd></div> }
function SearchIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg> }
function EmailIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg> }
function TestIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></svg> }
function GroupIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg> }
function InfoIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg> }
