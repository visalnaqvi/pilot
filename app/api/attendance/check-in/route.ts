import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  attendanceMarks,
  attendanceQrCheckIns,
  attendanceQrWindows,
  attendanceSessions,
  organizationMemberships,
} from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { validateAttendanceQrSecret, verifyAttendanceQrToken } from '@/lib/attendance-qr'
import { database } from '@/lib/db'

export const runtime = 'nodejs'

const schema = z.object({ token: z.string().min(1).max(2_000) })
type CheckInRejectionReason =
  | 'QR_SESSION_NOT_FOUND'
  | 'QR_SESSION_CLOSED'
  | 'QR_WINDOW_CLOSED'
  | 'QR_STUDENT_MEMBERSHIP_REQUIRED'
  | 'QR_NOT_ON_ROSTER'
  | 'QR_TEACHER_OVERRIDE'

function rejected(reason: string, message: string, status: number) {
  console.info(JSON.stringify({ event: 'attendance_qr_check_in_rejected', reason }))
  return Response.json({ error: message, code: reason }, { status })
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  if (auth.actor.uid !== auth.user.uid || request.headers.has('x-impersonate-user')) {
    return rejected('QR_IMPERSONATION_FORBIDDEN', 'QR check-in cannot be completed while impersonating another account.', 403)
  }
  try {
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return rejected('INVALID_QR_TOKEN', 'This QR code is invalid. Scan the current code again.', 400)
    const payload = verifyAttendanceQrToken({
      token: parsed.data.token,
      secret: validateAttendanceQrSecret(process.env.QR_ATTENDANCE_SECRET),
    })
    const now = new Date()
    const result = await database().transaction(async tx => {
      const [session] = await tx.select().from(attendanceSessions)
        .where(eq(attendanceSessions.id, payload.sessionId))
        .for('update')
      if (!session) return { reason: 'QR_SESSION_NOT_FOUND' } as const
      if (session.status !== 'draft') return { reason: 'QR_SESSION_CLOSED' } as const
      const [window] = await tx.select().from(attendanceQrWindows).where(and(
        eq(attendanceQrWindows.id, payload.windowId),
        eq(attendanceQrWindows.sessionId, session.id),
      )).limit(1)
      if (!window || window.closedAt || window.expiresAt <= now) return { reason: 'QR_WINDOW_CLOSED' } as const
      const [membership] = await tx.select({ role: organizationMemberships.role })
        .from(organizationMemberships)
        .where(and(
          eq(organizationMemberships.organizationId, session.organizationId),
          eq(organizationMemberships.userId, auth.user.uid),
          eq(organizationMemberships.status, 'accepted'),
          eq(organizationMemberships.role, 'student'),
        ))
        .limit(1)
      if (!membership) return { reason: 'QR_STUDENT_MEMBERSHIP_REQUIRED' } as const
      const [mark] = await tx.select().from(attendanceMarks).where(and(
        eq(attendanceMarks.sessionId, session.id),
        eq(attendanceMarks.userId, auth.user.uid),
      )).for('update')
      if (!mark) return { reason: 'QR_NOT_ON_ROSTER' } as const
      if (mark.mark === 'absent') return { reason: 'QR_TEACHER_OVERRIDE' } as const
      const [created] = await tx.insert(attendanceQrCheckIns).values({
        windowId: window.id,
        sessionId: session.id,
        userId: auth.user.uid,
        checkedInAt: now,
      }).onConflictDoNothing().returning()
      if (mark.mark === 'unmarked') {
        await tx.update(attendanceMarks).set({ mark: 'present', updatedAt: now }).where(and(
          eq(attendanceMarks.sessionId, session.id),
          eq(attendanceMarks.userId, auth.user.uid),
        ))
      }
      if (created) return { checkedInAt: created.checkedInAt, alreadyCheckedIn: false } as const
      const [existing] = await tx.select().from(attendanceQrCheckIns).where(and(
        eq(attendanceQrCheckIns.sessionId, session.id),
        eq(attendanceQrCheckIns.userId, auth.user.uid),
      )).limit(1)
      if (!existing) throw new Error('QR_CHECK_IN_CONFLICT')
      return { checkedInAt: existing.checkedInAt, alreadyCheckedIn: true } as const
    })

    const reason = 'reason' in result ? result.reason as CheckInRejectionReason : null
    if (reason) {
      const responses: Record<CheckInRejectionReason, [string, number]> = {
        QR_SESSION_NOT_FOUND: ['This attendance session is unavailable.', 404],
        QR_SESSION_CLOSED: ['This attendance register has already been finalized.', 409],
        QR_WINDOW_CLOSED: ['This QR window has closed. Ask the teacher to reopen it.', 409],
        QR_STUDENT_MEMBERSHIP_REQUIRED: ['An accepted student membership is required for this class.', 403],
        QR_NOT_ON_ROSTER: ['You are not on the attendance roster for this class.', 403],
        QR_TEACHER_OVERRIDE: ['Your teacher has already marked this attendance. Ask them to review it.', 409],
      }
      const [message, status] = responses[reason]
      return rejected(reason, message, status)
    }
    if (!result.checkedInAt) throw new Error('QR_CHECK_IN_CONFLICT')
    console.info(JSON.stringify({
      event: result.alreadyCheckedIn ? 'attendance_qr_check_in_repeated' : 'attendance_qr_check_in_succeeded',
      sessionId: payload.sessionId,
    }))
    return Response.json({
      success: true,
      alreadyCheckedIn: result.alreadyCheckedIn,
      checkedInAt: result.checkedInAt.toISOString(),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : ''
    if (reason === 'QR_TOKEN_EXPIRED') {
      return rejected(reason, 'This QR code has expired. Scan the current code again.', 409)
    }
    if (reason === 'INVALID_QR_TOKEN') {
      return rejected(reason, 'This QR code is invalid. Scan the current code again.', 400)
    }
    if (/QR attendance is not configured/.test(reason)) {
      return rejected('QR_NOT_CONFIGURED', 'QR attendance is temporarily unavailable. Ask the teacher to mark you manually.', 503)
    }
    return errorResponse(error, 'Unable to complete QR check-in.')
  }
}
