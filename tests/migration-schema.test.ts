import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const migration = readdirSync(join(process.cwd(), 'drizzle'))
  .filter(name => name.endsWith('.sql'))
  .sort()
  .map(name => readFileSync(join(process.cwd(), 'drizzle', name), 'utf8'))
  .join('\n')

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
    'email_verification_cooldowns',
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

test('organizations store notification email recipients', () => {
  assert.match(migration, /ALTER TABLE "organizations" ADD COLUMN "notification_emails" text\[\]/)
})

test('student memberships store student-specific notification email recipients', () => {
  assert.match(migration, /ALTER TABLE "organization_memberships" ADD COLUMN "notification_emails" text\[\]/)
})

test('email delivery uniqueness keeps shared guardian addresses separate by student', () => {
  assert.match(migration, /email_deliveries_job_recipient_unique[\s\S]*job_id[\s\S]*recipient_email[\s\S]*recipient_user_id/i)
})

test('removed exam-information tables are absent', () => {
  assert.doesNotMatch(migration, /exam_(cycles|updates|revisions|refresh|sources|evidence)/i)
})

test('email worker claims jobs with row locking and skip locked', () => {
  const worker = readFileSync(join(process.cwd(), 'lib', 'email-worker.ts'), 'utf8')
  assert.match(worker, /for update skip locked/i)
})

test('verification email delivery stays token-scoped and server-rate-limited', () => {
  const route = readFileSync(join(process.cwd(), 'app', 'api', 'auth', 'verification-email', 'route.ts'), 'utf8')
  const signup = readFileSync(join(process.cwd(), 'app', '_components', 'auth-form.tsx'), 'utf8')
  const verification = readFileSync(join(process.cwd(), 'app', '_components', 'verify-email.tsx'), 'utf8')

  assert.match(route, /authenticateFirebaseRequest/)
  assert.match(route, /account\.email/)
  assert.match(route, /reserveVerificationEmail/)
  assert.match(route, /releaseVerificationEmail/)
  assert.doesNotMatch(route, /request\.json/)
  assert.doesNotMatch(`${signup}\n${verification}`, /sendEmailVerification/)
})

test('creation routes send only assigned jobs immediately and leave scheduled jobs for the poller', () => {
  const taskRoute = readFileSync(join(process.cwd(), 'app', 'api', 'tasks', 'route.ts'), 'utf8')
  const assignmentRoute = readFileSync(join(process.cwd(), 'app', 'api', 'assignments', 'route.ts'), 'utf8')
  for (const route of [taskRoute, assignmentRoute]) {
    assert.match(route, /after\(\(\) => processEmailJob\(jobId\)/)
    assert.match(route, /planTaskEmailJobs/)
    assert.match(route, /immediateEmailJobId/)
  }
})

test('organization event email worker includes de-duplicated notification recipients', () => {
  const worker = readFileSync(join(process.cwd(), 'lib', 'email-worker.ts'), 'utf8')
  assert.match(worker, /organizationNotificationRecipients\(organization\)/)
  assert.match(worker, /uniqueByRecipientEmail/)
  assert.match(worker, /notificationCopy: true/)
})

test('assignment result emails include each students notification recipients', () => {
  const worker = readFileSync(join(process.cwd(), 'lib', 'email-worker.ts'), 'utf8')
  assert.match(worker, /studentNotificationRecipients/)
  assert.match(worker, /recipient_type: 'student_notification'/)
})

test('timetable publishing queues deduplicated 7 AM agendas instead of publication emails', () => {
  const publishRoute = readFileSync(join(
    process.cwd(), 'app', 'api', 'timetables', '[id]', 'publish', 'route.ts',
  ), 'utf8')
  assert.match(publishRoute, /planTimetableAgendaJobs/)
  assert.match(publishRoute, /kind: 'timetable_agenda'/)
  assert.match(publishRoute, /onConflictDoNothing/)
  assert.doesNotMatch(publishRoute, /kind: 'timetable_published'/)
})
