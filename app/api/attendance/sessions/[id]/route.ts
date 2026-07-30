import { errorResponse, requireRole } from '@/lib/admin-api'
import { adminDb, Timestamp } from '@/lib/firebase-admin'
import { saveAttendanceSchema } from '@/lib/attendance-schema'
import { attendanceCounts, type AttendanceSession } from '@/lib/attendance'
import { canManageAttendance, serializableTimestamp } from '@/lib/attendance-api'

export const runtime = 'nodejs'

function serialize(document: FirebaseFirestore.DocumentSnapshot, studentId?: string) {
  const data = document.data() as AttendanceSession
  const roster = studentId ? data.roster.filter(entry => entry.userId === studentId) : data.roster
  const own = studentId ? roster[0] : null
  return {
    ...data,
    id: document.id,
    roster,
    rosterUserIds: studentId ? roster.map(entry => entry.userId) : data.rosterUserIds,
    presentCount: studentId ? Number(own?.status === 'present') : data.presentCount,
    absentCount: studentId ? Number(own?.status === 'absent') : data.absentCount,
    createdAt: serializableTimestamp(data.createdAt),
    updatedAt: serializableTimestamp(data.updatedAt),
    submittedAt: serializableTimestamp(data.submittedAt),
    cancelledAt: serializableTimestamp(data.cancelledAt),
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ['user', 'organisation'])
  if ('error' in auth) return auth.error
  try {
    const { id } = await context.params
    const reference = adminDb.collection('attendanceSessions').doc(id)
    const snapshot = await reference.get()
    if (!snapshot.exists) return Response.json({ error: 'Attendance session not found.' }, { status: 404 })
    const data = snapshot.data() as AttendanceSession
    const canManage = await canManageAttendance(auth.user, data)
    const isStudent = auth.user.role === 'user' && data.rosterUserIds.includes(auth.user.uid)
    if (!canManage && !isStudent) return Response.json({ error: 'You cannot view this attendance session.' }, { status: 403 })
    const history = canManage
      ? (await reference.collection('history').orderBy('revision', 'desc').get()).docs.map(document => ({
        id: document.id,
        ...document.data(),
        changedAt: serializableTimestamp(document.data().changedAt),
      }))
      : []
    return Response.json({ session: serialize(snapshot, canManage ? undefined : auth.user.uid), history, canManage })
  } catch (error) {
    return errorResponse(error, 'Unable to load attendance session.')
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ['user', 'organisation'])
  if ('error' in auth) return auth.error
  try {
    const { id } = await context.params
    const parsed = saveAttendanceSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || 'Invalid attendance.' }, { status: 400 })
    const reference = adminDb.collection('attendanceSessions').doc(id)
    const initial = await reference.get()
    if (!initial.exists) return Response.json({ error: 'Attendance session not found.' }, { status: 404 })
    const initialData = initial.data() as AttendanceSession
    if (!await canManageAttendance(auth.user, initialData)) {
      return Response.json({ error: 'You cannot update this attendance session.' }, { status: 403 })
    }
    const now = Timestamp.now()
    await adminDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new Error('Attendance session no longer exists.')
      const data = snapshot.data() as AttendanceSession
      if (data.revision !== parsed.data.revision) throw new Error('Attendance was updated elsewhere. Reload before saving again.')
      let roster = data.roster
      if (parsed.data.status === 'submitted') {
        const byUser = new Map(parsed.data.records.map(record => [record.userId, record.status]))
        if (byUser.size !== data.roster.length || data.roster.some(student => !byUser.has(student.userId))) {
          throw new Error('Mark every student exactly once before submitting attendance.')
        }
        roster = data.roster.map(student => ({ ...student, status: byUser.get(student.userId)! }))
      }
      const counts = parsed.data.status === 'submitted'
        ? attendanceCounts(roster)
        : { present: 0, absent: 0 }
      const revision = data.revision + 1
      const changes = data.roster.flatMap((student, index) => {
        const next = roster[index]?.status || student.status
        return next === student.status ? [] : [{ userId: student.userId, from: student.status, to: next }]
      })
      transaction.update(reference, {
        roster,
        status: parsed.data.status,
        presentCount: counts.present,
        absentCount: counts.absent,
        cancellationReason: parsed.data.status === 'cancelled' ? parsed.data.cancellationReason : '',
        revision,
        updatedBy: auth.user.uid,
        updatedAt: now,
        submittedAt: parsed.data.status === 'submitted' ? now : null,
        cancelledAt: parsed.data.status === 'cancelled' ? now : null,
      })
      transaction.create(reference.collection('history').doc(String(revision).padStart(6, '0')), {
        revision,
        fromStatus: data.status,
        toStatus: parsed.data.status,
        changes,
        cancellationReason: parsed.data.status === 'cancelled' ? parsed.data.cancellationReason : '',
        changedBy: auth.user.uid,
        changedByName: auth.user.name,
        changedByRole: auth.user.role,
        changedAt: now,
      })
    })
    const updated = await reference.get()
    return Response.json({ session: serialize(updated) })
  } catch (error) {
    if (error instanceof Error && /updated elsewhere|Mark every student/.test(error.message)) {
      return Response.json({ error: error.message }, { status: 409 })
    }
    return errorResponse(error, 'Unable to save attendance.')
  }
}
