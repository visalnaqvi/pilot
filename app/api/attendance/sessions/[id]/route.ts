import { and, eq } from 'drizzle-orm'
import { after } from 'next/server'
import { z } from 'zod'
import {
  attendanceMarks,
  attendanceRevisions,
  attendanceSessions,
  emailJobs,
  organizations,
  timetableEntries,
  timetables,
  timetableVersions,
  users,
} from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { appBaseUrl } from '@/lib/app-url'
import { attendanceAbsenceEmailJobKey } from '@/lib/attendance-email-plan'
import { getBrandConfig } from '@/lib/branding'
import { database } from '@/lib/db'
import { isEmailConfigured } from '@/lib/email'
import { processEmailJob } from '@/lib/email-worker'
import { canManageOrganization } from '@/lib/services/access'

export const runtime = 'nodejs'
export const maxDuration = 60

function queueImmediateAbsenceEmails(jobIds: string[]) {
  const baseUrl = appBaseUrl()
  const brand = getBrandConfig(new URL(baseUrl).hostname)
  if (!jobIds.length || !isEmailConfigured(brand)) return
  after(async () => {
    const results = await Promise.allSettled(jobIds.map(jobId => processEmailJob(jobId)))
    for (const result of results) {
      if (result.status === 'rejected') console.error('Immediate attendance email processing failed.', result.reason)
    }
  })
}

const updateSchema = z.object({
  status: z.enum(['draft', 'submitted', 'cancelled']),
  cancellationReason: z.string().trim().max(2_000).nullable().optional(),
  marks: z.array(z.object({
    userId: z.string().min(1),
    mark: z.enum(['present', 'absent', 'unmarked']),
  })).max(2_000),
})

