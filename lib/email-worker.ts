import 'server-only'

import { eq, inArray, sql } from 'drizzle-orm'
import {
  assignmentBatches,
  emailDeliveries,
  emailJobs,
  organizationGroupMembers,
  organizations,
  tasks,
  timetableVersionGroups,
  timetableVersionUsers,
  users,
} from '@/db/schema'
import { database } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { appBaseUrl } from '@/lib/app-url'

type ClaimedJob = typeof emailJobs.$inferSelect

async function claimJobs(limit: number) {
  return database().transaction(async tx => {
    const result = await tx.execute(sql<{ id: string }>`
      select id
      from email_jobs
      where (
        (status = 'pending' and next_attempt_at <= now())
        or (status = 'processing' and lease_until < now())
      )
      order by next_attempt_at
      for update skip locked
      limit ${limit}
    `)
    const ids = (result.rows as unknown as { id: string }[]).map(row => row.id)
    if (ids.length) {
      return tx.update(emailJobs).set({
        status: 'processing',
        leaseUntil: new Date(Date.now() + 5 * 60_000),
        updatedAt: new Date(),
      }).where(inArray(emailJobs.id, ids)).returning()
    }
    return [] as ClaimedJob[]
  })
}

async function recipients(job: ClaimedJob) {
  const payload = (job.payload || {}) as { recipientIds?: string[]; versionId?: string }
  const ids = new Set(payload.recipientIds || [])
  if (job.kind === 'timetable_published' && payload.versionId) {
    const direct = await database().select().from(timetableVersionUsers).where(eq(timetableVersionUsers.versionId, payload.versionId))
    direct.forEach(item => ids.add(item.userId))
    const groups = await database().select().from(timetableVersionGroups).where(eq(timetableVersionGroups.versionId, payload.versionId))
    if (groups.length) {
      const members = await database().select().from(organizationGroupMembers).where(inArray(organizationGroupMembers.groupId, groups.map(item => item.groupId)))
      members.forEach(item => ids.add(item.userId))
    }
  }
  return ids.size ? database().select().from(users).where(inArray(users.id, [...ids])) : []
}

async function content(job: ClaimedJob) {
  const organization = job.organizationId
    ? (await database().select().from(organizations).where(eq(organizations.id, job.organizationId)).limit(1))[0]
    : null
  if (job.entityType === 'task') {
    const item = (await database().select().from(tasks).where(eq(tasks.id, job.entityId)).limit(1))[0]
    return { subject: `New task: ${item?.title || 'Task'}`, detail: item?.description || '', href: '/tasks' }
  }
  if (job.entityType === 'assignment') {
    const item = (await database().select().from(assignmentBatches).where(eq(assignmentBatches.id, job.entityId)).limit(1))[0]
    return { subject: `New assignment: ${item?.name || 'Assignment'}`, detail: `Available until ${item?.deadline.toLocaleString() || 'the deadline'}.`, href: '/assignments' }
  }
  return { subject: `Timetable published by ${organization?.name || 'your organization'}`, detail: 'A new timetable version is available.', href: '/timetables' }
}

async function processJob(job: ClaimedJob) {
  const people = await recipients(job)
  const copy = await content(job)
  for (const person of people) {
    try {
      const result = await sendEmail({
        to: person.email,
        subject: copy.subject,
        text: `Hi ${person.name},\n\n${copy.detail}\n\nOpen MockPilot: ${appBaseUrl()}${copy.href}`,
        metadata: { jobId: job.id, kind: job.kind },
      })
      await database().insert(emailDeliveries).values({
        jobId: job.id,
        recipientUserId: person.id,
        recipientEmail: person.email,
        status: 'sent',
        providerMessageId: result.providerMessageId,
      }).onConflictDoUpdate({
        target: [emailDeliveries.jobId, emailDeliveries.recipientEmail],
        set: { status: 'sent', providerMessageId: result.providerMessageId, error: null, attemptedAt: new Date() },
      })
    } catch (error) {
      await database().insert(emailDeliveries).values({
        jobId: job.id,
        recipientUserId: person.id,
        recipientEmail: person.email,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Delivery failed.',
      }).onConflictDoUpdate({
        target: [emailDeliveries.jobId, emailDeliveries.recipientEmail],
        set: { status: 'failed', error: error instanceof Error ? error.message : 'Delivery failed.', attemptedAt: new Date() },
      })
      throw error
    }
  }
  await database().update(emailJobs).set({ status: 'sent', leaseUntil: null, attempts: job.attempts + 1, updatedAt: new Date() }).where(eq(emailJobs.id, job.id))
}

export async function processDueEmailJobs(limit = 20) {
  const jobs = await claimJobs(limit)
  let sent = 0
  let failed = 0
  for (const job of jobs) {
    try {
      await processJob(job)
      sent += 1
    } catch (error) {
      const attempts = job.attempts + 1
      await database().update(emailJobs).set({
        status: attempts >= 5 ? 'failed' : 'pending',
        attempts,
        leaseUntil: null,
        nextAttemptAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000),
        lastError: error instanceof Error ? error.message : 'Delivery failed.',
        updatedAt: new Date(),
      }).where(eq(emailJobs.id, job.id))
      failed += 1
    }
  }
  return { claimed: jobs.length, sent, failed }
}
