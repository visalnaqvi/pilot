import {
  daysForTimetableEntry,
  validDateKey,
  weekdayForDate,
  type TimetableEntry,
} from './timetable'

export type AttendanceMark = 'present' | 'absent' | 'unmarked'
export type AttendanceSessionStatus = 'draft' | 'submitted' | 'cancelled'

export type AttendanceRosterEntry = {
  userId: string
  userName: string
  userEmail: string
  status: AttendanceMark
  qrCheckedInAt?: string | null
}

export type AttendanceQrWindow = {
  id: string
  sessionId: string
  openedAt: string
  expiresAt: string
  closedAt?: string | null
  active: boolean
  checkInCount: number
}

export type AttendanceSession = {
  id: string
  organisationId: string
  organisationName: string
  timetableId: string
  timetableName: string
  timetableRevision: number
  entryId: string
  subject: string
  classDate: string
  startTime: string
  endTime: string
  teacherUserId?: string
  teacher?: string
  timeZone: string
  rosterUserIds: string[]
  roster: AttendanceRosterEntry[]
  status: AttendanceSessionStatus
  presentCount: number
  absentCount: number
  cancellationReason?: string
  revision: number
  createdBy: string
  updatedBy: string
  createdAt?: unknown
  updatedAt?: unknown
  submittedAt?: unknown
  cancelledAt?: unknown
}

export type AttendanceSummary = {
  present: number
  absent: number
  submittedSessions: number
  cancelledSessions: number
  draftSessions: number
  pendingSessions: number
  percentage: number | null
}

export function attendanceSessionId(timetableId: string, entryId: string, classDate: string) {
  return `${timetableId}__${entryId}__${classDate}`
}

export function attendanceCounts(roster: AttendanceRosterEntry[]) {
  return roster.reduce((counts, entry) => {
    if (entry.status === 'present') counts.present += 1
    if (entry.status === 'absent') counts.absent += 1
    return counts
  }, { present: 0, absent: 0 })
}

export function attendancePercentage(present: number, absent: number) {
  const total = present + absent
  return total ? present / total * 100 : null
}

export function attendanceSummary(
  sessions: Pick<AttendanceSession, 'status' | 'presentCount' | 'absentCount'>[],
  pendingSessions = 0,
): AttendanceSummary {
  const submitted = sessions.filter(session => session.status === 'submitted')
  const present = submitted.reduce((sum, session) => sum + session.presentCount, 0)
  const absent = submitted.reduce((sum, session) => sum + session.absentCount, 0)
  return {
    present,
    absent,
    submittedSessions: submitted.length,
    cancelledSessions: sessions.filter(session => session.status === 'cancelled').length,
    draftSessions: sessions.filter(session => session.status === 'draft').length,
    pendingSessions,
    percentage: attendancePercentage(present, absent),
  }
}

export function attendanceSeries(
  sessions: Pick<AttendanceSession, 'classDate' | 'status' | 'presentCount' | 'absentCount'>[],
) {
  const dates = new Map<string, { date: string; present: number; absent: number; percentage: number | null }>()
  sessions.filter(session => session.status === 'submitted').forEach(session => {
    const item = dates.get(session.classDate) || {
      date: session.classDate,
      present: 0,
      absent: 0,
      percentage: null,
    }
    item.present += session.presentCount
    item.absent += session.absentCount
    item.percentage = attendancePercentage(item.present, item.absent)
    dates.set(session.classDate, item)
  })
  return [...dates.values()].sort((first, second) => first.date.localeCompare(second.date))
}

export function isScheduledOccurrence(input: {
  classDate: string
  effectiveFrom: string
  effectiveTo: string
  entry: TimetableEntry
}) {
  return validDateKey(input.classDate)
    && input.classDate >= input.effectiveFrom
    && input.classDate <= input.effectiveTo
    && daysForTimetableEntry(input.entry).includes(weekdayForDate(input.classDate))
}
