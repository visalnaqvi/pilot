export function attendanceAbsenceEmailJobKey(sessionId: string, userId: string) {
  return `attendance:${sessionId}:absent:${userId}`
}
