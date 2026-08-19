import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import {
  attendanceQrCheckIns,
  attendanceQrWindows,
  attendanceSessions,
  timetableEntries,
  timetableVersions,
} from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import {
  attendanceQrTokenExpiry,
  attendanceQrWindowExpiry,
  signAttendanceQrToken,
  validateAttendanceQrSecret,
} from '@/lib/attendance-qr'
import { appBaseUrl } from '@/lib/app-url'
import { database } from '@/lib/db'
import { canAdministerOrganization } from '@/lib/services/access'

export const runtime = 'nodejs'

const idSchema = z.string().uuid()

function qrError(error: unknown) {
  const reason = error instanceof Error ? error.message : ''
  if (reason === 'QR_WINDOW_TOO_EARLY') {
    return Response.json({ error: 'QR check-in opens 15 minutes before this class.', code: reason }, { status: 409 })
  }
  if (reason === 'QR_WINDOW_TOO_LATE') {
    return Response.json({ error: 'The QR check-in period for this class has ended.', code: reason }, { status: 409 })
  }
  if (/QR attendance is not configured/.test(reason)) {
    return Response.json({ error: reason, code: 'QR_NOT_CONFIGURED' }, { status: 503 })
  }
  return errorResponse(error, 'Unable to manage QR check-in.')
}

async function loadContext(id: string) {
  const db = database()
  const [row] = await db.select({
    session: attendanceSessions,
    entry: timetableEntries,
    version: timetableVersions,
  }).from(attendanceSessions)
    .innerJoin(timetableEntries, eq(timetableEntries.id, attendanceSessions.timetableEntryId))
    .innerJoin(timetableVersions, eq(timetableVersions.id, attendanceSessions.timetableVersionId))
    .where(eq(attendanceSessions.id, id))
    .limit(1)
  return row || null
}

async function authorize(request: Request, rawId: string) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return { error: auth.error } as const
  const parsedId = idSchema.safeParse(rawId)
  if (!parsedId.success) return { error: Response.json({ error: 'Invalid attendance session.' }, { status: 400 }) } as const
  const context = await loadContext(parsedId.data)
  if (!context) return { error: Response.json({ error: 'Attendance session not found.' }, { status: 404 }) } as const
  const administrator = await canAdministerOrganization(auth.user, context.session.organizationId)
  if (!administrator && context.entry.teacherUserId !== auth.user.uid) {
    return { error: Response.json({ error: 'Teacher access required.' }, { status: 403 }) } as const
  }
  return { auth, context, id: parsedId.data } as const
}

function windowDto(window: typeof attendanceQrWindows.$inferSelect, checkInCount: number, now: Date) {
  return {
    id: window.id,
    sessionId: window.sessionId,
    openedAt: window.openedAt.toISOString(),
    expiresAt: window.expiresAt.toISOString(),
    closedAt: window.closedAt?.toISOString() || null,
    active: !window.closedAt && window.expiresAt > now,
    checkInCount,
  }
}

async function checkInCount(sessionId: string) {
  const [result] = await database().select({ value: count() })
    .from(attendanceQrCheckIns)
    .where(eq(attendanceQrCheckIns.sessionId, sessionId))
  return result?.value || 0
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params
  const access = await authorize(request, rawId)
  if ('error' in access) return access.error
  try {
    const secret = validateAttendanceQrSecret(process.env.QR_ATTENDANCE_SECRET)
    const now = new Date()
    const [window] = await database().select().from(attendanceQrWindows)
      .where(and(
        eq(attendanceQrWindows.sessionId, access.id),
        isNull(attendanceQrWindows.closedAt),
      ))
      .orderBy(desc(attendanceQrWindows.openedAt))
      .limit(1)
    if (!window || window.expiresAt <= now || access.context.session.status !== 'draft') {
      return Response.json({ window: window ? windowDto(window, await checkInCount(access.id), now) : null }, {
        headers: { 'cache-control': 'no-store' },
      })
    }
    const tokenExpiresAt = new Date(Math.min(
      attendanceQrTokenExpiry(now).getTime(),
      window.expiresAt.getTime(),
    ))
    const token = signAttendanceQrToken({
      sessionId: access.id,
      windowId: window.id,
      expiresAt: tokenExpiresAt.getTime(),
    }, secret)
    const url = new URL('/attendance/check-in', appBaseUrl())
    url.searchParams.set('token', token)
    return Response.json({
      window: windowDto(window, await checkInCount(access.id), now),
      checkInUrl: url.toString(),
      tokenExpiresAt: tokenExpiresAt.toISOString(),
    }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return qrError(error)
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params
  const access = await authorize(request, rawId)
  if ('error' in access) return access.error
  try {
    validateAttendanceQrSecret(process.env.QR_ATTENDANCE_SECRET)
    if (access.context.session.status !== 'draft') {
      return Response.json({ error: 'QR check-in is available only for a draft attendance register.' }, { status: 409 })
    }
    const now = new Date()
    const expiresAt = attendanceQrWindowExpiry({
      classDate: access.context.session.classDate,
      startTime: access.context.entry.startTime,
      endTime: access.context.entry.endTime,
      timeZone: access.context.version.timeZone,
      now,
    })
    const window = await database().transaction(async tx => {
      const [lockedSession] = await tx.select().from(attendanceSessions)
        .where(eq(attendanceSessions.id, access.id))
        .for('update')
      if (!lockedSession || lockedSession.status !== 'draft') throw new Error('QR_SESSION_NOT_DRAFT')
      const [current] = await tx.select().from(attendanceQrWindows).where(and(
        eq(attendanceQrWindows.sessionId, access.id),
        isNull(attendanceQrWindows.closedAt),
      )).orderBy(desc(attendanceQrWindows.openedAt)).limit(1)
      if (current && current.expiresAt > now) return current
      if (current) {
        await tx.update(attendanceQrWindows).set({ closedAt: now }).where(eq(attendanceQrWindows.id, current.id))
      }
      const [created] = await tx.insert(attendanceQrWindows).values({
        sessionId: access.id,
        openedBy: access.auth.user.uid,
        openedAt: now,
        expiresAt,
      }).returning()
      return created
    })
    console.info(JSON.stringify({ event: 'attendance_qr_window_started', sessionId: access.id, windowId: window.id }))
    return Response.json({ window: windowDto(window, await checkInCount(access.id), now) }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'QR_SESSION_NOT_DRAFT') {
      return Response.json({ error: 'QR check-in is available only for a draft attendance register.' }, { status: 409 })
    }
    return qrError(error)
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params
  const access = await authorize(request, rawId)
  if ('error' in access) return access.error
  try {
    const now = new Date()
    const [closed] = await database().transaction(async tx => {
      await tx.select({ id: attendanceSessions.id }).from(attendanceSessions)
        .where(eq(attendanceSessions.id, access.id))
        .for('update')
      return tx.update(attendanceQrWindows).set({
        closedAt: now,
        closedBy: access.auth.user.uid,
      }).where(and(
        eq(attendanceQrWindows.sessionId, access.id),
        isNull(attendanceQrWindows.closedAt),
      )).returning()
    })
    if (closed) {
      console.info(JSON.stringify({ event: 'attendance_qr_window_closed', sessionId: access.id, windowId: closed.id }))
    }
    return Response.json({ closed: Boolean(closed) })
  } catch (error) {
    return qrError(error)
  }
}
