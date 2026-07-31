import { and, desc, eq, inArray } from 'drizzle-orm'
import {
  emailJobs,
  notifications,
  organizationGroupMembers,
  timetables,
  timetableVersionGroups,
  timetableVersions,
  timetableVersionUsers,
} from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { canAdministerOrganization } from '@/lib/services/access'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const { id } = await context.params
    const db = database()
    const item = (await db.select().from(timetables).where(eq(timetables.id, id)).limit(1))[0]
    if (!item) return Response.json({ error: 'Timetable not found.' }, { status: 404 })
    if (!(await canAdministerOrganization(auth.user, item.organizationId))) return Response.json({ error: 'Organization owner access required.' }, { status: 403 })
    const draft = (await db.select().from(timetableVersions).where(and(eq(timetableVersions.timetableId, id), eq(timetableVersions.state, 'draft'))).orderBy(desc(timetableVersions.revision)).limit(1))[0]
    if (!draft) return Response.json({ error: 'No draft version is available.' }, { status: 409 })
    await db.transaction(async tx => {
      await tx.update(timetableVersions).set({ state: 'published', publishedAt: new Date() }).where(eq(timetableVersions.id, draft.id))
      await tx.update(timetables).set({ currentPublishedVersionId: draft.id, status: 'active', updatedAt: new Date() }).where(eq(timetables.id, id))
      await tx.insert(emailJobs).values({
        kind: 'timetable_published',
        organizationId: item.organizationId,
        entityType: 'timetable',
        entityId: id,
        payload: { versionId: draft.id },
        scheduledFor: new Date(),
        dedupeKey: `timetable:${id}:version:${draft.revision}:published`,
      })
      const direct = await tx.select().from(timetableVersionUsers).where(eq(timetableVersionUsers.versionId, draft.id))
      const groupIds = (await tx.select().from(timetableVersionGroups).where(eq(timetableVersionGroups.versionId, draft.id))).map(value => value.groupId)
      const groupMembers = groupIds.length
        ? await tx.select().from(organizationGroupMembers).where(inArray(organizationGroupMembers.groupId, groupIds))
        : []
      const recipientIds = [...new Set([...direct.map(value => value.userId), ...groupMembers.map(value => value.userId)])]
      if (recipientIds.length) {
        await tx.insert(notifications).values(recipientIds.map(userId => ({
          type: 'timetable_published',
          recipientUserId: userId,
          title: `${item.name} published`,
          detail: `Revision ${draft.revision} is now available.`,
          href: '/timetables',
          tone: 'amber',
          icon: 'calendar',
          dedupeKey: `timetable:${id}:revision:${draft.revision}:user:${userId}`,
          visibleAt: new Date(),
        })))
      }
    })
    return Response.json({ versionId: draft.id, revision: draft.revision })
  } catch (error) {
    return errorResponse(error, 'Unable to publish timetable.')
  }
}
