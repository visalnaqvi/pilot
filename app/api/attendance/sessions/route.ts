import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import {
  attendanceMarks,
  attendanceSessions,
  organizationGroupMembers,
  timetableEntryDays,
  timetableEntries,
  timetableVersionGroups,
  timetableVersions,
  timetableVersionUsers,
  timetables,
} from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { canManageOrganization } from '@/lib/services/access'
import { localDateKey, weekdayForDate } from '@/lib/timetable'

const schema = z.object({
  timetableId: z.string().uuid().optional(),
  timetableVersionId: z.string().uuid().optional(),
  entryId: z.string().uuid().optional(),
  timetableEntryId: z.string().uuid().optional(),
  classDate: z.string().date(),
  intent: z.enum(['attendance', 'cancel']).optional().default('attendance'),
}).superRefine((value, context) => {
  if (!value.timetableId && !value.timetableVersionId) {
    context.addIssue({ code: 'custom', path: ['timetableVersionId'], message: 'A timetable is required.' })
  }
  if (!value.entryId && !value.timetableEntryId) {
    context.addIssue({ code: 'custom', path: ['timetableEntryId'], message: 'A timetable entry is required.' })
  }
})

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid attendance occurrence.', issues: parsed.error.issues }, { status: 400 })
    const db = database()
    const entryId = parsed.data.timetableEntryId || parsed.data.entryId!
    const requestedEntry = (await db.select().from(timetableEntries).where(eq(timetableEntries.id, entryId)).limit(1))[0]
    const versionId = parsed.data.timetableVersionId || requestedEntry?.versionId
    const version = versionId
      ? (await db.select().from(timetableVersions).where(eq(timetableVersions.id, versionId)).limit(1))[0]
      : null
    const timetable = version ? (await db.select().from(timetables).where(eq(timetables.id, version.timetableId)).limit(1))[0] : null
    const entry = version
      ? (await db.select().from(timetableEntries).where(and(eq(timetableEntries.id, entryId), eq(timetableEntries.versionId, version.id))).limit(1))[0]
      : null
    if (
      !version
      || !timetable
      || !entry
      || (parsed.data.timetableId && timetable.id !== parsed.data.timetableId)
      || version.state !== 'published'
      || timetable.status !== 'active'
    ) return Response.json({ error: 'Published timetable entry not found.' }, { status: 404 })
    const scheduledDays = await db.select().from(timetableEntryDays).where(eq(timetableEntryDays.entryId, entry.id))
    if (
      parsed.data.classDate < version.effectiveFrom
      || parsed.data.classDate > version.effectiveTo
      || !scheduledDays.some(item => item.weekday === weekdayForDate(parsed.data.classDate))
    ) return Response.json({ error: 'This class is not scheduled on the selected date.' }, { status: 400 })
    if (parsed.data.intent === 'attendance' && parsed.data.classDate > localDateKey(new Date(), version.timeZone)) {
      return Response.json({ error: 'Attendance cannot be recorded for a future class.' }, { status: 400 })
    }
    const manager = await canManageOrganization(auth.user, timetable.organizationId)
    if (!manager && entry.teacherUserId !== auth.user.uid) return Response.json({ error: 'Teacher access required.' }, { status: 403 })
    const session = await db.transaction(async tx => {
      const direct = await tx.select().from(timetableVersionUsers).where(eq(timetableVersionUsers.versionId, version.id))
      const groupIds = (await tx.select().from(timetableVersionGroups).where(eq(timetableVersionGroups.versionId, version.id))).map(item => item.groupId)
      const groupUsers = groupIds.length ? await tx.select().from(organizationGroupMembers).where(inArray(organizationGroupMembers.groupId, groupIds)) : []
      const userIds = [...new Set([...direct.map(item => item.userId), ...groupUsers.map(item => item.userId)])]
      const [session] = await tx.insert(attendanceSessions).values({
        organizationId: timetable.organizationId,
        timetableVersionId: version.id,
        timetableEntryId: entry.id,
        classDate: parsed.data.classDate,
        createdBy: auth.user.uid,
        updatedBy: auth.user.uid,
      }).onConflictDoUpdate({
        target: [attendanceSessions.timetableVersionId, attendanceSessions.timetableEntryId, attendanceSessions.classDate],
        set: { updatedBy: auth.user.uid, updatedAt: new Date() },
      }).returning()
      if (userIds.length) await tx.insert(attendanceMarks).values(userIds.map(userId => ({ sessionId: session.id, userId }))).onConflictDoNothing()
      return session
    })
    return Response.json({ id: session.id, session }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'Unable to create attendance session.')
  }
}
