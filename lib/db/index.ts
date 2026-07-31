import 'server-only'

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '@/db/schema'

type Database = NodePgDatabase<typeof schema>

const state = globalThis as typeof globalThis & {
  mockPilotPool?: Pool
  mockPilotDb?: Database
}

export function database() {
  if (state.mockPilotDb) return state.mockPilotDb
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for PostgreSQL access.')
  }
  const pool = state.mockPilotPool || new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
  state.mockPilotPool = pool
  state.mockPilotDb = drizzle(pool, { schema })
  return state.mockPilotDb
}

export async function closeDatabase() {
  await state.mockPilotPool?.end()
  delete state.mockPilotPool
  delete state.mockPilotDb
}

export { schema }
