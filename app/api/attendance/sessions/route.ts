import { errorResponse, requireRole } from '@/lib/admin-api'
import { adminDb, Timestamp } from '@/lib/firebase-admin'
import { openAttendanceSchema } from '@/lib/attendance-schema'
import { attendanceSessionId, isScheduledOccurrence, type AttendanceRosterEntry } from '@/lib/attendance'
import { canManageAttendance, serializableTimestamp } from '@/lib/attendance-api'
import { resolveCurrentStudentAudience } from '@/lib/task-api'
import { localDateKey, type TimetableEntry } from '@/lib/timetable'

export const runtime = 'nodejs'

function serialize(document: FirebaseFirestore.DocumentSnapshot) {
  const data = document.data()!
  return {
    id: document.id,
    ...data,
    createdAt: serializableTimestamp(data.createdAt),
    updatedAt: serializableTimestamp(data.updatedAt),
    submittedAt: serializableTimestamp(data.submittedAt),
    cancelledAt: serializableTimestamp(data.cancelledAt),
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ['user', 'organisation'])
  if ('error' in auth) return auth.error
  try {
    const parsed = openAttendanceSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || 'Invalid class occurrence.' }, { status: 400 })
    const timetableReference = adminDb.collection('timetables').doc(parsed.data.timetableId)
    const timetable = await timetableReference.get()
    if (!timetable.exists || timetable.data()?.status !== 'active') {
      return Response.json({ error: 'Published timetable not found.' }, { status: 404 })
    }
    const data = timetable.data()!
    const entry = (data.entries as TimetableEntry[] | undefined)?.find(item => item.id === parsed.data.entryId)
    if (!entry || !isScheduledOccurrence({
      classDate: parsed.data.classDate,
      effectiveFrom: data.effectiveFrom,
      effectiveTo: data.effectiveTo,
      entry,
    })) return Response.json({ error: 'This class is not scheduled on the selected date.' }, { status: 400 })
    const timeZone = String(data.timeZone || process.env.APP_TIME_ZONE || 'Asia/Kolkata')
    if (parsed.data.intent === 'attendance' && parsed.data.classDate > localDateKey(new Date(), timeZone)) {
      return Response.json({ error: 'Attendance cannot be recorded for a future class.' }, { status: 400 })
    }
    if (!await canManageAttendance(auth.user, {
      organisationId: String(data.organisationId),
      teacherUserId: entry.teacherUserId,
    })) return Response.json({ error: 'You cannot take attendance for this class.' }, { status: 403 })

    const id = attendanceSessionId(timetable.id, entry.id, parsed.data.classDate)
    const reference = adminDb.collection('attendanceSessions').doc(id)
    const existing = await reference.get()
    if (existing.exists) return Response.json({ session: serialize(existing), created: false })

    const audience = await resolveCurrentStudentAudience({
      organisationId: String(data.organisationId),
      selectedUserIds: Array.isArray(data.selectedUserIds) ? data.selectedUserIds : [],
      selectedGroupIds: Array.isArray(data.selectedGroupIds) ? data.selectedGroupIds : [],
    })
    if (!audience.length && parsed.data.intent === 'attendance') {
      return Response.json({ error: 'This class currently has no accepted students.' }, { status: 400 })
    }
    const roster: AttendanceRosterEntry[] = audience
      .map(student => ({ ...student, status: 'unmarked' as const }))
      .sort((first, second) => first.userName.localeCompare(second.userName))
    const now = Timestamp.now()
    const session = {
      organisationId: String(data.organisationId),
      organisationName: String(data.organisationName || data.organisationId),
      timetableId: timetable.id,
      timetableName: String(data.name || 'Timetable'),
      timetableRevision: Number(data.revision || 1),
      entryId: entry.id,
      subject: entry.subject,
      classDate: parsed.data.classDate,
      startTime: entry.startTime,
      endTime: entry.endTime,
      teacherUserId: entry.teacherUserId || '',
      teacher: entry.teacher || '',
      timeZone,
      rosterUserIds: roster.map(student => student.userId),
      roster,
      status: 'draft',
      presentCount: 0,
      absentCount: 0,
      cancellationReason: '',
      revision: 0,
      createdBy: auth.user.uid,
      updatedBy: auth.user.uid,
      createdAt: now,
      updatedAt: now,
      submittedAt: null,
      cancelledAt: null,
    }
    try {
      await reference.create(session)
      return Response.json({ session: { id, ...session, createdAt: now.toDate().toISOString(), updatedAt: now.toDate().toISOString() }, created: true }, { status: 201 })
    } catch {
      const concurrent = await reference.get()
      if (!concurrent.exists) throw new Error('Unable to open attendance.')
      return Response.json({ session: serialize(concurrent), created: false })
    }
  } catch (error) {
    return errorResponse(error, 'Unable to open attendance.')
  }
}
