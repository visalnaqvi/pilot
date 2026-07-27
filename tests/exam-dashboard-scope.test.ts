import assert from 'node:assert/strict'
import test from 'node:test'
import { scopeDashboardExams } from '../lib/exam-dashboard-scope'

const exams = [
  { id: 'exam-a', name: 'Exam A', createdBy: 'org-a', organisationIds: ['org-a'] },
  { id: 'exam-b', name: 'Exam B', createdBy: 'org-b', organisationIds: ['org-b'] },
  { id: 'exam-shared', name: 'Shared Exam', createdBy: 'org-a', organisationIds: ['org-a', 'org-b'] },
  { id: 'exam-from-test', name: 'Test Exam', createdBy: 'org-a' },
]

test('organisation dashboards show only explicitly added or test-backed exams', () => {
  const visible = scopeDashboardExams(
    exams,
    [{ examId: 'exam-from-test', exam: 'Test Exam' }],
    'organisation',
    'org-b',
  )

  assert.deepEqual(visible.map(exam => exam.id), ['exam-b', 'exam-shared', 'exam-from-test'])
})

test('admins retain the app-wide exam catalog', () => {
  assert.deepEqual(
    scopeDashboardExams(exams, [], 'admin', 'admin-user').map(exam => exam.id),
    exams.map(exam => exam.id),
  )
})
