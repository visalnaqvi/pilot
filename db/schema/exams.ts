import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { users } from './identity'

export const exams = pgTable('exams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('exams_normalized_name_unique').on(table.normalizedName),
  index('exams_name_idx').on(table.name),
])

export const examAliases = pgTable('exam_aliases', {
  id: uuid('id').primaryKey().defaultRandom(),
  examId: uuid('exam_id').notNull().references(() => exams.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
  normalizedAlias: text('normalized_alias').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
}, table => [
  uniqueIndex('exam_aliases_normalized_unique').on(table.normalizedAlias),
  index('exam_aliases_exam_idx').on(table.examId),
])
