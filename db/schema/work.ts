import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { files } from './assets'
import { tests } from './catalog'
import { organizationGroups, organizations, users } from './identity'

export const taskType = pgEnum('task_type', ['basic', 'submission'])
export const taskStatus = pgEnum('task_status', ['todo', 'in_progress', 'done', 'closed'])
export const gradingStatus = pgEnum('grading_status', ['not_required', 'pending', 'graded'])

export const assignmentBatches = pgTable('assignment_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  testId: uuid('test_id').notNull().references(() => tests.id, { onDelete: 'restrict' }),
  assignedBy: text('assigned_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  audienceName: text('audience_name').notNull(),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  deadline: timestamp('deadline', { withTimezone: true }).notNull(),
  maxAttempts: integer('max_attempts').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index('assignment_batches_organization_idx').on(table.organizationId, table.createdAt),
  index('assignment_batches_test_idx').on(table.testId),
])

export const assignmentRecipients = pgTable('assignment_recipients', {
  assignmentBatchId: uuid('assignment_batch_id').notNull().references(() => assignmentBatches.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  attemptsUsed: integer('attempts_used').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.assignmentBatchId, table.userId] }),
  index('assignment_recipients_user_idx').on(table.userId),
])

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  assignmentBatchId: uuid('assignment_batch_id').references(() => assignmentBatches.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  type: taskType('type').notNull(),
  startAt: timestamp('start_at', { withTimezone: true }),
  endAt: timestamp('end_at', { withTimezone: true }),
  isClosed: boolean('is_closed').notNull().default(false),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: text('closed_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('tasks_assignment_unique').on(table.assignmentBatchId).where(sql`${table.assignmentBatchId} is not null`),
  index('tasks_organization_idx').on(table.organizationId, table.updatedAt),
  index('tasks_creator_idx').on(table.createdBy),
])

export const taskGroups = pgTable('task_groups', {
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').notNull().references(() => organizationGroups.id, { onDelete: 'cascade' }),
}, table => [
  primaryKey({ columns: [table.taskId, table.groupId] }),
])

export const taskAssignees = pgTable('task_assignees', {
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: taskStatus('status').notNull().default('todo'),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.taskId, table.userId] }),
  index('task_assignees_user_status_idx').on(table.userId, table.status),
])

export const taskActivity = pgTable('task_activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  subjectUserId: text('subject_user_id').references(() => users.id, { onDelete: 'set null' }),
  actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  type: text('type').notNull(),
  data: jsonb('data').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index('task_activity_task_created_idx').on(table.taskId, table.createdAt),
])

export const taskComments = pgTable('task_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  authorUserId: text('author_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index('task_comments_task_created_idx').on(table.taskId, table.createdAt),
])

export const taskSubmissions = pgTable('task_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  note: text('note').notNull().default(''),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('task_submissions_task_user_unique').on(table.taskId, table.userId),
])

export const taskAttachments = pgTable('task_attachments', {
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  fileId: uuid('file_id').notNull().references(() => files.id, { onDelete: 'restrict' }),
  position: integer('position').notNull(),
}, table => [
  primaryKey({ columns: [table.taskId, table.fileId] }),
  uniqueIndex('task_attachments_position_unique').on(table.taskId, table.position),
])

export const taskSubmissionFiles = pgTable('task_submission_files', {
  taskSubmissionId: uuid('task_submission_id').notNull().references(() => taskSubmissions.id, { onDelete: 'cascade' }),
  fileId: uuid('file_id').notNull().references(() => files.id, { onDelete: 'restrict' }),
  position: integer('position').notNull(),
}, table => [
  primaryKey({ columns: [table.taskSubmissionId, table.fileId] }),
  uniqueIndex('task_submission_files_position_unique').on(table.taskSubmissionId, table.position),
])

export const testAttemptCounters = pgTable('test_attempt_counters', {
  testId: uuid('test_id').notNull().references(() => tests.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull(),
  count: integer('count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.testId, table.userId, table.scope] }),
])

export const testSubmissions = pgTable('test_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  testId: uuid('test_id').notNull().references(() => tests.id, { onDelete: 'restrict' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  assignmentBatchId: uuid('assignment_batch_id').references(() => assignmentBatches.id, { onDelete: 'set null' }),
  attemptNumber: integer('attempt_number').notNull(),
  testTitle: text('test_title').notNull(),
  examName: text('exam_name'),
  categoryName: text('category_name').notNull(),
  visibility: text('visibility').notNull(),
  gradingStatus: gradingStatus('grading_status').notNull(),
  score: integer('score'),
  mcqScore: integer('mcq_score').notNull().default(0),
  mcqMarks: integer('mcq_marks').notNull().default(0),
  pendingMarks: integer('pending_marks').notNull().default(0),
  totalMarks: integer('total_marks').notNull(),
  correctAnswers: integer('correct_answers').notNull().default(0),
  questionCount: integer('question_count').notNull(),
  autoSubmitted: boolean('auto_submitted').notNull().default(false),
  autoSubmitReason: text('auto_submit_reason'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('test_submissions_assignment_attempt_unique')
    .on(table.assignmentBatchId, table.userId, table.attemptNumber)
    .where(sql`${table.assignmentBatchId} is not null`),
  index('test_submissions_test_submitted_idx').on(table.testId, table.submittedAt),
  index('test_submissions_user_submitted_idx').on(table.userId, table.submittedAt),
])

export const submissionAnswers = pgTable('submission_answers', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => testSubmissions.id, { onDelete: 'cascade' }),
  questionIndex: integer('question_index').notNull(),
  questionSnapshot: jsonb('question_snapshot').notNull(),
  response: jsonb('response'),
  correctAnswer: jsonb('correct_answer'),
  awardedMarks: integer('awarded_marks'),
  feedback: text('feedback'),
  gradingStatus: gradingStatus('grading_status').notNull(),
}, table => [
  uniqueIndex('submission_answers_question_unique').on(table.submissionId, table.questionIndex),
])

export const submissionOrganizationAccess = pgTable('submission_organization_access', {
  submissionId: uuid('submission_id').notNull().references(() => testSubmissions.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
}, table => [
  primaryKey({ columns: [table.submissionId, table.organizationId] }),
  index('submission_organization_access_org_idx').on(table.organizationId, table.submissionId),
])
