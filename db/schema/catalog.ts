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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { files } from './assets'
import { organizations, users } from './identity'
import { examAliases, exams } from './exams'

export const contentVisibility = pgEnum('content_visibility', ['public', 'private', 'assigned'])
export const questionKind = pgEnum('question_kind', ['mcq', 'short_answer'])
export const generationStatus = pgEnum('generation_status', [
  'uploading',
  'analyzing',
  'analysis_ready',
  'generating',
  'verification_starting',
  'verifying',
  'review',
  'publishing',
  'published',
  'failed',
  'cancelled',
])

export const organizationExams = pgTable('organization_exams', {
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  examId: uuid('exam_id').notNull().references(() => exams.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.organizationId, table.examId] }),
])

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  examId: uuid('exam_id').notNull().references(() => exams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('categories_scoped_name_unique')
    .on(table.organizationId, table.examId, table.normalizedName)
    .where(sql`${table.organizationId} is not null`),
  uniqueIndex('categories_global_name_unique')
    .on(table.examId, table.normalizedName)
    .where(sql`${table.organizationId} is null`),
])

export const questions = pgTable('questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  kind: questionKind('kind').notNull().default('mcq'),
  visibility: contentVisibility('visibility').notNull().default('private'),
  prompt: text('prompt').notNull(),
  options: jsonb('options').$type<string[]>(),
  format: text('format').notNull().default('plain'),
  promptImagePath: text('prompt_image_path'),
  optionImagePaths: jsonb('option_image_paths').$type<string[]>(),
  revision: integer('revision').notNull().default(1),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index('questions_owner_visibility_idx').on(table.createdBy, table.visibility),
  index('questions_organization_idx').on(table.organizationId),
])

export const questionKeys = pgTable('question_keys', {
  questionId: uuid('question_id').primaryKey().references(() => questions.id, { onDelete: 'cascade' }),
  correctAnswer: integer('correct_answer'),
  explanation: text('explanation'),
  modelAnswer: text('model_answer'),
  rubric: jsonb('rubric'),
  answerOrigin: text('answer_origin'),
  sourceReferences: jsonb('source_references'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const tests = pgTable('tests', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  examId: uuid('exam_id').notNull().references(() => exams.id, { onDelete: 'restrict' }),
  categoryId: uuid('category_id').notNull().references(() => categories.id, { onDelete: 'restrict' }),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  durationMinutes: integer('duration_minutes').notNull().default(0),
  visibility: contentVisibility('visibility').notNull(),
  published: boolean('published').notNull().default(false),
  origin: text('origin'),
  generationJobId: uuid('generation_job_id').references((): AnyPgColumn => testGenerationJobs.id, { onDelete: 'set null' }),
  questionCount: integer('question_count').notNull().default(0),
  totalMarks: integer('total_marks').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: text('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index('tests_visibility_published_idx').on(table.visibility, table.published, table.deletedAt),
  index('tests_organization_idx').on(table.organizationId),
  index('tests_exam_idx').on(table.examId),
  index('tests_creator_idx').on(table.createdBy),
])

export const testQuestions = pgTable('test_questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  testId: uuid('test_id').notNull().references(() => tests.id, { onDelete: 'cascade' }),
  questionId: uuid('question_id').references(() => questions.id, { onDelete: 'set null' }),
  position: integer('position').notNull(),
  marks: integer('marks').notNull(),
  snapshot: jsonb('snapshot'),
}, table => [
  uniqueIndex('test_questions_position_unique').on(table.testId, table.position),
  uniqueIndex('test_questions_question_unique').on(table.testId, table.questionId),
])

export const testGenerationJobs = pgTable('test_generation_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  status: generationStatus('status').notNull().default('uploading'),
  model: text('model').notNull(),
  activeStage: text('active_stage'),
  activeResponseId: text('active_response_id'),
  responseIds: jsonb('response_ids').$type<Record<string, string>>().notNull().default({}),
  analysis: jsonb('analysis'),
  config: jsonb('config'),
  usage: jsonb('usage').notNull().default({}),
  latencyMs: jsonb('latency_ms').notNull().default({}),
  titleSuggestion: text('title_suggestion'),
  descriptionSuggestion: text('description_suggestion'),
  failedStage: text('failed_stage'),
  error: text('error'),
  retryCount: integer('retry_count').notNull().default(0),
  publishedTestId: uuid('published_test_id').references(() => tests.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  stageStartedAt: timestamp('stage_started_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index('test_generation_jobs_owner_updated_idx').on(table.organizationId, table.updatedAt),
  index('test_generation_jobs_response_idx').on(table.activeResponseId),
])

export const testGenerationSources = pgTable('test_generation_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => testGenerationJobs.id, { onDelete: 'cascade' }),
  fileId: uuid('file_id').notNull().references(() => files.id, { onDelete: 'restrict' }),
  openaiFileId: text('openai_file_id'),
  position: integer('position').notNull(),
}, table => [
  uniqueIndex('test_generation_sources_position_unique').on(table.jobId, table.position),
  uniqueIndex('test_generation_sources_file_unique').on(table.jobId, table.fileId),
])

export const testGenerationQuestions = pgTable('test_generation_questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => testGenerationJobs.id, { onDelete: 'cascade' }),
  candidateKey: text('candidate_key').notNull(),
  position: integer('position').notNull(),
  content: jsonb('content').notNull(),
  reviewStatus: text('review_status').notNull().default('pending'),
  verificationStatus: text('verification_status').notNull().default('pending'),
  verification: jsonb('verification'),
  editedAfterVerification: boolean('edited_after_verification').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('test_generation_questions_key_unique').on(table.jobId, table.candidateKey),
  uniqueIndex('test_generation_questions_position_unique').on(table.jobId, table.position),
])

export { exams, examAliases }
