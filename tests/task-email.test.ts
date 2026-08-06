import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTaskEmail, escapeHtml, isEmailAddress } from '../lib/task-email-content'
import {
  planTaskEmailJobs,
  retryAtForAttempt,
  taskEmailJobKind,
  taskEmailSkipReason,
} from '../lib/task-email-plan'

test('task email planner creates assigned, start, reminder, and ended jobs', () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z')
  const jobs = planTaskEmailJobs({
    taskId: 'task-a',
    createdAt,
    startAt: new Date('2026-01-02T00:00:00.000Z'),
    endAt: new Date('2026-01-04T00:00:00.000Z'),
  })
  assert.deepEqual(jobs.map(job => [job.eventType, job.dueAt.toISOString()]), [
    ['assigned', '2026-01-01T00:00:00.000Z'],
    ['start', '2026-01-02T00:00:00.000Z'],
    ['deadline-24h', '2026-01-03T00:00:00.000Z'],
    ['deadline-1h', '2026-01-03T23:00:00.000Z'],
    ['ended', '2026-01-04T00:00:00.000Z'],
  ])
})

test('task email planner omits passed start and reminder times', () => {
  const createdAt = new Date('2026-01-01T12:00:00.000Z')
  const jobs = planTaskEmailJobs({
    taskId: 'task-b',
    createdAt,
    startAt: createdAt,
    endAt: new Date('2026-01-01T12:30:00.000Z'),
  })
  assert.deepEqual(jobs.map(job => job.eventType), ['assigned', 'ended'])
})

test('task email planner handles undated tasks and retry backoff', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')
  assert.deepEqual(planTaskEmailJobs({ taskId: 'task-c', createdAt: now }).map(job => job.eventType), ['assigned'])
  assert.equal(retryAtForAttempt(1, now).toISOString(), '2026-01-01T00:01:00.000Z')
  assert.equal(retryAtForAttempt(2, now).toISOString(), '2026-01-01T00:05:00.000Z')
  assert.equal(retryAtForAttempt(3, now).toISOString(), '2026-01-01T00:15:00.000Z')
  assert.equal(retryAtForAttempt(4, now).toISOString(), '2026-01-01T01:00:00.000Z')
  assert.equal(retryAtForAttempt(5, now).toISOString(), '2026-01-01T01:00:00.000Z')
})

test('task and assignment jobs use stable Postgres worker kinds', () => {
  assert.equal(taskEmailJobKind('task', 'assigned'), 'task_assigned')
  assert.equal(taskEmailJobKind('task', 'deadline-24h'), 'task_deadline_24h')
  assert.equal(taskEmailJobKind('assignment', 'deadline-1h'), 'assignment_deadline_1h')
})

test('delivery policy skips manual closures and completed reminders', () => {
  assert.equal(taskEmailSkipReason({
    eventType: 'start',
    manuallyClosed: true,
    submitted: false,
  }), 'task-manually-closed')
  assert.equal(taskEmailSkipReason({
    eventType: 'deadline-1h',
    manuallyClosed: false,
    assigneeStatus: 'done',
    submitted: false,
  }), 'assignee-complete')
  assert.equal(taskEmailSkipReason({
    eventType: 'ended',
    manuallyClosed: false,
    assigneeStatus: 'todo',
    submitted: true,
  }), 'assignee-complete')
  assert.equal(taskEmailSkipReason({
    eventType: 'ended',
    manuallyClosed: false,
    assigneeStatus: 'todo',
    submitted: false,
  }), null)
})

test('email templates escape user content and include text fallback', () => {
  const email = buildTaskEmail({
    eventType: 'assigned',
    recipientName: '<Student>',
    taskTitle: 'Safety & "Quality"',
    organisationName: 'Example <Org>',
    description: '<script>alert(1)</script>',
    startAt: new Date('2026-01-02T10:00:00.000Z'),
    endAt: new Date('2026-01-03T10:00:00.000Z'),
    actionUrl: 'https://example.com/tasks',
    timeZone: 'UTC',
    now: new Date('2026-01-01T00:00:00.000Z'),
  })
  assert.match(email.text, /Safety & "Quality"/)
  assert.doesNotMatch(email.html, /<script>/)
  assert.match(email.html, /&lt;script&gt;/)
  assert.equal(escapeHtml(`<&"'`), '&lt;&amp;&quot;&#039;')
  assert.equal(isEmailAddress('student@example.com'), true)
  assert.equal(isEmailAddress('not-an-email'), false)
})

test('organization notification copies describe the assignment audience', () => {
  const email = buildTaskEmail({
    eventType: 'assigned',
    itemType: 'assignment',
    notificationCopy: true,
    recipientName: 'Example Institute',
    taskTitle: 'Weekly mock test',
    organisationName: 'Example Institute',
    audienceName: 'Batch A',
    startAt: new Date('2026-01-02T10:00:00.000Z'),
    endAt: new Date('2026-01-03T10:00:00.000Z'),
    actionUrl: 'https://example.com/tests/test-a',
    timeZone: 'UTC',
    now: new Date('2026-01-01T00:00:00.000Z'),
  })
  assert.equal(email.subject, 'New assignment: Weekly mock test')
  assert.match(email.text, /assigned to Batch A/)
  assert.match(email.text, /Audience: Batch A/)
  assert.match(email.html, /A new assignment was assigned/)
})
