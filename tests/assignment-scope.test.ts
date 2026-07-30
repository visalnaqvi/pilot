import assert from 'node:assert/strict'
import test from 'node:test'
import { assignmentMatchesOrganisation } from '../lib/assignment-scope'

test('current assignment batches are scoped by organisationId', () => {
  assert.equal(assignmentMatchesOrganisation({
    organisationId: 'institute-a',
    assignedBy: 'teacher-a',
  }, 'institute-a'), true)
  assert.equal(assignmentMatchesOrganisation({
    organisationId: 'institute-b',
    assignedBy: 'institute-a',
  }, 'institute-a'), false)
})

test('legacy assignment batches fall back to the institute assigner', () => {
  assert.equal(assignmentMatchesOrganisation({
    assignedBy: 'institute-a',
  }, 'institute-a'), true)
  assert.equal(assignmentMatchesOrganisation({
    assignedBy: 'institute-b',
  }, 'institute-a'), false)
})
