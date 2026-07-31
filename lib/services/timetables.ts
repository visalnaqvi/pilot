import 'server-only'

import { asc, eq, inArray, sql } from 'drizzle-orm'
import {
  organizationGroups,
  organizations,
  timetableEntries,
  timetableEntryDays,
  timetables,
  timetableVersionGroups,
  timetableVersions,
  timetableVersionUsers,
} from '@/db/schema'
import { database } from '@/lib/db'

export type TimetablePayload = {
  name: string
  effectiveFrom: string
  effectiveTo: string
  timeZone: string
  selectedUserIds: string[]
  selectedGroupIds: string[]
  entries: {
    id?: string
    subject: string
    weekdays: number[]
    startTime: string
    endTime: string
    teacherUserId?: string | null
    teacher?: string
    location?: string
    meetingUrl?: string
    notes?: string
  }[]
}

export async function saveTimetable(input: TimetablePayload, organizationId: string, userId: string, timetableId?: string) {
  const db = database()
  return db.transaction(async tx => {
    let timetable
    if (timetableId) {
      timetable = (await tx.select().from(timetables).where(eq(timetables.id, timetableId)).limit(1))[0]
      if (!timetable || timetable.organizationId !== organizationId) throw new Error('Timetable not found.')
      await tx.update(timetables).set({ name: input.name, updatedAt: new Date() }).where(eq(timetables.id, timetable.id))
    } else {
      [timetable] = await tx.insert(timetables).values({ organizationId, name: input.name, createdBy: userId }).returning()
    }
    const revisionResult = await tx.select({ max: sql<number>`coalesce(max(${timetableVersions.revision}), 0)::int` }).from(timetableVersions).where(eq(timetableVersions.timetableId, timetable.id))
    const [version] = await tx.insert(timetableVersions).values({
      timetableId: timetable.id,
      revision: revisionResult[0].max + 1,
      state: 'draft',
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      timeZone: input.timeZone,
      createdBy: userId,
    }).returning()
    for (const [position, item] of input.entries.entries()) {
      const [entry] = await tx.insert(timetableEntries).values({
        versionId: version.id,
        subject: item.subject,
        startTime: item.startTime,
        endTime: item.endTime,
        teacherUserId: item.teacherUserId || null,
        teacherLabel: item.teacher || null,
        location: item.location || null,
        meetingUrl: item.meetingUrl || null,
        notes: item.notes || null,
        position,
      }).returning()
      await tx.insert(timetableEntryDays).values(item.weekdays.map(weekday => ({ entryId: entry.id, weekday })))
    }
    if (input.selectedUserIds.length) await tx.insert(timetableVersionUsers).values(input.selectedUserIds.map(selectedUserId => ({ versionId: version.id, userId: selectedUserId })))
    if (input.selectedGroupIds.length) await tx.insert(timetableVersionGroups).values(input.selectedGroupIds.map(groupId => ({ versionId: version.id, groupId })))
    return { timetableId: timetable.id, versionId: version.id }
  })
}

export async function serializeTimetables(
  items: (typeof timetables.$inferSelect)[],
  options: { includeDrafts?: boolean } = {},
) {
  const db = database()
  const timetableIds = items.map(item => item.id)
  if (!timetableIds.length) return []
  const versions = await db.select().from(timetableVersions).where(inArray(timetableVersions.timetableId, timetableIds)).orderBy(timetableVersions.revision)
  const chosen = items.flatMap(item => {
    const own = versions.filter(version => version.timetableId === item.id)
    const currentPublished = own.find(version => version.id === item.currentPublishedVersionId)
    if (!options.includeDrafts) {
      return currentPublished ? [{ timetable: item, version: currentPublished }] : []
    }
    const latestDraft = own.findLast(version => version.state === 'draft')
    const selected = [latestDraft, currentPublished].filter((version): version is NonNullable<typeof version> => Boolean(version))
    return [...new Map(selected.map(version => [version.id, { timetable: item, version }])).values()]
  })
  const versionIds = chosen.map(item => item.version.id)
  const entries = versionIds.length ? await db.select().from(timetableEntries).where(inArray(timetableEntries.versionId, versionIds)).orderBy(asc(timetableEntries.position)) : []
  const entryIds = entries.map(item => item.id)
  const days = entryIds.length ? await db.select().from(timetableEntryDays).where(inArray(timetableEntryDays.entryId, entryIds)) : []
  const usersAudience = versionIds.length ? await db.select().from(timetableVersionUsers).where(inArray(timetableVersionUsers.versionId, versionIds)) : []
  const groupsAudience = versionIds.length ? await db.select({
    versionId: timetableVersionGroups.versionId,
    groupId: timetableVersionGroups.groupId,
    groupName: organizationGroups.name,
  }).from(timetableVersionGroups).innerJoin(organizationGroups, eq(organizationGroups.id, timetableVersionGroups.groupId))
    .where(inArray(timetableVersionGroups.versionId, versionIds)) : []
  const organizationsRows = await db.select().from(organizations).where(inArray(organizations.id, items.map(item => item.organizationId)))
  return chosen.map(({ timetable, version }) => ({
    id: timetable.id,
    versionId: version.id,
    organisationId: timetable.organizationId,
    organizationId: timetable.organizationId,
    organisationName: organizationsRows.find(item => item.id === timetable.organizationId)?.name || '',
    name: timetable.name,
    status: timetable.status,
    revision: version.revision,
    state: version.state,
    effectiveFrom: version.effectiveFrom,
    effectiveTo: version.effectiveTo,
    timeZone: version.timeZone,
    selectedUserIds: usersAudience.filter(item => item.versionId === version.id).map(item => item.userId),
    selectedGroupIds: groupsAudience.filter(item => item.versionId === version.id).map(item => item.groupId),
    audienceNames: groupsAudience.filter(item => item.versionId === version.id).map(item => item.groupName),
    entries: entries.filter(item => item.versionId === version.id).map(item => ({
      id: item.id,
      subject: item.subject,
      weekdays: days.filter(day => day.entryId === item.id).map(day => day.weekday),
      startTime: item.startTime,
      endTime: item.endTime,
      teacherUserId: item.teacherUserId || undefined,
      teacher: item.teacherLabel || undefined,
      location: item.location || '',
      meetingUrl: item.meetingUrl || '',
      notes: item.notes || '',
    })),
    createdAt: timetable.createdAt.toISOString(),
    updatedAt: timetable.updatedAt.toISOString(),
    publishedAt: version.publishedAt?.toISOString() || null,
    archivedAt: timetable.archivedAt?.toISOString() || null,
  }))
}
