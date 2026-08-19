import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  ATTENDANCE_QR_TOKEN_TTL_MS,
  attendanceQrAllowedRange,
  attendanceQrTokenExpiry,
  attendanceQrWindowExpiry,
  signAttendanceQrToken,
  validateAttendanceQrSecret,
  verifyAttendanceQrToken,
} from '../lib/attendance-qr'
import { safeReturnTo } from '../lib/auth-return'

const secret = 'qr-attendance-test-secret-32-bytes-minimum'
const sessionId = '11111111-1111-4111-8111-111111111111'
const windowId = '22222222-2222-4222-8222-222222222222'

test('attendance QR tokens are signed, scoped, short-lived, and tamper evident', () => {
  const now = new Date('2026-08-19T03:30:00.000Z')
  const expiresAt = attendanceQrTokenExpiry(now)
  assert.equal(expiresAt.getTime() - now.getTime(), ATTENDANCE_QR_TOKEN_TTL_MS)
  const token = signAttendanceQrToken({ sessionId, windowId, expiresAt: expiresAt.getTime() }, secret)
  assert.deepEqual(verifyAttendanceQrToken({ token, secret, now }), {
    v: 1,
    sessionId,
    windowId,
    expiresAt: expiresAt.getTime(),
  })
  assert.throws(() => verifyAttendanceQrToken({
    token,
    secret,
    now,
    expectedSessionId: '33333333-3333-4333-8333-333333333333',
  }), /INVALID_QR_TOKEN/)
  assert.throws(() => verifyAttendanceQrToken({
    token: `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`,
    secret,
    now,
  }), /INVALID_QR_TOKEN/)
  assert.throws(() => verifyAttendanceQrToken({ token, secret, now: expiresAt }), /QR_TOKEN_EXPIRED/)
})

test('attendance QR signing requires a server secret of at least 32 bytes', () => {
  assert.equal(validateAttendanceQrSecret(secret), secret)
  assert.throws(() => validateAttendanceQrSecret('too-short'), /not configured/)
  assert.throws(() => validateAttendanceQrSecret(undefined), /not configured/)
})

test('QR windows respect timetable timezone and class boundaries', () => {
  const classInput = {
    classDate: '2026-08-19',
    startTime: '09:00:00',
    endTime: '10:00:00',
    timeZone: 'Asia/Kolkata',
  }
  const range = attendanceQrAllowedRange(classInput)
  assert.equal(range.opensAt.toISOString(), '2026-08-19T03:15:00.000Z')
  assert.equal(range.closesAt.toISOString(), '2026-08-19T05:00:00.000Z')
  assert.throws(() => attendanceQrWindowExpiry({
    ...classInput,
    now: new Date('2026-08-19T03:14:59.999Z'),
  }), /QR_WINDOW_TOO_EARLY/)
  assert.equal(attendanceQrWindowExpiry({
    ...classInput,
    now: new Date('2026-08-19T03:15:00.000Z'),
  }).toISOString(), '2026-08-19T03:25:00.000Z')
  assert.equal(attendanceQrWindowExpiry({
    ...classInput,
    now: new Date('2026-08-19T04:55:00.000Z'),
  }).toISOString(), '2026-08-19T05:00:00.000Z')
  assert.throws(() => attendanceQrWindowExpiry({
    ...classInput,
    now: new Date('2026-08-19T05:00:00.000Z'),
  }), /QR_WINDOW_TOO_LATE/)
})

test('login return paths stay local and preserve the QR query', () => {
  assert.equal(
    safeReturnTo('/attendance/check-in?token=payload.signature'),
    '/attendance/check-in?token=payload.signature',
  )
  assert.equal(safeReturnTo('https://evil.example/steal'), '/dashboard')
  assert.equal(safeReturnTo('//evil.example/steal'), '/dashboard')
  assert.equal(safeReturnTo(undefined), '/dashboard')
})

test('QR redemption is actor-bound, roster-bound, and transactionally locked', () => {
  const route = readFileSync(join(
    process.cwd(), 'app', 'api', 'attendance', 'check-in', 'route.ts',
  ), 'utf8')
  assert.match(route, /auth\.actor\.uid !== auth\.user\.uid/)
  assert.match(route, /organizationMemberships\.role, 'student'/)
  assert.match(route, /attendanceMarks\.userId, auth\.user\.uid/)
  assert.match(route, /\.for\('update'\)/)
  assert.doesNotMatch(route, /userId:\s*parsed\.data/)
})

test('QR window controls are limited to the assigned teacher or organization administrator', () => {
  const route = readFileSync(join(
    process.cwd(), 'app', 'api', 'attendance', 'sessions', '[id]', 'qr-window', 'route.ts',
  ), 'utf8')
  assert.match(route, /canAdministerOrganization/)
  assert.match(route, /context\.entry\.teacherUserId !== auth\.user\.uid/)
  assert.doesNotMatch(route, /canManageOrganization/)
})
