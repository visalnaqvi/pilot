import 'dotenv/config'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL_DIRECT
if (!connectionString) {
  throw new Error('DATABASE_URL_DIRECT is required for schema migrations. Do not use the pooled runtime URL.')
}

const pool = new Pool({ connectionString, max: 1 })

migrate(drizzle(pool), { migrationsFolder: 'drizzle' })
  .then(() => console.log('Database migrations applied.'))
  .finally(() => pool.end())
