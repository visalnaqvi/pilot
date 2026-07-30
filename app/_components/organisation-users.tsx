'use client'

import { useEffect, useMemo, useState } from 'react'
import { collection, deleteDoc, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth, type UserProfile } from './auth-context'
import { OrganisationUserDashboardModal } from './exam-dashboard'
import { paginate, Pagination } from './pagination'
import type { MockTest, Submission } from './test-types'
import { memberRole, type MemberRole } from '@/lib/membership'

type OrganisationInvite = { id: string; organisationId: string; organisationName?: string; organisationEmail: string; userId: string; userName?: string; userEmail: string; initiatedBy?: 'organisation' | 'user'; status: 'pending' | 'accepted' | 'declined'; memberRole?: MemberRole }
type Group = { id: string; name: string; targetExamId?: string; targetExamName?: string; members: { userId: string }[] }
type AttendanceSessionSummary = { status: string; roster: { userId: string; status: string }[] }

const score = (item: Submission) => item.totalMarks ? item.score / item.totalMarks * 100 : 0

export function OrganisationUsers() {
  const { user, profile } = useAuth()
  const allowed = profile?.role === 'organisation'
  const [inviteOpen, setInviteOpen] = useState(false)
  const [term, setTerm] = useState('')
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
  const [attendance, setAttendance] = useState<Record<string, { present: number; absent: number }>>({})
  const [requestsPage, setRequestsPage] = useState(1)
  const [joinedPage, setJoinedPage] = useState(1)
  const [teachersPage, setTeachersPage] = useState(1)
  const [invitesPage, setInvitesPage] = useState(1)

  useEffect(() => { if (!user || !allowed) return; return onSnapshot(query(collection(db, 'organisationInvites'), where('organisationId', '==', user.uid)), snapshot => setInvites(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as OrganisationInvite)), reason => setMessage(`Could not load invitations: ${reason.message}`)) }, [allowed, user])
  useEffect(() => { if (!user || !allowed) return; return onSnapshot(collection(db, 'users'), snapshot => setAccounts(snapshot.docs.map(item => ({ uid: item.id, ...item.data() }) as UserProfile).filter(account => account.role === 'user')), reason => setMessage(`Could not load students: ${reason.message}`)) }, [allowed, user])
  useEffect(() => { if (!user || !allowed) return; return onSnapshot(query(collection(db, 'submissions'), where('organisationIds', 'array-contains', user.uid)), snapshot => setSubmissions(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as Submission).filter(item => item.gradingStatus !== 'pending')), reason => setMessage(`Could not load scores: ${reason.message}`)) }, [allowed, user])
  useEffect(() => {
    if (!user || !allowed) return
    let active = true
    void user.getIdToken().then(token => fetch('/api/attendance', { headers: { authorization: `Bearer ${token}` } }))
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Unable to load attendance summaries.')))
      .then((payload: { sessions?: AttendanceSessionSummary[] }) => {
        if (!active) return
        const values: Record<string, { present: number; absent: number }> = {}
        ;(payload.sessions || []).filter(session => session.status === 'submitted').forEach(session => {
          session.roster.forEach(record => {
            const current = values[record.userId] || { present: 0, absent: 0 }
            if (record.status === 'present') current.present += 1
            if (record.status === 'absent') current.absent += 1
            values[record.userId] = current
          })
        })
        setAttendance(values)
      }).catch(() => undefined)
    return () => { active = false }
  }, [allowed, user])
  useEffect(() => {
    if (!user || !allowed) return
    return onSnapshot(query(collection(db, 'organisationGroups'), where('organisationId', '==', user.uid)), async snapshot => {
      try {
        const loaded = await Promise.all(snapshot.docs.map(async item => ({ id: item.id, name: item.data().name as string, targetExamId: item.data().targetExamId as string | undefined, targetExamName: item.data().targetExamName as string | undefined, members: (await getDocs(collection(item.ref, 'members'))).docs.map(member => ({ userId: member.data().userId as string })) })))
        setGroups(loaded)
      } catch { setMessage('Could not load student batches.') }
    })
  }, [allowed, user])

  const tests = useMemo(() => [...new Map(submissions.map(item => [item.testId, { id: item.testId, title: item.testTitle, exam: item.testExam, examId: item.testExamId, category: item.testCategory, description: '', durationMinutes: 0, createdBy: '', visibility: 'public' as const } satisfies MockTest])).values()], [submissions])
  const pending = invites.filter(invite => invite.status === 'pending' && invite.initiatedBy !== 'user')
  const joinRequests = invites.filter(invite => invite.status === 'pending' && invite.initiatedBy === 'user')
  const studentMemberships = invites.filter(invite => invite.status === 'accepted' && memberRole(invite.memberRole) === 'student')
  const teacherMemberships = invites.filter(invite => invite.status === 'accepted' && memberRole(invite.memberRole) === 'teacher')
  const joined = studentMemberships.map(invite => accounts.find(account => account.uid === invite.userId) || { uid: invite.userId, email: invite.userEmail, name: invite.userEmail, role: 'user' as const })
  const teachers = teacherMemberships.map(invite => accounts.find(account => account.uid === invite.userId) || { uid: invite.userId, email: invite.userEmail, name: invite.userEmail, role: 'user' as const })
  const visibleRequests = paginate(joinRequests, requestsPage)
  const visibleJoined = paginate(joined, joinedPage)
  const visibleTeachers = paginate(teachers, teachersPage)
  const visibleInvites = paginate(pending, invitesPage)
  const normalizedTerm = term.trim().toLowerCase()
  const suggestions = normalizedTerm ? accounts.filter(account => `${account.name || ''} ${account.email}`.toLowerCase().includes(normalizedTerm)).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).slice(0, 8) : []

  async function invite(account: UserProfile) {
    if (!user || !profile) return
    setSending(account.uid); setMessage('')
    try {
      await setDoc(doc(db, 'organisationInvites', `${user.uid}_${account.uid}`), { organisationId: user.uid, organisationName: profile.name || profile.email, organisationEmail: profile.email, userId: account.uid, userName: account.name || account.email, userEmail: account.email, initiatedBy: 'organisation', status: 'pending', memberRole: 'student', createdAt: serverTimestamp() })
      setMessage(`Invitation sent to ${account.email}.`); setTerm('')
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to send invitation.') } finally { setSending('') }
  }
  async function withdraw(invite: OrganisationInvite) { try { await deleteDoc(doc(db, 'organisationInvites', invite.id)); setMessage(`Invitation to ${invite.userEmail} withdrawn.`) } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to withdraw invitation.') } }
  async function respondToRequest(invite: OrganisationInvite, status: 'accepted' | 'declined') {
    setResponding(invite.id)
    setMessage('')
    try {
      await updateDoc(doc(db, 'organisationInvites', invite.id), { status, respondedAt: serverTimestamp() })
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
      await deleteDoc(doc(db, 'organisationInvites', invite.id))
      if (openedUser?.uid === invite.userId) setOpenedUser(null)
      setMessage(`${memberName} was removed from your institute.`)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to remove member.')
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
      const response = await fetch(`/api/organisation-members/${encodeURIComponent(invite.userId)}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${await user.getIdToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ memberRole: nextRole }),
      })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Unable to update the institute role.')
      setMessage(nextRole === 'teacher' ? `${invite.userName || invite.userEmail} is now a teacher.` : `${invite.userName || invite.userEmail} is now a student.`)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to update the institute role.')
    } finally {
      setChangingRole('')
    }
  }

  if (!allowed) return <section><h1 className="text-3xl font-black">Access denied</h1><p className="mt-3 text-slate-600">Only institute accounts can manage members.</p></section>
  return <section className="mx-auto max-w-6xl"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-bold tracking-widest text-indigo-600">INSTITUTE</p><h1 className="mt-1 text-4xl font-black">Manage students</h1><p className="mt-3 text-slate-600">Invite registered students and review joined members&apos; performance.</p></div><button type="button" onClick={() => { setInviteOpen(value => !value); setTerm('') }} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700">{inviteOpen ? 'Close invite search' : 'Invite student'}</button></div>
    {inviteOpen && <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><label className="block text-sm font-bold text-slate-800">Search registered students<div className="relative mt-2"><SearchIcon /><input value={term} onChange={event => setTerm(event.target.value)} type="search" autoFocus placeholder="Start typing a name or email" className="w-full rounded-xl border border-slate-300 py-3 pl-11 pr-4 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></div></label>{normalizedTerm && <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">{suggestions.map(account => { const existing = invites.find(invite => invite.userId === account.uid); return <div key={account.uid} className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-0"><UserIdentity account={account} />{existing ? <span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${existing.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' : existing.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{existing.status}</span> : <button type="button" disabled={sending === account.uid} onClick={() => void invite(account)} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{sending === account.uid ? 'Sending…' : 'Invite'}</button>}</div> })}{!suggestions.length && <p className="p-5 text-sm text-slate-500">No registered students match that name or email.</p>}</div>}</section>}
    {message && <p className="mt-5 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-800">{message}</p>}
    <section id="join-requests" className="mt-8 scroll-mt-24"><div className="flex items-end justify-between gap-4"><div><h2 className="text-2xl font-black">Join requests</h2><p className="mt-1 text-sm text-slate-500">Students who have requested access to your institute.</p></div><span className="text-sm font-bold text-slate-400">{joinRequests.length} pending</span></div><div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">{visibleRequests.items.map(invite => { const account = accounts.find(item => item.uid === invite.userId) || { uid: invite.userId, name: invite.userName || invite.userEmail, email: invite.userEmail, role: 'user' as const }; return <div key={invite.id} className="flex flex-col justify-between gap-3 border-b border-slate-100 px-5 py-4 last:border-0 sm:flex-row sm:items-center"><UserIdentity account={account} /><div className="flex gap-2"><button type="button" disabled={responding === invite.id} onClick={() => void respondToRequest(invite, 'declined')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold disabled:opacity-50">Decline</button><button type="button" disabled={responding === invite.id} onClick={() => void respondToRequest(invite, 'accepted')} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{responding === invite.id ? 'Updating…' : 'Approve'}</button></div></div> })}{!joinRequests.length && <p className="p-5 text-sm text-slate-500">No pending join requests.</p>}<Pagination page={visibleRequests.page} totalItems={joinRequests.length} onPageChange={setRequestsPage} itemLabel="requests" /></div></section>
    <section className="mt-8"><div className="flex items-end justify-between gap-4"><div><h2 className="text-2xl font-black">Joined students</h2><p className="mt-1 text-sm text-slate-500">Attempts, scores and attendance for active student members.</p></div><span className="text-sm font-bold text-slate-400">{joined.length} students</span></div><div className="mt-5 space-y-4">{visibleJoined.items.map((account, index) => { const membership = studentMemberships.find(invite => invite.userId === account.uid); return <div key={account.uid} className="space-y-2"><JoinedUserCard account={account} rank={visibleJoined.startIndex + index + 1} submissions={submissions.filter(item => item.userId === account.uid)} attendance={attendance[account.uid]} groups={groups.filter(group => group.members.some(member => member.userId === account.uid))} open={() => setOpenedUser(account)} /><div className="flex justify-end gap-4 px-2"><button type="button" disabled={!membership || changingRole === membership.id} onClick={() => { if (membership) void changeMemberRole(membership, 'teacher') }} className="text-sm font-semibold text-indigo-700 hover:underline disabled:opacity-50">{membership && changingRole === membership.id ? 'Updating…' : 'Promote to teacher'}</button><button type="button" disabled={!membership || removing === membership.id} onClick={() => { if (membership) void removeMember(membership) }} className="text-sm font-semibold text-rose-600 hover:underline disabled:opacity-50">{membership && removing === membership.id ? 'Removing…' : 'Remove student'}</button></div></div> })}{!joined.length && <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-8 text-center text-slate-500">No students have joined yet.</p>}<Pagination page={visibleJoined.page} totalItems={joined.length} onPageChange={setJoinedPage} itemLabel="students" className="rounded-xl border border-slate-200 bg-white" /></div></section>
    <section className="mt-8"><div className="flex items-end justify-between gap-4"><div><h2 className="text-2xl font-black">Teachers</h2><p className="mt-1 text-sm text-slate-500">Assign teachers to classes from the timetable builder.</p></div><span className="text-sm font-bold text-slate-400">{teachers.length} teachers</span></div><div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">{visibleTeachers.items.map(account => { const membership = teacherMemberships.find(invite => invite.userId === account.uid); return <div key={account.uid} className="flex flex-col justify-between gap-4 border-b border-slate-100 px-5 py-4 last:border-0 sm:flex-row sm:items-center"><UserIdentity account={account} /><div className="flex gap-4"><button type="button" disabled={!membership || changingRole === membership.id} onClick={() => { if (membership) void changeMemberRole(membership, 'student') }} className="text-sm font-bold text-indigo-700 hover:underline disabled:opacity-50">{membership && changingRole === membership.id ? 'Updating…' : 'Demote to student'}</button>{membership && <button type="button" disabled={removing === membership.id} onClick={() => void removeMember(membership)} className="text-sm font-bold text-rose-600 hover:underline disabled:opacity-50">Remove</button>}</div></div> })}{!teachers.length && <p className="p-6 text-sm text-slate-500">No teachers yet. Promote a joined student to create one.</p>}<Pagination page={visibleTeachers.page} totalItems={teachers.length} onPageChange={setTeachersPage} itemLabel="teachers" /></div></section>
    <section className="mt-8"><h2 className="text-xl font-black">Pending invitations <span className="text-slate-400">({pending.length})</span></h2><div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">{visibleInvites.items.map(invite => <div key={invite.id} className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4 last:border-0"><p className="min-w-0 truncate font-semibold">{invite.userEmail}</p><button type="button" onClick={() => void withdraw(invite)} className="text-sm font-bold text-rose-600">Withdraw</button></div>)}{!pending.length && <p className="p-5 text-sm text-slate-500">No pending invitations.</p>}<Pagination page={visibleInvites.page} totalItems={pending.length} onPageChange={setInvitesPage} itemLabel="invitations" /></div></section>
    {openedUser && <OrganisationUserDashboardModal account={{ uid: openedUser.uid, name: openedUser.name || openedUser.email, email: openedUser.email }} submissions={submissions} tests={tests} goals={groups.filter(group => group.members.some(member => member.userId === openedUser.uid) && (group.targetExamId || group.targetExamName)).map(group => ({ id: group.id, name: group.name, examId: group.targetExamId, examName: group.targetExamName }))} close={() => setOpenedUser(null)} />}
  </section>
}

function JoinedUserCard({ account, rank, submissions, attendance, groups, open }: { account: UserProfile; rank: number; submissions: Submission[]; attendance?: { present: number; absent: number }; groups: Group[]; open: () => void }) {
  const attempts = submissions.slice().sort((a, b) => (b.submittedAt?.toDate?.().getTime() || 0) - (a.submittedAt?.toDate?.().getTime() || 0))
  const average = attempts.length ? attempts.reduce((sum, item) => sum + score(item), 0) / attempts.length : 0
  const best = attempts.slice().sort((a, b) => score(b) - score(a))[0]
  const attendanceTotal = (attendance?.present || 0) + (attendance?.absent || 0)
  const attendancePercent = attendanceTotal ? (attendance?.present || 0) / attendanceTotal * 100 : 0
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60 sm:p-6"><div className="grid gap-5 xl:grid-cols-[minmax(11rem,.8fr)_minmax(18rem,1.4fr)_minmax(22rem,1.4fr)] xl:items-center xl:gap-0"><div className="flex min-w-0 gap-4 xl:pr-5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-violet-50 text-lg font-bold text-violet-600">{rank}</span><div className="min-w-0"><p className="truncate text-lg font-bold tracking-tight text-slate-900">{account.name || account.email}</p><button type="button" onClick={open} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 hover:text-indigo-900 hover:underline"><span aria-hidden="true">↗</span>Open more details</button></div></div><dl className="grid min-w-0 gap-2 border-y border-slate-100 py-4 text-sm xl:border-y-0 xl:border-x xl:px-5 xl:py-0"><InfoRow icon={<EmailIcon />} value={account.email} /><InfoRow icon={<TestIcon />} value={best?.testTitle || 'No tests completed'} /><InfoRow icon={<GroupIcon />} value={groups.map(group => group.name).join(', ') || 'No exam batch'} /></dl><div className="grid grid-cols-4 justify-items-start gap-3 xl:px-5"><ScoreRing value={attempts.length ? 100 : 0} display={String(attempts.length)} label="Attempts" color="#6366f1" /><ScoreRing value={Math.round(average)} display={attempts.length ? `${Math.round(average)}%` : '—'} label="Average" color="#7657f6" /><ScoreRing value={best ? Math.round(score(best)) : 0} display={best ? `${Math.round(score(best))}%` : '—'} label="Best" color="#10b981" /><ScoreRing value={attendancePercent} display={attendanceTotal ? `${Math.round(attendancePercent)}%` : '—'} label="Attendance" color="#0d9488" /></div></div></article>
}

function ScoreRing({ value, display, label, color }: { value: number; display: string; label: string; color: string }) { const radius = 39; const circumference = 2 * Math.PI * radius; const offset = circumference * (1 - Math.max(0, Math.min(100, value)) / 100); return <div className="grid justify-items-center gap-2"><div className="relative grid h-20 w-20 place-items-center"><svg aria-hidden="true" viewBox="0 0 96 96" className="absolute inset-0 h-full w-full -rotate-90"><circle cx="48" cy="48" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="8" /><circle cx="48" cy="48" r={radius} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} /></svg><p className="relative text-base font-black leading-none text-slate-900">{display}</p></div><p className="text-xs font-semibold text-slate-500">{label}</p></div> }
function UserIdentity({ account }: { account: UserProfile }) { return <div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-indigo-50 font-black text-indigo-600">{(account.name || account.email).slice(0, 1).toUpperCase()}</span><div className="min-w-0"><p className="truncate font-bold text-slate-900">{account.name || account.email}</p><p className="mt-0.5 truncate text-sm text-slate-500">{account.email}</p></div></div> }
function InfoRow({ icon, value }: { icon: React.ReactNode; value: string }) { return <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-2"><dt className="text-slate-500">{icon}</dt><dd className="truncate text-slate-600">{value}</dd></div> }
function SearchIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg> }
function EmailIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg> }
function TestIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></svg> }
function GroupIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg> }
