import { eq, inArray } from 'drizzle-orm'
import {
  organizationGroupMembers,
  timetableVersionGroups,
  timetableVersionUsers,
  timetableVersions,
  timetables,
} from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { canAdministerOrganization } from '@/lib/services/access'
import { saveTimetable, serializeTimetables } from '@/lib/services/timetables'
import { createTimetablePayloadSchema } from '@/lib/timetable-api-schema'

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const db = database()
    let items
    let includeDrafts = false
    if (auth.user.globalRole === 'admin') {
      items = await db.select().from(timetables)
      includeDrafts = true
    } else if (auth.user.organizationId && auth.user.membershipRole === 'owner') {
      items = await db.select().from(timetables).where(eq(timetables.organizationId, auth.user.organizationId))
      includeDrafts = true
    } else if (auth.user.organizationId && auth.user.membershipRole === 'teacher') {
      items = await db.select().from(timetables).where(eq(timetables.organizationId, auth.user.organizationId))
    } else {
      const directVersions = await db.select({ id: timetableVersions.id, timetableId: timetableVersions.timetableId }).from(timetableVersions)
        .leftJoin(timetableVersionUsers, eq(timetableVersionUsers.versionId, timetableVersions.id))
        .where(eq(timetableVersionUsers.userId, auth.user.uid))
      const groupIds = (await db.select().from(organizationGroupMembers).where(eq(organizationGroupMembers.userId, auth.user.uid))).map(item => item.groupId)
      const groupVersions = groupIds.length ? await db.select({
        timetableId: timetableVersions.timetableId,
      }).from(timetableVersionGroups)
        .innerJoin(timetableVersions, eq(timetableVersions.id, timetableVersionGroups.versionId))
        .where(inArray(timetableVersionGroups.groupId, groupIds)) : []
      const ids = [...new Set([...directVersions.map(item => item.timetableId), ...groupVersions.map(item => item.timetableId)])]
      items = ids.length ? await db.select().from(timetables).where(inArray(timetables.id, ids)) : []
    }
    return Response.json({ items: await serializeTimetables(items, { includeDrafts }), nextCursor: null })
  } catch (error) {
    return errorResponse(error, 'Unable to load timetables.')
  }
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const parsed = createTimetablePayloadSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid timetable.', issues: parsed.error.issues }, { status: 400 })
    if (!(await canAdministerOrganization(auth.user, parsed.data.organizationId))) return Response.json({ error: 'Organization owner access required.' }, { status: 403 })
    const result = await saveTimetable(parsed.data, parsed.data.organizationId, auth.user.uid)
    return Response.json(result, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'Unable to create timetable.')
  }
}
