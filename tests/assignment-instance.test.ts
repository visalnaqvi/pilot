import assert from 'node:assert/strict'
import test from 'node:test'
import { assignmentInstanceId, selectAssignmentInstance } from '../lib/assignment-instance'

const now = new Date('2026-07-27T12:00:00.000Z').getTime()
const candidate = (
  assignmentBatchId: string,
  startAt: string,
  deadline: string,
  attemptsUsed = 0,
  maxAttempts = 1,
) => ({
  assignmentBatchId,
  startAt: new Date(startAt),
  deadline: new Date(deadline),
  attemptsUsed,
  maxAttempts,
})

test('assignment instances use the batch and user rather than the shared test ID', () => {
  assert.equal(assignmentInstanceId('assignment-a', 'user-1'), 'assignment-a_user-1')
  assert.equal(assignmentInstanceId('assignment-b', 'user-1'), 'assignment-b_user-1')
})

test('an open assignment wins over a later assignment using the same test', () => {
  const selected = selectAssignmentInstance([
    candidate('assignment-b', '2026-07-28T12:00:00.000Z', '2026-07-28T13:00:00.000Z'),
    candidate('assignment-a', '2026-07-27T11:00:00.000Z', '2026-07-27T13:00:00.000Z'),
  ], now)

  assert.equal(selected?.assignmentBatchId, 'assignment-a')
})

test('the next upcoming assignment is selected when none is currently open', () => {
  const selected = selectAssignmentInstance([
    candidate('later', '2026-07-29T12:00:00.000Z', '2026-07-29T13:00:00.000Z'),
    candidate('next', '2026-07-28T12:00:00.000Z', '2026-07-28T13:00:00.000Z'),
  ], now)

  assert.equal(selected?.assignmentBatchId, 'next')
})
