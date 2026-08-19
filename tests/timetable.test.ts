import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDays,
  enumerateTimetableDates,
  entriesForDate,
  localDateKey,
  localDateTimeToDate,
  timetableEntryOverlaps,
  type TimetableEntry,
} from '../lib/timetable'
import { timetableInputSchema } from '../lib/timetable-schema'
import { createTimetablePayloadSchema, timetablePayloadSchema } from '../lib/timetable-api-schema'
import {
  planTimetableAgendaJobs,
  timetableAgendaJobId,
} from '../lib/timetable-email-plan'
import { buildTimetableAgendaEmail } from '../lib/timetable-email-content'

const monday: TimetableEntry = {
  id: 'class-a',
  subject: 'Quantitative Aptitude',
  weekdays: [1],
  startTime: '09:00',
  endTime: '10:00',
  teacher: 'A. Teacher',
  location: 'Room 2',
  meetingUrl: '',
  notes: '',
}

test('timetable schema validates dates, audiences, URLs, and internal overlaps', () => {
  const valid = {
    name: 'Banking Batch A',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-02-01',
    selectedUserIds: ['student-1'],
    selectedGroupIds: [],
    entries: [monday],
  }
  assert.equal(timetableInputSchema.safeParse(valid).success, true)
  assert.equal(timetableInputSchema.safeParse({
    ...valid,
    effectiveTo: '2025-12-31',
  }).success, false)
  assert.equal(timetableInputSchema.safeParse({
    ...valid,
    selectedUserIds: [],
  }).success, false)
  assert.equal(timetableInputSchema.safeParse({
    ...valid,
    entries: [{ ...monday, meetingUrl: 'javascript:alert(1)' }],
  }).success, false)
  assert.equal(timetableInputSchema.safeParse({
    ...valid,
    entries: [{ ...monday, teacherUserId: 'teacher-1', teacher: 'Teacher One' }],
  }).success, true)

  const overlapping = [
    monday,
    { ...monday, id: 'class-b', subject: 'Reasoning', startTime: '09:30', endTime: '10:30' },
  ]
  assert.deepEqual(timetableEntryOverlaps(overlapping), [['class-a', 'class-b']])
  assert.equal(timetableInputSchema.safeParse({ ...valid, entries: overlapping }).success, false)
})

test('create and edit timetable APIs share timezone-compatible validation', () => {
  const payload = {
    name: 'Banking Batch A',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-02-01',
    selectedUserIds: ['student-1'],
    selectedGroupIds: [],
    entries: [monday],
  }
  assert.equal(timetablePayloadSchema.parse(payload).timeZone, 'Asia/Kolkata')
  assert.equal(createTimetablePayloadSchema.parse({
    ...payload,
    organizationId: '11111111-1111-4111-8111-111111111111',
  }).timeZone, 'Asia/Kolkata')
  assert.equal(timetablePayloadSchema.parse({ ...payload, timeZone: 'Asia/Dubai' }).timeZone, 'Asia/Dubai')
})

test('weekly date expansion includes range endpoints and crosses year boundaries', () => {
  const dates = enumerateTimetableDates({
    effectiveFrom: '2025-12-29',
    effectiveTo: '2026-01-12',
    entries: [monday],
  })
  assert.deepEqual(dates, ['2025-12-29', '2026-01-05', '2026-01-12'])
  assert.equal(addDays('2025-12-31', 1), '2026-01-01')
  assert.deepEqual(entriesForDate([monday], '2026-01-05').map(entry => entry.id), ['class-a'])
  assert.deepEqual(entriesForDate([monday], '2026-01-06'), [])
})

test('one class can repeat on multiple selected weekdays', () => {
  const multiDay = { ...monday, weekdays: [1, 3, 5] }
  const dates = enumerateTimetableDates({
    effectiveFrom: '2026-01-05',
    effectiveTo: '2026-01-11',
    entries: [multiDay],
  })
  assert.deepEqual(dates, ['2026-01-05', '2026-01-07', '2026-01-09'])
  assert.deepEqual(entriesForDate([multiDay], '2026-01-07').map(entry => entry.id), ['class-a'])
  assert.equal(timetableInputSchema.safeParse({
    name: 'Legacy timetable',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-02-01',
    selectedUserIds: ['student-1'],
    selectedGroupIds: [],
    entries: [{ ...monday, weekdays: undefined, weekday: 1 }],
  }).success, true)
})

test('Asia/Kolkata morning jobs are planned for 7 AM local time and remain idempotently named', () => {
  const now = new Date('2025-12-28T00:00:00.000Z')
  const jobs = planTimetableAgendaJobs({
    organisationId: 'org-1',
    effectiveFrom: '2025-12-29',
    effectiveTo: '2026-01-05',
    entries: [monday],
    timeZone: 'Asia/Kolkata',
    now,
  })
  assert.deepEqual(jobs.map(job => [job.id, job.dueAt.toISOString()]), [
    ['agenda:org-1:2025-12-29', '2025-12-29T01:30:00.000Z'],
    ['agenda:org-1:2026-01-05', '2026-01-05T01:30:00.000Z'],
  ])
  assert.equal(localDateKey(new Date('2026-01-05T01:30:00.000Z'), 'Asia/Kolkata'), '2026-01-05')
  assert.equal(localDateTimeToDate('2026-01-05', '07:00', 'Asia/Kolkata').toISOString(), '2026-01-05T01:30:00.000Z')
  assert.equal(timetableAgendaJobId('org-1', '2026-01-05'), 'agenda:org-1:2026-01-05')
})

test('a timetable published after 7 AM does not queue a late agenda for that day', () => {
  const jobs = planTimetableAgendaJobs({
    organisationId: 'org-1',
    effectiveFrom: '2026-01-05',
    effectiveTo: '2026-01-12',
    entries: [monday],
    timeZone: 'Asia/Kolkata',
    now: new Date('2026-01-05T01:31:00.000Z'),
  })
  assert.deepEqual(jobs.map(job => [job.id, job.dueAt.toISOString()]), [
    ['agenda:org-1:2026-01-12', '2026-01-12T01:30:00.000Z'],
  ])
})

test('morning timetable emails aggregate agenda rows and escape user-controlled HTML', () => {
  const agenda = buildTimetableAgendaEmail({
    recipientName: '<Student>',
    organisationName: 'Institute',
    localDate: '2026-01-05',
    entries: [
      { ...monday, timetableName: 'Batch A' },
      { ...monday, id: 'class-b', subject: '<Reasoning>', startTime: '11:00', endTime: '12:00', timetableName: 'Batch B' },
    ],
    actionUrl: 'https://example.com/timetables',
  })
  assert.match(agenda.subject, /2 classes today/)
  assert.match(agenda.text, /09:00–10:00/)
  assert.match(agenda.text, /11:00–12:00/)
  assert.doesNotMatch(agenda.html, /<Student>/)
  assert.match(agenda.html, /&lt;Student&gt;/)
  assert.doesNotMatch(agenda.html, /<Reasoning>/)
  assert.match(agenda.html, /&lt;Reasoning&gt;/)
})

test('morning timetable notification copies describe the institute-wide agenda', () => {
  const agenda = buildTimetableAgendaEmail({
    recipientName: 'Example Institute',
    notificationCopy: true,
    organisationName: 'Example Institute',
    localDate: '2026-01-05',
    entries: [{ ...monday, timetableName: 'Batch A' }],
    actionUrl: 'https://example.com/timetables',
  })
  assert.match(agenda.text, /institute class agenda/)
  assert.match(agenda.html, /The institute has 1 scheduled class today/)
  assert.doesNotMatch(agenda.html, /Your classes/)
})
