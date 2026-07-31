import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    // Schema generation is offline. Actual migrations use the guarded script
    // and always require Neon's direct connection.
    url: process.env.DATABASE_URL_DIRECT || 'postgresql://migration-url-required.invalid/neondb',
  },
  strict: true,
  verbose: true,
})
