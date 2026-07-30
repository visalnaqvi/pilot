import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attendanceCounts,
  attendancePercentage,
  attendanceSeries,
  attendanceSessionId,
  attendanceSummary,
  isScheduledOccurrence,
  type AttendanceSession,
} from '../lib/attendance'
import { memberRole, isAcceptedMember } from '../lib/membership'
import { openAttendanceSchema, saveAttendanceSchema } from '../lib/attendance-schema'
import type { TimetableEntry } from '../lib/timetable'

const monday: TimetableEntry = {
  id: 'math-class',
  subject: 'Mathematics',
  weekdays: [1],
  startTime: '09:00',
  endTime: '10:00',
  teacherUserId: 'teacher-1',
  teacher: 'Teacher One',
}

function session(
  classDate: string,
  status: AttendanceSession['status'],
  presentCount: number,
  absentCount: number,
): AttendanceSession {
  return {
    id: attendanceSessionId('timetable-1', 'math-class', classDate),
    organisationId: 'org-1',
    organisationName: 'Institute',
    timetableId: 'timetable-1',
    timetableName: 'Batch A',
    timetableRevision: 1,
    entryId: 'math-class',
    subject: 'Mathematics',
    classDate,
    startTime: '09:00',
    endTime: '10:00',
    teacherUserId: 'teacher-1',
    teacher: 'Teacher One',
    timeZone: 'Asia/Kolkata',
    rosterUserIds: [],
    roster: [],
    status,
    presentCount,
    absentCount,
    revision: 1,
    createdBy: 'teacher-1',
    updatedBy: 'teacher-1',
  }
}

test('attendance occurrences have deterministic IDs and must match the timetable schedule', () => {
  assert.equal(
    attendanceSessionId('timetable-1', 'math-class', '2026-07-27'),
    'timetable-1__math-class__2026-07-27',
  )
  assert.equal(isScheduledOccurrence({
    classDate: '2026-07-27',
    effectiveFrom: '2026-07-01',
    effectiveTo: '2026-07-31',
    entry: monday,
  }), true)
  assert.equal(isScheduledOccurrence({
    classDate: '2026-07-28',
    effectiveFrom: '2026-07-01',
    effectiveTo: '2026-07-31',
    entry: monday,
  }), false)
  assert.equal(isScheduledOccurrence({
    classDate: '2026-08-03',
    effectiveFrom: '2026-07-01',
    effectiveTo: '2026-07-31',
    entry: monday,
  }), false)
})

test('attendance summaries exclude drafts and cancellations from percentages', () => {
  const sessions = [
    session('2026-07-27', 'submitted', 8, 2),
    session('2026-07-28', 'draft', 0, 0),
    session('2026-07-29', 'cancelled', 0, 0),
    session('2026-07-30', 'submitted', 9, 1),
  ]
  assert.deepEqual(attendanceSummary(sessions, 3), {
    present: 17,
    absent: 3,
    submittedSessions: 2,
    cancelledSessions: 1,
    draftSessions: 1,
    pendingSessions: 3,
    percentage: 85,
  })
  assert.equal(attendancePercentage(0, 0), null)
  assert.equal(attendancePercentage(3, 1), 75)
})

test('date series combines multiple submitted sessions on the same date', () => {
  const values = attendanceSeries([
    session('2026-07-27', 'submitted', 8, 2),
    session('2026-07-27', 'submitted', 6, 4),
    session('2026-07-28', 'cancelled', 0, 0),
  ])
  assert.deepEqual(values, [{ date: '2026-07-27', present: 14, absent: 6, percentage: 70 }])
})

test('roster counts and submission validation require complete explicit marks', () => {
  assert.deepEqual(attendanceCounts([
    { userId: 'a', userName: 'A', userEmail: 'a@example.com', status: 'present' },
    { userId: 'b', userName: 'B', userEmail: 'b@example.com', status: 'absent' },
    { userId: 'c', userName: 'C', userEmail: 'c@example.com', status: 'unmarked' },
  ]), { present: 1, absent: 1 })
  assert.equal(saveAttendanceSchema.safeParse({ revision: 0, status: 'submitted', records: [] }).success, false)
  assert.equal(saveAttendanceSchema.safeParse({
    revision: 0,
    status: 'submitted',
    records: [{ userId: 'student-1', status: 'present' }],
  }).success, true)
  assert.equal(saveAttendanceSchema.safeParse({ revision: 0, status: 'cancelled', records: [] }).success, true)
})

test('opening an attendance occurrence defaults to attendance and supports cancellation intent', () => {
  const occurrence = {
    timetableId: 'timetable-1',
    entryId: 'math-class',
    classDate: '2026-07-27',
  }
  const attendance = openAttendanceSchema.parse(occurrence)
  assert.equal(attendance.intent, 'attendance')
  assert.equal(openAttendanceSchema.parse({ ...occurrence, intent: 'cancel' }).intent, 'cancel')
})

test('legacy institute memberships remain students and teacher roles are explicit', () => {
  assert.equal(memberRole(undefined), 'student')
  assert.equal(memberRole('teacher'), 'teacher')
  assert.equal(isAcceptedMember({ status: 'accepted' }, 'student'), true)
  assert.equal(isAcceptedMember({ status: 'accepted', memberRole: 'teacher' }, 'student'), false)
  assert.equal(isAcceptedMember({ status: 'accepted', memberRole: 'teacher' }, 'teacher'), true)
})