async function load(id: string) {
  const db = database()
  const session = (await db.select().from(attendanceSessions).where(eq(attendanceSessions.id, id)).limit(1))[0]
  if (!session) return null
  const marks = await db.select({
    userId: attendanceMarks.userId,
    status: attendanceMarks.mark,
    mark: attendanceMarks.mark,
    userName: users.name,
    userEmail: users.email,
  }).from(attendanceMarks).innerJoin(users, eq(users.id, attendanceMarks.userId))
    .where(eq(attendanceMarks.sessionId, id))
  const entry = (await db.select().from(timetableEntries).where(eq(timetableEntries.id, session.timetableEntryId)).limit(1))[0]
  const version = (await db.select().from(timetableVersions).where(eq(timetableVersions.id, session.timetableVersionId)).limit(1))[0]
  const timetable = version ? (await db.select().from(timetables).where(eq(timetables.id, version.timetableId)).limit(1))[0] : null
  const organization = (await db.select().from(organizations).where(eq(organizations.id, session.organizationId)).limit(1))[0]
  const presentCount = marks.filter(mark => mark.mark === 'present').length
  const absentCount = marks.filter(mark => mark.mark === 'absent').length
  return {
    ...session,
    organisationId: session.organizationId,
    organisationName: organization?.name || '',
    timetableId: timetable?.id || session.timetableVersionId,
    timetableName: timetable?.name || '',
    timetableRevision: version?.revision || 1,
    entryId: session.timetableEntryId,
    subject: entry?.subject || '',
    startTime: entry?.startTime || '',
    endTime: entry?.endTime || '',
    teacherUserId: entry?.teacherUserId || undefined,
    teacher: entry?.teacherLabel || undefined,
    timeZone: version?.timeZone || 'Asia/Kolkata',
    rosterUserIds: marks.map(mark => mark.userId),
    roster: marks,
    presentCount,
    absentCount,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    submittedAt: session.submittedAt?.toISOString() || null,
    cancelledAt: session.cancelledAt?.toISOString() || null,
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const { id } = await context.params
    const item = await load(id)
    if (!item) return Response.json({ error: 'Attendance session not found.' }, { status: 404 })
    const ownMark = item.roster.some(mark => mark.userId === auth.user.uid)
    const manager = await canManageOrganization(auth.user, item.organizationId)
    const assignedTeacher = item.teacherUserId === auth.user.uid
    if (!ownMark && !manager && !assignedTeacher) return Response.json({ error: 'Attendance access required.' }, { status: 403 })
    const canManage = manager || assignedTeacher
    const visibleItem = canManage ? item : {
      ...item,
      roster: item.roster.filter(mark => mark.userId === auth.user.uid),
      rosterUserIds: item.rosterUserIds.filter(userId => userId === auth.user.uid),
      presentCount: item.roster.some(mark => mark.userId === auth.user.uid && mark.mark === 'present') ? 1 : 0,
      absentCount: item.roster.some(mark => mark.userId === auth.user.uid && mark.mark === 'absent') ? 1 : 0,
    }
    const history = await database().select().from(attendanceRevisions).where(eq(attendanceRevisions.sessionId, id)).orderBy(attendanceRevisions.revision)
    return Response.json({
      session: visibleItem,
      item: visibleItem,
      canManage,
      history: canManage ? history.map(value => ({ ...value, createdAt: value.createdAt.toISOString() })) : [],
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load attendance session.')
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const { id } = await context.params
    const parsed = updateSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid attendance marks.', issues: parsed.error.issues }, { status: 400 })
    const current = await load(id)
    if (!current) return Response.json({ error: 'Attendance session not found.' }, { status: 404 })
    const manager = await canManageOrganization(auth.user, current.organizationId)
    const entry = (await database().select().from(timetableEntries).where(eq(timetableEntries.id, current.timetableEntryId)).limit(1))[0]
    if (!manager && entry?.teacherUserId !== auth.user.uid) return Response.json({ error: 'Teacher access required.' }, { status: 403 })
    if (parsed.data.status === 'submitted') {
      const expected = new Set(current.roster.map(mark => mark.userId))
      const submitted = new Set(parsed.data.marks.map(mark => mark.userId))
      const complete = expected.size > 0
        && expected.size === parsed.data.marks.length
        && expected.size === submitted.size
        && [...expected].every(userId => submitted.has(userId))
        && parsed.data.marks.every(mark => mark.mark !== 'unmarked')
      if (!complete) return Response.json({ error: 'Mark every student exactly once before submitting attendance.' }, { status: 400 })
    }
    const queuedEmailJobIds = await database().transaction(async tx => {
      const nextRevision = current.revision + 1
      await tx.insert(attendanceRevisions).values({
        sessionId: id,
        revision: nextRevision,
        snapshot: { status: parsed.data.status, marks: parsed.data.marks, cancellationReason: parsed.data.cancellationReason || null },
        actorUserId: auth.user.uid,
      })
      for (const mark of parsed.data.marks) {
        await tx.update(attendanceMarks).set({ mark: mark.mark, updatedAt: new Date() }).where(and(
          eq(attendanceMarks.sessionId, id),
          eq(attendanceMarks.userId, mark.userId),
        ))
      }
      await tx.update(attendanceSessions).set({
        status: parsed.data.status,
        revision: nextRevision,
        cancellationReason: parsed.data.cancellationReason || null,
        updatedBy: auth.user.uid,
        updatedAt: new Date(),
        submittedAt: parsed.data.status === 'submitted' ? new Date() : null,
        cancelledAt: parsed.data.status === 'cancelled' ? new Date() : null,
      }).where(eq(attendanceSessions.id, id))
      if (parsed.data.status !== 'submitted') return []
      const absentUserIds = parsed.data.marks
        .filter(mark => mark.mark === 'absent')
        .map(mark => mark.userId)
      if (!absentUserIds.length) return []
      const now = new Date()
      const jobs = await tx.insert(emailJobs).values(absentUserIds.map(userId => ({
        kind: 'attendance_absent',
        organizationId: current.organizationId,
        entityType: 'attendance_session',
        entityId: id,
        payload: { recipientIds: [userId] },
        scheduledFor: now,
        nextAttemptAt: now,
        dedupeKey: attendanceAbsenceEmailJobKey(id, userId),
      }))).onConflictDoNothing().returning({ id: emailJobs.id })
      return jobs.map(job => job.id)
    })
    queueImmediateAbsenceEmails(queuedEmailJobIds)
    return Response.json({ session: await load(id) })
  } catch (error) {
    return errorResponse(error, 'Unable to update attendance.')
  }
}
