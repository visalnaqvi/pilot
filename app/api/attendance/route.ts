import { errorResponse, requireRole } from '@/lib/admin-api'
import { adminDb } from '@/lib/firebase-admin'
import {
  attendanceSeries,
  attendanceSummary,
  type AttendanceSession,
} from '@/lib/attendance'
import { membershipsForUser, serializableTimestamp } from '@/lib/attendance-api'
import { entriesForDate, localDateKey, validDateKey, type TimetableEntry } from '@/lib/timetable'

export const runtime = 'nodejs'

type TimetableDocument = {
  organisationId: string
  organisationName?: string
  name: string
  effectiveFrom: string
  effectiveTo: string
  entries: TimetableEntry[]
  teacherUserIds?: string[]
  timeZone?: string
  status?: string
}

function dateRange(url: URL) {
  const timeZone = process.env.APP_TIME_ZONE || 'Asia/Kolkata'
  const today = localDateKey(new Date(), timeZone)
  const defaultFrom = new Date(`${today}T00:00:00.000Z`)
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29)
  const from = url.searchParams.get('from') || defaultFrom.toISOString().slice(0, 10)
  const to = url.searchParams.get('to') || today
  if (!validDateKey(from) || !validDateKey(to) || to < from) throw new Error('Enter a valid attendance date range.')
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
  if (days > 366) throw new Error('Attendance reports can cover at most 366 days at a time.')
  return { from, to }
}

function sessionJson(document: FirebaseFirestore.QueryDocumentSnapshot, studentId?: string) {
  const data = document.data() as AttendanceSession
  const roster = studentId ? data.roster.filter(entry => entry.userId === studentId) : data.roster
  const own = studentId ? roster[0] : null
  return {
    ...data,
    id: document.id,
    roster,
    rosterUserIds: studentId ? (own ? [studentId] : []) : data.rosterUserIds,
    presentCount: studentId ? Number(own?.status === 'present') : Number(data.presentCount || 0),
    absentCount: studentId ? Number(own?.status === 'absent') : Number(data.absentCount || 0),
    createdAt: serializableTimestamp(data.createdAt),
    updatedAt: serializableTimestamp(data.updatedAt),
    submittedAt: serializableTimestamp(data.submittedAt),
    cancelledAt: serializableTimestamp(data.cancelledAt),
  } as AttendanceSession
}

export async function GET(request: Request) {
  const auth = await requireRole(request, ['user', 'organisation'])
  if ('error' in auth) return auth.error
  try {
    const url = new URL(request.url)
    const { from, to } = dateRange(url)
    const organisationFilter = url.searchParams.get('organisationId') || ''
    const requestedMode = url.searchParams.get('mode')
    const teacherMemberships = auth.user.role === 'user'
      ? await membershipsForUser(auth.user.uid, 'teacher')
      : []
    const mode = auth.user.role === 'organisation'
      ? 'organisation'
      : requestedMode === 'student' || !teacherMemberships.length
        ? 'student'
        : 'teaching'

    let sessionQuery: FirebaseFirestore.Query = adminDb.collection('attendanceSessions')
    if (mode === 'organisation') {
      sessionQuery = sessionQuery.where('organisationId', '==', auth.user.uid)
    } else if (mode === 'teaching') {
      sessionQuery = sessionQuery.where('teacherUserId', '==', auth.user.uid)
    } else {
      sessionQuery = sessionQuery.where('rosterUserIds', 'array-contains', auth.user.uid)
    }
    let sessionSnapshot: FirebaseFirestore.QuerySnapshot
    try {
      sessionSnapshot = await sessionQuery
        .where('classDate', '>=', from)
        .where('classDate', '<=', to)
        .orderBy('classDate', 'desc')
        .get()
    } catch (reason) {
      const errorCode = typeof reason === 'object' && reason && 'code' in reason
        ? Number(reason.code)
        : 0
      if (errorCode !== 9) throw reason
      // Composite indexes can take several minutes to become available after
      // deployment. The role-scoped base query remains secure and lets local
      // development work while Firebase finishes building the date index.
      sessionSnapshot = await sessionQuery.get()
    }
    const sessions = sessionSnapshot.docs
      .filter(document => {
        const classDate = String(document.data().classDate || '')
        return classDate >= from && classDate <= to
      })
      .map(document => sessionJson(document, mode === 'student' ? auth.user.uid : undefined))
      .filter(session => !organisationFilter || session.organisationId === organisationFilter)
      .sort((first, second) => `${second.classDate} ${second.startTime}`.localeCompare(`${first.classDate} ${first.startTime}`))

    let timetableSnapshot: FirebaseFirestore.QuerySnapshot | null = null
    if (mode === 'organisation') {
      timetableSnapshot = await adminDb.collection('timetables')
        .where('organisationId', '==', auth.user.uid)
        .get()
    } else if (mode === 'teaching') {
      timetableSnapshot = await adminDb.collection('timetables')
        .where('teacherUserIds', 'array-contains', auth.user.uid)
        .get()
    }

    const sessionById = new Map(sessions.map(session => [session.id, session]))
    const pending = (timetableSnapshot?.docs || []).flatMap(document => {
      const timetable = document.data() as TimetableDocument
      if (organisationFilter && timetable.organisationId !== organisationFilter) return []
      const timeZone = timetable.timeZone || process.env.APP_TIME_ZONE || 'Asia/Kolkata'
      const lastDate = [to, timetable.effectiveTo, localDateKey(new Date(), timeZone)].sort()[0]
      const firstDate = [from, timetable.effectiveFrom].sort().at(-1)!
      if (lastDate < firstDate || timetable.status !== 'active') return []
      const occurrences: Array<Record<string, unknown>> = []
      for (let date = firstDate; date <= lastDate;) {
        entriesForDate(timetable.entries || [], date)
          .filter(entry => mode !== 'teaching' || entry.teacherUserId === auth.user.uid)
          .forEach(entry => {
            const id = `${document.id}__${entry.id}__${date}`
            const existing = sessionById.get(id)
            if (!existing || existing.status === 'draft') {
              occurrences.push({
                id,
                timetableId: document.id,
                timetableName: timetable.name,
                organisationId: timetable.organisationId,
                organisationName: timetable.organisationName || timetable.organisationId,
                entryId: entry.id,
                subject: entry.subject,
                classDate: date,
                startTime: entry.startTime,
                endTime: entry.endTime,
                teacherUserId: entry.teacherUserId || '',
                teacher: entry.teacher || '',
                status: existing ? 'draft' : 'pending',
              })
            }
          })
        const next = new Date(`${date}T00:00:00.000Z`)
        next.setUTCDate(next.getUTCDate() + 1)
        date = next.toISOString().slice(0, 10)
      }
      return occurrences
    }).sort((first, second) => `${second.classDate} ${second.startTime}`.localeCompare(`${first.classDate} ${first.startTime}`))

    const organisations = auth.user.role === 'user'
      ? await membershipsForUser(auth.user.uid)
      : [{ organisationId: auth.user.uid, organisationName: auth.user.name, memberRole: 'teacher' as const }]
    return Response.json({
      mode,
      from,
      to,
      organisations,
      canTeach: teacherMemberships.length > 0,
      summary: attendanceSummary(sessions, pending.length),
      series: attendanceSeries(sessions),
      sessions,
      pending,
    })
  } catch (error) {
    if (error instanceof Error && /date range|366 days/.test(error.message)) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return errorResponse(error, 'Unable to load attendance.')
  }
}
