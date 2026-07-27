import assert from 'node:assert/strict'
import test from 'node:test'
import { isAssignmentWindowOpen } from '../lib/assignment-window'

const timestamp = (value: string) => ({ toDate: () => new Date(value) })
const now = new Date('2026-07-27T12:00:00.000Z').getTime()

test('assignment test documents are fetched only while an attempt window is open', () => {
  assert.equal(isAssignmentWindowOpen({
    startAt: timestamp('2026-07-27T11:00:00.000Z'),
    deadline: timestamp('2026-07-27T13:00:00.000Z'),
    attemptsUsed: 1,
    maxAttempts: 2,
  }, now), true)

  assert.equal(isAssignmentWindowOpen({
    startAt: timestamp('2026-07-27T12:30:00.000Z'),
    deadline: timestamp('2026-07-27T13:00:00.000Z'),
  }, now), false)

  assert.equal(isAssignmentWindowOpen({
    startAt: timestamp('2026-07-27T10:00:00.000Z'),
    deadline: timestamp('2026-07-27T11:59:59.000Z'),
  }, now), false)

  assert.equal(isAssignmentWindowOpen({
    startAt: timestamp('2026-07-27T10:00:00.000Z'),
    deadline: timestamp('2026-07-27T13:00:00.000Z'),
    attemptsUsed: 2,
    maxAttempts: 2,
  }, now), false)
})
