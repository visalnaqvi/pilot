import { sql } from 'drizzle-orm'
import {
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { exams } from './exams'

export const globalRole = pgEnum('global_role', ['user', 'admin'])
export const membershipRole = pgEnum('membership_role', ['owner', 'teacher', 'student'])
export const membershipStatus = pgEnum('membership_status', ['pending', 'accepted', 'declined'])

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  globalRole: globalRole('global_role').notNull().default('user'),
  profilePhotoPath: text('profile_photo_path'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('users_email_unique').on(sql`lower(${table.email})`),
])

export const emailVerificationCooldowns = pgTable('email_verification_cooldowns', {
  firebaseUid: text('firebase_uid').primaryKey(),
  email: text('email').notNull(),
  nextAllowedAt: timestamp('next_allowed_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  logoPath: text('logo_path'),
  profilePhotoPath: text('profile_photo_path'),
  address: text('address'),
  contactNumbers: text('contact_numbers').array().notNull().default(sql`ARRAY[]::text[]`),
  notificationEmails: text('notification_emails').array().notNull().default(sql`ARRAY[]::text[]`),
  googleMapsUrl: text('google_maps_url'),
  instagramUrl: text('instagram_url'),
  facebookUrl: text('facebook_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index('organizations_owner_idx').on(table.ownerUserId),
])

export const organizationMemberships = pgTable('organization_memberships', {
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: membershipRole('role').notNull(),
  status: membershipStatus('status').notNull().default('pending'),
  initiatedBy: text('initiated_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  notificationEmails: text('notification_emails').array().notNull().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.organizationId, table.userId] }),
  index('organization_memberships_user_status_idx').on(table.userId, table.status),
  index('organization_memberships_org_status_role_idx').on(table.organizationId, table.status, table.role),
])

export const organizationGroups = pgTable('organization_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  targetExamId: uuid('target_exam_id').references(() => exams.id, { onDelete: 'set null' }),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('organization_groups_name_unique').on(table.organizationId, sql`lower(${table.name})`),
  index('organization_groups_organization_idx').on(table.organizationId),
])

export const organizationGroupMembers = pgTable('organization_group_members', {
  groupId: uuid('group_id').notNull().references(() => organizationGroups.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  addedBy: text('added_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.groupId, table.userId] }),
  index('organization_group_members_user_idx').on(table.userId),
])
