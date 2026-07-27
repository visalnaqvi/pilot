import assert from 'node:assert/strict'
import test from 'node:test'
import { attemptsForAssignment, type AssignmentScopedSubmission } from '../lib/assignment-attempts'

const assignment = {
  id: 'assignment-a',
  testId: 'test-a',
  assignedUserIds: ['assigned-user', 'pending-user'],
}

test('assignment attempts include only submissions carrying the exact assignment batch ID', () => {
  const submissions: Array<AssignmentScopedSubmission & { id: string; attemptNumber: number }> = [
    { id: 'private-before', testId: 'test-a', userId: 'assigned-user', testVisibility: 'private', attemptNumber: 1 },
    { id: 'assigned-1', testId: 'test-a', userId: 'assigned-user', testVisibility: 'assigned', assignmentBatchId: 'assignment-a', attemptNumber: 1 },
    { id: 'assigned-2', testId: 'test-a', userId: 'assigned-user', testVisibility: 'assigned', assignmentBatchId: 'assignment-a', attemptNumber: 2 },
    { id: 'private-after', testId: 'test-a', userId: 'assigned-user', testVisibility: 'private', attemptNumber: 2 },
    { id: 'other-batch', testId: 'test-a', userId: 'assigned-user', testVisibility: 'assigned', assignmentBatchId: 'assignment-b', attemptNumber: 1 },
    { id: 'private-with-forged-batch', testId: 'test-a', userId: 'assigned-user', testVisibility: 'private', assignmentBatchId: 'assignment-a', attemptNumber: 3 },
    { id: 'unassigned-user', testId: 'test-a', userId: 'other-user', testVisibility: 'assigned', assignmentBatchId: 'assignment-a', attemptNumber: 1 },
    { id: 'other-test', testId: 'test-b', userId: 'assigned-user', testVisibility: 'assigned', assignmentBatchId: 'assignment-a', attemptNumber: 1 },
  ]

  assert.deepEqual(
    attemptsForAssignment(assignment, submissions).map((submission) => submission.id),
    ['assigned-1', 'assigned-2'],
  )
})

test('assignment attempts do not infer legacy submissions from user, test, or dates', () => {
  const submissions = [
    { id: 'legacy-no-batch', testId: 'test-a', userId: 'assigned-user' },
  ]

  assert.deepEqual(attemptsForAssignment(assignment, submissions), [])
})
