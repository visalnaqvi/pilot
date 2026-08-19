import { createHmac, timingSafeEqual } from 'node:crypto'
import { localDateTimeToDate } from './timetable'
import {
  ATTENDANCE_QR_EARLY_START_MS,
  ATTENDANCE_QR_LATE_END_MS,
  ATTENDANCE_QR_MIN_SECRET_BYTES,
  ATTENDANCE_QR_TOKEN_TTL_MS,
  ATTENDANCE_QR_WINDOW_MS,
} from './attendance-qr-config'

export { ATTENDANCE_QR_TOKEN_TTL_MS } from './attendance-qr-config'

export type AttendanceQrTokenPayload = {
  v: 1
  sessionId: string
  windowId: string
  expiresAt: number
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function validateAttendanceQrSecret(secret: string | undefined) {
  const value = secret?.trim() || ''
  if (Buffer.byteLength(value, 'utf8') < ATTENDANCE_QR_MIN_SECRET_BYTES) {
    throw new Error('QR attendance is not configured. Set QR_ATTENDANCE_SECRET to at least 32 random bytes.')
  }
  return value
}

function encode(value: string | Buffer) {
  return Buffer.from(value).toString('base64url')
}

function signature(encodedPayload: string, secret: string) {
  return createHmac('sha256', secret).update(encodedPayload).digest()
}

export function signAttendanceQrToken(
  input: Omit<AttendanceQrTokenPayload, 'v'>,
  secret: string,
) {
  const signingSecret = validateAttendanceQrSecret(secret)
  const payload: AttendanceQrTokenPayload = { v: 1, ...input }
  const encodedPayload = encode(JSON.stringify(payload))
  return `${encodedPayload}.${encode(signature(encodedPayload, signingSecret))}`
}

export function verifyAttendanceQrToken(input: {
  token: string
  secret: string
  now?: Date
  expectedSessionId?: string
}) {
  const signingSecret = validateAttendanceQrSecret(input.secret)
  const [encodedPayload, encodedSignature, extra] = input.token.split('.')
  if (!encodedPayload || !encodedSignature || extra) throw new Error('INVALID_QR_TOKEN')

  let suppliedSignature: Buffer
  let payload: AttendanceQrTokenPayload
  try {
    suppliedSignature = Buffer.from(encodedSignature, 'base64url')
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as AttendanceQrTokenPayload
  } catch {
    throw new Error('INVALID_QR_TOKEN')
  }

  const expectedSignature = signature(encodedPayload, signingSecret)
  if (
    suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)
  ) throw new Error('INVALID_QR_TOKEN')

  if (
    payload.v !== 1
    || !uuidPattern.test(payload.sessionId)
    || !uuidPattern.test(payload.windowId)
    || !Number.isSafeInteger(payload.expiresAt)
  ) throw new Error('INVALID_QR_TOKEN')
  if (input.expectedSessionId && payload.sessionId !== input.expectedSessionId) {
    throw new Error('INVALID_QR_TOKEN')
  }
  if (payload.expiresAt <= (input.now || new Date()).getTime()) throw new Error('QR_TOKEN_EXPIRED')
  return payload
}

export function attendanceQrTokenExpiry(now = new Date()) {
  return new Date(now.getTime() + ATTENDANCE_QR_TOKEN_TTL_MS)
}

export function attendanceQrAllowedRange(input: {
  classDate: string
  startTime: string
  endTime: string
  timeZone: string
}) {
  const classStartsAt = localDateTimeToDate(input.classDate, input.startTime.slice(0, 5), input.timeZone)
  const classEndsAt = localDateTimeToDate(input.classDate, input.endTime.slice(0, 5), input.timeZone)
  return {
    opensAt: new Date(classStartsAt.getTime() - ATTENDANCE_QR_EARLY_START_MS),
    closesAt: new Date(classEndsAt.getTime() + ATTENDANCE_QR_LATE_END_MS),
  }
}

export function attendanceQrWindowExpiry(input: {
  classDate: string
  startTime: string
  endTime: string
  timeZone: string
  now?: Date
}) {
  const now = input.now || new Date()
  const range = attendanceQrAllowedRange(input)
  if (now < range.opensAt) throw new Error('QR_WINDOW_TOO_EARLY')
  if (now >= range.closesAt) throw new Error('QR_WINDOW_TOO_LATE')
  return new Date(Math.min(now.getTime() + ATTENDANCE_QR_WINDOW_MS, range.closesAt.getTime()))
}
