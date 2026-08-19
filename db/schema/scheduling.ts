import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizationGroups, organizations, users } from './identity'

export const timetableStatus = pgEnum('timetable_status', ['active', 'archived'])
export const timetableVersionState = pgEnum('timetable_version_state', ['draft', 'published'])
export const attendanceStatus = pgEnum('attendance_status', ['draft', 'submitted', 'cancelled'])
export const attendanceMark = pgEnum('attendance_mark', ['present', 'absent', 'unmarked'])

export const timetables = pgTable('timetables', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: timetableStatus('status').notNull().default('active'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  currentPublishedVersionId: uuid('current_published_version_id').references((): AnyPgColumn => timetableVersions.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, table => [
  index('timetables_organization_status_idx').on(table.organizationId, table.status),
])

export const timetableVersions = pgTable('timetable_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  timetableId: uuid('timetable_id').notNull().references(() => timetables.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  state: timetableVersionState('state').notNull().default('draft'),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to').notNull(),
  timeZone: text('time_zone').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
}, table => [
  uniqueIndex('timetable_versions_revision_unique').on(table.timetableId, table.revision),
  index('timetable_versions_state_idx').on(table.timetableId, table.state),
])

export const timetableEntries = pgTable('timetable_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  versionId: uuid('version_id').notNull().references(() => timetableVersions.id, { onDelete: 'cascade' }),
  subject: text('subject').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  teacherUserId: text('teacher_user_id').references(() => users.id, { onDelete: 'set null' }),
  teacherLabel: text('teacher_label'),
  location: text('location'),
  meetingUrl: text('meeting_url'),
  notes: text('notes'),
  position: integer('position').notNull(),
}, table => [
  uniqueIndex('timetable_entries_position_unique').on(table.versionId, table.position),
])

export const timetableEntryDays = pgTable('timetable_entry_days', {
  entryId: uuid('entry_id').notNull().references(() => timetableEntries.id, { onDelete: 'cascade' }),
  weekday: integer('weekday').notNull(),
}, table => [
  primaryKey({ columns: [table.entryId, table.weekday] }),
])

export const timetableVersionUsers = pgTable('timetable_version_users', {
  versionId: uuid('version_id').notNull().references(() => timetableVersions.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, table => [
  primaryKey({ columns: [table.versionId, table.userId] }),
  index('timetable_version_users_user_idx').on(table.userId),
])

export const timetableVersionGroups = pgTable('timetable_version_groups', {
  versionId: uuid('version_id').notNull().references(() => timetableVersions.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').notNull().references(() => organizationGroups.id, { onDelete: 'cascade' }),
}, table => [
  primaryKey({ columns: [table.versionId, table.groupId] }),
])

export const attendanceSessions = pgTable('attendance_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  timetableVersionId: uuid('timetable_version_id').notNull().references(() => timetableVersions.id, { onDelete: 'restrict' }),
  timetableEntryId: uuid('timetable_entry_id').notNull().references(() => timetableEntries.id, { onDelete: 'restrict' }),
  classDate: date('class_date').notNull(),
  status: attendanceStatus('status').notNull().default('draft'),
  revision: integer('revision').notNull().default(1),
  cancellationReason: text('cancellation_reason'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  updatedBy: text('updated_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
}, table => [
  uniqueIndex('attendance_sessions_occurrence_unique').on(table.timetableVersionId, table.timetableEntryId, table.classDate),
  index('attendance_sessions_organization_date_idx').on(table.organizationId, table.classDate),
])

export const attendanceMarks = pgTable('attendance_marks', {
  sessionId: uuid('session_id').notNull().references(() => attendanceSessions.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  mark: attendanceMark('mark').notNull().default('unmarked'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.sessionId, table.userId] }),
  index('attendance_marks_user_idx').on(table.userId),
])

export const attendanceRevisions = pgTable('attendance_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => attendanceSessions.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  snapshot: jsonb('snapshot').notNull(),
  actorUserId: text('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('attendance_revisions_revision_unique').on(table.sessionId, table.revision),
])

export const attendanceQrWindows = pgTable('attendance_qr_windows', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => attendanceSessions.id, { onDelete: 'cascade' }),
  openedBy: text('opened_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  closedBy: text('closed_by').references(() => users.id, { onDelete: 'restrict' }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, table => [
  uniqueIndex('attendance_qr_windows_one_unclosed_unique')
    .on(table.sessionId)
    .where(sql`${table.closedAt} is null`),
  index('attendance_qr_windows_session_expiry_idx').on(table.sessionId, table.expiresAt),
])

export const attendanceQrCheckIns = pgTable('attendance_qr_check_ins', {
  id: uuid('id').primaryKey().defaultRandom(),
  windowId: uuid('window_id').notNull().references(() => attendanceQrWindows.id, { onDelete: 'restrict' }),
  sessionId: uuid('session_id').notNull().references(() => attendanceSessions.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  checkedInAt: timestamp('checked_in_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('attendance_qr_check_ins_session_user_unique').on(table.sessionId, table.userId),
  index('attendance_qr_check_ins_window_idx').on(table.windowId),
  index('attendance_qr_check_ins_user_idx').on(table.userId),
])
