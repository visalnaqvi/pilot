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
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { organizations, users } from './identity'

export const emailJobStatus = pgEnum('email_job_status', ['pending', 'processing', 'sent', 'failed', 'cancelled'])

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(),
  recipientUserId: text('recipient_user_id').references(() => users.id, { onDelete: 'cascade' }),
  recipientOrganizationId: uuid('recipient_organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  global: boolean('global').notNull().default(false),
  title: text('title').notNull(),
  detail: text('detail').notNull(),
  href: text('href').notNull(),
  tone: text('tone').notNull(),
  icon: text('icon').notNull(),
  data: jsonb('data').notNull().default({}),
  dedupeKey: text('dedupe_key').notNull().unique(),
  visibleAt: timestamp('visible_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index('notifications_user_visible_idx').on(table.recipientUserId, table.visibleAt),
  index('notifications_org_visible_idx').on(table.recipientOrganizationId, table.visibleAt),
  index('notifications_global_visible_idx').on(table.global, table.visibleAt),
])

export const notificationReads = pgTable('notification_reads', {
  notificationId: uuid('notification_id').notNull().references(() => notifications.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.notificationId, table.userId] }),
])

export const emailJobs = pgTable('email_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  dedupeKey: text('dedupe_key').notNull().unique(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  payload: jsonb('payload').notNull().default({}),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  status: emailJobStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index('email_jobs_due_idx').on(table.status, table.nextAttemptAt),
  index('email_jobs_lease_idx').on(table.status, table.leaseUntil),
])

export const emailDeliveries = pgTable('email_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => emailJobs.id, { onDelete: 'cascade' }),
  recipientUserId: text('recipient_user_id').references(() => users.id, { onDelete: 'set null' }),
  recipientEmail: text('recipient_email').notNull(),
  status: text('status').notNull(),
  providerMessageId: text('provider_message_id'),
  error: text('error'),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('email_deliveries_job_recipient_unique')
    .on(table.jobId, table.recipientEmail, table.recipientUserId)
    .nullsNotDistinct(),
  index('email_deliveries_recipient_idx').on(table.recipientUserId),
])

export const openaiWebhookEvents = pgTable('openai_webhook_events', {
  id: text('id').primaryKey(),
  responseId: text('response_id').notNull(),
  type: text('type').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  error: text('error'),
}, table => [
  index('openai_webhook_events_response_idx').on(table.responseId),
])
