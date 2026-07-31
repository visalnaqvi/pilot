import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { attendanceSessions, emailJobs, timetables, timetableVersions } from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { canAdministerOrganization } from '@/lib/services/access'
import { saveTimetable } from '@/lib/services/timetables'

const schema = z.object({
  name: z.string().trim().min(1).max(240),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date(),
  timeZone: z.string().min(1).max(100),
  selectedUserIds: z.array(z.string()),
  selectedGroupIds: z.array(z.string().uuid()),
  entries: z.array(z.object({
    subject: z.string().trim().min(1),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1),
    startTime: z.string(),
    endTime: z.string(),
    teacherUserId: z.string().nullable().optional(),
    teacher: z.string().optional(),
    location: z.string().optional(),
    meetingUrl: z.string().optional(),
    notes: z.string().optional(),
  })).min(1),
})

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const { id } = await context.params
    const item = (await database().select().from(timetables).where(eq(timetables.id, id)).limit(1))[0]
    if (!item) return Response.json({ error: 'Timetable not found.' }, { status: 404 })
    if (!(await canAdministerOrganization(auth.user, item.organizationId))) return Response.json({ error: 'Organization owner access required.' }, { status: 403 })
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid timetable.', issues: parsed.error.issues }, { status: 400 })
    return Response.json(await saveTimetable(parsed.data, item.organizationId, auth.user.uid, id))
  } catch (error) {
    return errorResponse(error, 'Unable to update timetable.')
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const { id } = await context.params
    const db = database()
    const item = (await db.select().from(timetables).where(eq(timetables.id, id)).limit(1))[0]
    if (!item) return Response.json({ error: 'Timetable not found.' }, { status: 404 })
    if (!(await canAdministerOrganization(auth.user, item.organizationId))) {
      return Response.json({ error: 'Organization owner access required.' }, { status: 403 })
    }
    if (item.status !== 'archived') {
      return Response.json({ error: 'Disable the timetable before deleting it.' }, { status: 409 })
    }
    await db.transaction(async tx => {
      const versionIds = (await tx.select({ id: timetableVersions.id }).from(timetableVersions).where(eq(timetableVersions.timetableId, id))).map(version => version.id)
      if (versionIds.length) await tx.delete(attendanceSessions).where(inArray(attendanceSessions.timetableVersionId, versionIds))
      await tx.delete(emailJobs).where(and(
        eq(emailJobs.entityType, 'timetable'),
        eq(emailJobs.entityId, id),
      ))
      await tx.delete(timetables).where(eq(timetables.id, id))
    })
    return new Response(null, { status: 204 })
  } catch (error) {
    return errorResponse(error, 'Unable to delete timetable.')
  }
}
