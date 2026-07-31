import { index, pgEnum, pgTable, text, timestamp, uuid, integer } from 'drizzle-orm/pg-core'
import { organizations, users } from './identity'

export const fileStatus = pgEnum('file_status', ['pending', 'attached', 'deleted'])

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  path: text('path').notNull().unique(),
  name: text('name').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  status: fileStatus('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  attachedAt: timestamp('attached_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, table => [
  index('files_owner_status_idx').on(table.ownerUserId, table.status),
  index('files_organization_idx').on(table.organizationId),
])
