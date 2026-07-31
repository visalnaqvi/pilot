import 'dotenv/config'

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  examAliases,
  exams,
  users,
} from '../db/schema'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('Set the pooled DATABASE_URL before seeding.')

const pool = new Pool({ connectionString, max: 1 })
const db = drizzle(pool)

const systemUser = {
  id: 'mockpilot-seed-system',
  email: 'seed-system@mockpilot.invalid',
  name: 'MockPilot seed system',
  globalRole: 'admin' as const,
}

const catalog = [
  {
    id: '68bb623e-9f30-4df8-9fc4-9aa6d533f1d1',
    name: 'Joint Entrance Examination Main',
    normalizedName: 'joint entrance examination main',
    aliases: ['JEE Main', 'JEE Mains'],
  },
  {
    id: '572aef67-c836-42f1-996d-7effa4bc32bf',
    name: 'National Eligibility cum Entrance Test Undergraduate',
    normalizedName: 'national eligibility cum entrance test undergraduate',
    aliases: ['NEET UG', 'NEET'],
  },
  {
    id: 'bf5e457b-ebfa-4c69-9b19-7116d4bca8a0',
    name: 'Common University Entrance Test Undergraduate',
    normalizedName: 'common university entrance test undergraduate',
    aliases: ['CUET UG', 'CUET'],
  },
]

async function seed() {
  await db.transaction(async tx => {
    await tx.insert(users).values(systemUser).onConflictDoUpdate({
      target: users.id,
      set: { name: systemUser.name, globalRole: 'admin', updatedAt: new Date() },
    })

    const bootstrapUid = process.env.BOOTSTRAP_ADMIN_UID?.trim()
    const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase()
    if (bootstrapUid && bootstrapEmail) {
      await tx.insert(users).values({
        id: bootstrapUid,
        email: bootstrapEmail,
        name: bootstrapEmail,
        globalRole: 'admin',
      }).onConflictDoUpdate({
        target: users.id,
        set: { email: bootstrapEmail, globalRole: 'admin', updatedAt: new Date() },
      })
    }

    for (const item of catalog) {
      await tx.insert(exams).values({
        id: item.id,
        name: item.name,
        normalizedName: item.normalizedName,
        createdBy: systemUser.id,
      }).onConflictDoUpdate({
        target: exams.id,
        set: { name: item.name, normalizedName: item.normalizedName, updatedAt: new Date() },
      })
      for (const [index, alias] of item.aliases.entries()) {
        await tx.insert(examAliases).values({
          examId: item.id,
          alias,
          normalizedAlias: alias.toLowerCase(),
          isPrimary: index === 0,
        }).onConflictDoUpdate({
          target: examAliases.normalizedAlias,
          set: { examId: item.id, alias, isPrimary: index === 0 },
        })
      }
    }
  })
}

seed()
  .then(() => console.log('Seeded the system account and deterministic exam catalog.'))
  .finally(() => pool.end())
