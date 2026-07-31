import { and, desc, eq, inArray } from 'drizzle-orm'
import {
  emailJobs,
  notifications,
  organizationGroupMembers,
  timetableEntries,
  timetableEntryDays,
  timetables,
  timetableVersionGroups,
  timetableVersions,
  timetableVersionUsers,
} from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { canAdministerOrganization } from '@/lib/services/access'
import { planTimetableAgendaJobs } from '@/lib/timetable-email-plan'

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
    const entryRows = await db.select().from(timetableEntries).where(eq(timetableEntries.versionId, draft.id))
    const entryIds = entryRows.map(entry => entry.id)
    const entryDays = entryIds.length
      ? await db.select().from(timetableEntryDays).where(inArray(timetableEntryDays.entryId, entryIds))
      : []
    const now = new Date()
    const agendaJobs = planTimetableAgendaJobs({
      organisationId: item.organizationId,
      effectiveFrom: draft.effectiveFrom,
      effectiveTo: draft.effectiveTo,
      timeZone: draft.timeZone,
      now,
      entries: entryRows.map(entry => ({
        id: entry.id,
        subject: entry.subject,
        weekdays: entryDays.filter(day => day.entryId === entry.id).map(day => day.weekday),
        startTime: entry.startTime,
        endTime: entry.endTime,
      })),
    })
    await db.transaction(async tx => {
      await tx.update(timetableVersions).set({ state: 'published', publishedAt: now }).where(eq(timetableVersions.id, draft.id))
      await tx.update(timetables).set({ currentPublishedVersionId: draft.id, status: 'active', updatedAt: now }).where(eq(timetables.id, id))
      if (agendaJobs.length) {
        await tx.insert(emailJobs).values(agendaJobs.map(job => ({
          kind: 'timetable_agenda',
          organizationId: item.organizationId,
          entityType: 'timetable_agenda',
          entityId: item.organizationId,
          payload: { localDate: job.localDate },
          scheduledFor: job.dueAt,
          nextAttemptAt: job.dueAt,
          dedupeKey: `timetable:agenda:${item.organizationId}:${job.localDate}`,
        }))).onConflictDoNothing({ target: emailJobs.dedupeKey })
      }
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
          visibleAt: now,
        })))
      }
    })
    return Response.json({ versionId: draft.id, revision: draft.revision })
  } catch (error) {
    return errorResponse(error, 'Unable to publish timetable.')
  }
}
