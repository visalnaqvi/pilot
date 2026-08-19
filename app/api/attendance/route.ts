import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import {
  attendanceMarks,
  attendanceQrCheckIns,
  attendanceSessions,
  organizationMemberships,
  organizations,
  timetableEntries,
  timetableEntryDays,
  timetables,
  timetableVersions,
  users,
} from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { attendanceSeries, attendanceSummary } from '@/lib/attendance'
import { database } from '@/lib/db'
import { acceptedMemberships } from '@/lib/services/access'
import { addDays, localDateKey, validDateKey, weekdayForDate } from '@/lib/timetable'

type SessionRow = typeof attendanceSessions.$inferSelect
type MembershipRole = typeof organizationMemberships.$inferSelect.role
type AttendanceMode = 'organisation' | 'teaching' | 'student'

function dateRange(url: URL) {
  const today = new Date().toISOString().slice(0, 10)
  const from = url.searchParams.get('from') || addDays(today, -29)
  const to = url.searchParams.get('to') || today
  if (!validDateKey(from) || !validDateKey(to) || to < from) {
    throw new Error('Enter a valid attendance date range.')
  }
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
  if (days > 366) throw new Error('Attendance reports can cover at most 366 days at a time.')
  return { from, to }
}

function organisationOptions(
  memberships: Awaited<ReturnType<typeof acceptedMemberships>>,
  organisationRows: (typeof organizations.$inferSelect)[],
) {
  const names = new Map(organisationRows.map(item => [item.id, item.name]))
  return memberships.flatMap(item => {
    if (item.role === 'owner') return []
    return [{
      organisationId: item.organizationId,
      organisationName: names.get(item.organizationId) || item.organizationId,
      memberRole: item.role as Exclude<MembershipRole, 'owner'>,
    }]
  })
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error

  try {
    const url = new URL(request.url)
    const { from, to } = dateRange(url)
    const requestedOrganisationId = url.searchParams.get('organizationId')
      || url.searchParams.get('organisationId')
      || ''
    const requestedMode = url.searchParams.get('mode')
    const db = database()
    const memberships = await acceptedMemberships(auth.user.uid)
    const teacherMemberships = memberships.filter(item => item.role === 'teacher')
    const allMembershipOrganisationIds = [...new Set(memberships.map(item => item.organizationId))]
    const allMembershipOrganisations = allMembershipOrganisationIds.length
      ? await db.select().from(organizations).where(inArray(organizations.id, allMembershipOrganisationIds))
      : []

    let mode: AttendanceMode
    let fixedOrganisationId = ''
    let visibleTeachingOrganisationIds: string[] = []

    if (auth.user.role === 'organisation') {
      mode = 'organisation'
      fixedOrganisationId = auth.user.organizationId || ''
    } else if (auth.user.role === 'admin') {
      mode = 'organisation'
      fixedOrganisationId = requestedOrganisationId
    } else if (requestedMode !== 'student' && teacherMemberships.length) {
      mode = 'teaching'
      visibleTeachingOrganisationIds = teacherMemberships.map(item => item.organizationId)
      if (requestedOrganisationId) {
        if (!visibleTeachingOrganisationIds.includes(requestedOrganisationId)) {
          return Response.json({ error: 'Teacher access to this institute is required.' }, { status: 403 })
        }
        visibleTeachingOrganisationIds = [requestedOrganisationId]
      }
    } else {
      mode = 'student'
    }

    if (mode === 'organisation' && auth.user.role === 'organisation' && !fixedOrganisationId) {
      return Response.json({ error: 'Your institute could not be determined.' }, { status: 400 })
    }

    let sessions: SessionRow[]
    if (mode === 'organisation') {
      const conditions = [
        gte(attendanceSessions.classDate, from),
        lte(attendanceSessions.classDate, to),
      ]
      if (fixedOrganisationId) {
        conditions.push(eq(attendanceSessions.organizationId, fixedOrganisationId))
      }
      sessions = await db.select().from(attendanceSessions)
        .where(and(...conditions))
        .orderBy(desc(attendanceSessions.classDate))
    } else if (mode === 'teaching') {
      sessions = visibleTeachingOrganisationIds.length
        ? await db.select({ session: attendanceSessions })
          .from(attendanceSessions)
          .innerJoin(timetableEntries, eq(timetableEntries.id, attendanceSessions.timetableEntryId))
          .where(and(
            eq(timetableEntries.teacherUserId, auth.user.uid),
            inArray(attendanceSessions.organizationId, visibleTeachingOrganisationIds),
            gte(attendanceSessions.classDate, from),
            lte(attendanceSessions.classDate, to),
          ))
          .orderBy(desc(attendanceSessions.classDate))
          .then(rows => rows.map(row => row.session))
        : []
    } else {
      const conditions = [
        eq(attendanceMarks.userId, auth.user.uid),
        gte(attendanceSessions.classDate, from),
        lte(attendanceSessions.classDate, to),
      ]
      if (requestedOrganisationId) {
        conditions.push(eq(attendanceSessions.organizationId, requestedOrganisationId))
      }
      sessions = await db.select({ session: attendanceSessions })
        .from(attendanceMarks)
        .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceMarks.sessionId))
        .where(and(...conditions))
        .orderBy(desc(attendanceSessions.classDate))
        .then(rows => rows.map(row => row.session))
    }

    const sessionIds = sessions.map(item => item.id)
    const marks = sessionIds.length
      ? await db.select({
        sessionId: attendanceMarks.sessionId,
        userId: attendanceMarks.userId,
        mark: attendanceMarks.mark,
        status: attendanceMarks.mark,
        userName: users.name,
        userEmail: users.email,
      }).from(attendanceMarks)
        .innerJoin(users, eq(users.id, attendanceMarks.userId))
        .where(inArray(attendanceMarks.sessionId, sessionIds))
      : []
    const visibleMarks = mode === 'student'
      ? marks.filter(mark => mark.userId === auth.user.uid)
      : marks
    const qrCheckIns = sessionIds.length
      ? await db.select().from(attendanceQrCheckIns).where(inArray(attendanceQrCheckIns.sessionId, sessionIds))
      : []
    const qrCheckedInAt = new Map(qrCheckIns.map(item => [
      `${item.sessionId}:${item.userId}`,
      item.checkedInAt.toISOString(),
    ]))

    const entryIds = [...new Set(sessions.map(item => item.timetableEntryId))]
    const entries = entryIds.length
      ? await db.select().from(timetableEntries).where(inArray(timetableEntries.id, entryIds))
      : []
    const versionIds = [...new Set(sessions.map(item => item.timetableVersionId))]
    const versions = versionIds.length
      ? await db.select().from(timetableVersions).where(inArray(timetableVersions.id, versionIds))
      : []
    const timetableIds = [...new Set(versions.map(item => item.timetableId))]
    const timetableRows = timetableIds.length
      ? await db.select().from(timetables).where(inArray(timetables.id, timetableIds))
      : []
    const sessionOrganisationIds = [...new Set(sessions.map(item => item.organizationId))]
    const sessionOrganisations = sessionOrganisationIds.length
      ? await db.select().from(organizations).where(inArray(organizations.id, sessionOrganisationIds))
      : []

    const entryById = new Map(entries.map(item => [item.id, item]))
    const versionById = new Map(versions.map(item => [item.id, item]))
    const timetableById = new Map(timetableRows.map(item => [item.id, item]))
    const organisationById = new Map(sessionOrganisations.map(item => [item.id, item]))
    const items = sessions.map(session => {
      const entry = entryById.get(session.timetableEntryId)
      const version = versionById.get(session.timetableVersionId)
      const timetable = version ? timetableById.get(version.timetableId) : undefined
      const ownMarks = visibleMarks.filter(mark => mark.sessionId === session.id)
      return {
        ...session,
        organisationId: session.organizationId,
        organisationName: organisationById.get(session.organizationId)?.name || '',
        timetableId: timetable?.id || '',
        timetableVersionId: session.timetableVersionId,
        timetableName: timetable?.name || '',
        timetableRevision: version?.revision || 1,
        entryId: session.timetableEntryId,
        subject: entry?.subject || '',
        startTime: entry?.startTime || '',
        endTime: entry?.endTime || '',
        teacherUserId: entry?.teacherUserId || undefined,
        teacher: entry?.teacherLabel || undefined,
        timeZone: version?.timeZone || 'Asia/Kolkata',
        rosterUserIds: ownMarks.map(mark => mark.userId),
        roster: ownMarks.map(mark => ({
          ...mark,
          qrCheckedInAt: qrCheckedInAt.get(`${session.id}:${mark.userId}`) || null,
        })),
        presentCount: ownMarks.filter(mark => mark.mark === 'present').length,
        absentCount: ownMarks.filter(mark => mark.mark === 'absent').length,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        submittedAt: session.submittedAt?.toISOString() || null,
        cancelledAt: session.cancelledAt?.toISOString() || null,
      }
    })

    let pendingTimetables: (typeof timetables.$inferSelect)[] = []
    if (mode === 'organisation') {
      pendingTimetables = fixedOrganisationId
        ? await db.select().from(timetables).where(and(
          eq(timetables.status, 'active'),
          eq(timetables.organizationId, fixedOrganisationId),
        ))
        : await db.select().from(timetables).where(eq(timetables.status, 'active'))
    } else if (mode === 'teaching' && visibleTeachingOrganisationIds.length) {
      pendingTimetables = await db.select().from(timetables).where(and(
        eq(timetables.status, 'active'),
        inArray(timetables.organizationId, visibleTeachingOrganisationIds),
      ))
    }

    const publishedVersionIds = pendingTimetables.flatMap(item => (
      item.currentPublishedVersionId ? [item.currentPublishedVersionId] : []
    ))
    const publishedVersions = publishedVersionIds.length
      ? await db.select().from(timetableVersions).where(inArray(timetableVersions.id, publishedVersionIds))
      : []
    const publishedEntries = publishedVersionIds.length
      ? await db.select().from(timetableEntries).where(inArray(timetableEntries.versionId, publishedVersionIds))
      : []
    const publishedEntryIds = publishedEntries.map(item => item.id)
    const publishedDays = publishedEntryIds.length
      ? await db.select().from(timetableEntryDays).where(inArray(timetableEntryDays.entryId, publishedEntryIds))
      : []
    const pendingOrganisationIds = [...new Set(pendingTimetables.map(item => item.organizationId))]
    const pendingOrganisations = pendingOrganisationIds.length
      ? await db.select().from(organizations).where(inArray(organizations.id, pendingOrganisationIds))
      : []
    const pendingOrganisationById = new Map(pendingOrganisations.map(item => [item.id, item]))
    const pendingTimetableByVersionId = new Map(pendingTimetables.flatMap(item => (
      item.currentPublishedVersionId ? [[item.currentPublishedVersionId, item] as const] : []
    )))
    const sessionByOccurrence = new Map(items.map(item => [
      `${item.timetableVersionId}:${item.entryId}:${item.classDate}`,
      item,
    ]))

    const pending = publishedVersions.flatMap(version => {
      if (version.state !== 'published') return []
      const timetable = pendingTimetableByVersionId.get(version.id)
      if (!timetable) return []
      const lastDate = [to, version.effectiveTo, localDateKey(new Date(), version.timeZone)].sort()[0]
      const firstDate = [from, version.effectiveFrom].sort().at(-1)!
      if (lastDate < firstDate) return []
      const versionEntries = publishedEntries.filter(entry => (
        entry.versionId === version.id
        && (mode !== 'teaching' || entry.teacherUserId === auth.user.uid)
      ))
      const occurrences = []
      for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) {
        for (const entry of versionEntries) {
          if (!publishedDays.some(day => day.entryId === entry.id && day.weekday === weekdayForDate(date))) {
            continue
          }
          const existing = sessionByOccurrence.get(`${version.id}:${entry.id}:${date}`)
          if (existing && existing.status !== 'draft') continue
          occurrences.push({
            id: existing?.id || `${version.id}__${entry.id}__${date}`,
            timetableId: timetable.id,
            timetableVersionId: version.id,
            timetableName: timetable.name,
            organisationId: timetable.organizationId,
            organisationName: pendingOrganisationById.get(timetable.organizationId)?.name || '',
            entryId: entry.id,
            timetableEntryId: entry.id,
            subject: entry.subject,
            classDate: date,
            startTime: entry.startTime,
            endTime: entry.endTime,
            teacherUserId: entry.teacherUserId || undefined,
            teacher: entry.teacherLabel || undefined,
            status: existing ? 'draft' as const : 'pending' as const,
          })
        }
      }
      return occurrences
    }).sort((first, second) => (
      `${second.classDate} ${second.startTime}`.localeCompare(`${first.classDate} ${first.startTime}`)
    ))

    let organisations
    if (auth.user.role === 'admin') {
      organisations = (await db.select().from(organizations)).map(item => ({
        organisationId: item.id,
        organisationName: item.name,
        memberRole: 'teacher' as const,
      }))
    } else if (auth.user.role === 'organisation') {
      const own = allMembershipOrganisations.find(item => item.id === fixedOrganisationId)
        || sessionOrganisations.find(item => item.id === fixedOrganisationId)
        || pendingOrganisations.find(item => item.id === fixedOrganisationId)
      organisations = own ? [{
        organisationId: own.id,
        organisationName: own.name,
        memberRole: 'teacher' as const,
      }] : []
    } else {
      organisations = organisationOptions(
        mode === 'teaching' ? teacherMemberships : memberships,
        allMembershipOrganisations,
      )
    }

    return Response.json({
      mode,
      from,
      to,
      organisations,
      canTeach: teacherMemberships.length > 0,
      summary: attendanceSummary(items, pending.length),
      series: attendanceSeries(items),
      sessions: items,
      pending,
      items,
      nextCursor: null,
    })
  } catch (error) {
    if (error instanceof Error && /date range|366 days/.test(error.message)) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return errorResponse(error, 'Unable to load attendance.')
  }
}
