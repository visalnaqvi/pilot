import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const migration = readFileSync(
  join(process.cwd(), 'drizzle', readdirSync(join(process.cwd(), 'drizzle')).find(name => name.endsWith('.sql'))!),
  'utf8',
)

test('initial migration contains the relational feature tables', () => {
  for (const table of [
    'users',
    'organizations',
    'organization_memberships',
    'organization_groups',
    'exams',
    'exam_aliases',
    'questions',
    'question_keys',
    'tests',
    'test_questions',
    'assignment_batches',
    'assignment_recipients',
    'tasks',
    'task_assignees',
    'test_submissions',
    'submission_answers',
    'submission_organization_access',
    'timetable_versions',
    'attendance_sessions',
    'notifications',
    'email_jobs',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`))
  }
})

test('migration enforces key uniqueness and foreign-key relationships', () => {
  assert.match(migration, /organization_memberships_organization_id_user_id_pk/)
  assert.match(migration, /test_questions_position_unique/)
  assert.match(migration, /test_questions_question_unique/)
  assert.match(migration, /test_submissions_assignment_attempt_unique/)
  assert.match(migration, /attendance_sessions_occurrence_unique/)
  assert.match(migration, /FOREIGN KEY/)
})

test('removed exam-information tables are absent', () => {
  assert.doesNotMatch(migration, /exam_(cycles|updates|revisions|refresh|sources|evidence)/i)
})

test('email worker claims jobs with row locking and skip locked', () => {
  const worker = readFileSync(join(process.cwd(), 'lib', 'email-worker.ts'), 'utf8')
  assert.match(worker, /for update skip locked/i)
})
