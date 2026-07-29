import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSubmissionAccess } from '../lib/submission-access'

test('an organisation can view submissions included in its organisation audience', () => {
  assert.deepEqual(resolveSubmissionAccess(
    { uid: 'org-a', role: 'organisation' },
    {
      userId: 'learner',
      gradingOwnerId: 'org-b',
      organisationIds: ['org-a', 'org-b'],
    },
  ), {
    reviewer: false,
    canView: true,
  })
})

test('only the test-owning organisation can review and grade a submission', () => {
  assert.deepEqual(resolveSubmissionAccess(
    { uid: 'org-a', role: 'organisation' },
    {
      userId: 'learner',
      gradingOwnerId: 'org-a',
      organisationIds: ['org-a'],
    },
  ), {
    reviewer: true,
    canView: true,
  })
})

test('another organisation cannot view a submission outside its audience', () => {
  assert.deepEqual(resolveSubmissionAccess(
    { uid: 'org-c', role: 'organisation' },
    {
      userId: 'learner',
      gradingOwnerId: 'org-a',
      organisationIds: ['org-a'],
    },
  ), {
    reviewer: false,
    canView: false,
  })
})

test('learners can view their own submission and administrators can review all submissions', () => {
  assert.equal(resolveSubmissionAccess(
    { uid: 'learner', role: 'user' },
    { userId: 'learner' },
  ).canView, true)
  assert.deepEqual(resolveSubmissionAccess(
    { uid: 'admin', role: 'admin' },
    { userId: 'learner' },
  ), {
    reviewer: true,
    canView: true,
  })
})
