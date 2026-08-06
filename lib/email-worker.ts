import 'server-only'

import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  assignmentBatches,
  assignmentRecipients,
  attendanceSessions,
  emailDeliveries,
  emailJobs,
  organizationGroupMembers,
  organizationGroups,
  organizations,
  taskAssignees,
  taskGroups,
  tasks,
  taskSubmissions,
  testSubmissions,
  timetableEntries,
  timetableEntryDays,
  timetables,
  timetableVersionGroups,
  timetableVersions,
  timetableVersionUsers,
  users,
} from '@/db/schema'
import { appBaseUrl } from '@/lib/app-url'
import { buildAttendanceAbsenceEmail } from '@/lib/attendance-email-content'
import { getBrandConfig, type BrandConfig } from '@/lib/branding'
import { database } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import {
  organizationNotificationRecipients,
  uniqueByRecipientEmail,
  type EmailDeliveryRecipient,
} from '@/lib/email-delivery-recipients'
import { buildTaskEmail, isEmailAddress } from '@/lib/task-email-content'
import { retryAtForAttempt, taskEmailSkipReason, type TaskEmailEventType } from '@/lib/task-email-plan'
import { buildTimetableAgendaEmail } from '@/lib/timetable-email-content'
import { entriesForDate, type TimetableEntry } from '@/lib/timetable'

type ClaimedJob = typeof emailJobs.$inferSelect
type JobPayload = {
  recipientIds?: string[]
  eventType?: TaskEmailEventType
  taskId?: string
  localDate?: string
}
type PreparedDelivery = {
  recipient: EmailDeliveryRecipient
  content: { subject: string; text: string; html?: string }
  metadata: Record<string, string>
  brand?: BrandConfig
}

const leaseMilliseconds = 5 * 60_000
const maxAttempts = 5

async function claimJobs(limit: number, now: Date) {
  return database().transaction(async tx => {
    const result = await tx.execute(sql<{ id: string }>`
      select id
      from email_jobs
      where (
        (status = 'pending' and next_attempt_at <= ${now})
        or (status = 'processing' and lease_until < ${now})
      )
      order by next_attempt_at
      for update skip locked
      limit ${limit}
    `)
    const ids = (result.rows as unknown as { id: string }[]).map(row => row.id)
    if (!ids.length) return [] as ClaimedJob[]
    return tx.update(emailJobs).set({
      status: 'processing',
      leaseUntil: new Date(now.getTime() + leaseMilliseconds),
      updatedAt: now,
    }).where(inArray(emailJobs.id, ids)).returning()
  })
}

async function claimJob(jobId: string, now: Date) {
  const jobs = await database().transaction(async tx => {
    const result = await tx.execute(sql<{ id: string }>`
      select id
      from email_jobs
      where id = ${jobId}
        and (
          (status = 'pending' and next_attempt_at <= ${now})
          or (status = 'processing' and lease_until < ${now})
        )
      for update skip locked
      limit 1
    `)
    if (!result.rows.length) return [] as ClaimedJob[]
    return tx.update(emailJobs).set({
      status: 'processing',
      leaseUntil: new Date(now.getTime() + leaseMilliseconds),
      updatedAt: now,
    }).where(eq(emailJobs.id, jobId)).returning()
  })
  return jobs[0] || null
}

function eventTypeForJob(job: ClaimedJob) {
  const payload = (job.payload || {}) as JobPayload
  if (payload.eventType) return payload.eventType
  if (job.kind.endsWith('_deadline_24h')) return 'deadline-24h'
  if (job.kind.endsWith('_deadline_1h')) return 'deadline-1h'
  if (job.kind.endsWith('_start')) return 'start'
  if (job.kind.endsWith('_ended')) return 'ended'
  return 'assigned'
}

async function taskDeliveries(job: ClaimedJob): Promise<PreparedDelivery[]> {
  const payload = (job.payload || {}) as JobPayload
  const assignment = job.entityType === 'assignment'
    ? (await database().select().from(assignmentBatches).where(eq(assignmentBatches.id, job.entityId)).limit(1))[0]
    : null
  const task = assignment
    ? (await database().select().from(tasks).where(eq(tasks.assignmentBatchId, assignment.id)).limit(1))[0]
    : (await database().select().from(tasks).where(eq(tasks.id, payload.taskId || job.entityId)).limit(1))[0]
  if (!task) return []

  const organization = (await database().select().from(organizations)
    .where(eq(organizations.id, task.organizationId)).limit(1))[0]
  const assignedRows = await database().select().from(taskAssignees).where(eq(taskAssignees.taskId, task.id))
  const statusByUser = new Map(assignedRows.map(row => [row.userId, row.status]))
  const recipientIds = [...new Set(payload.recipientIds?.length
    ? payload.recipientIds
    : assignment
      ? (await database().select().from(assignmentRecipients)
          .where(eq(assignmentRecipients.assignmentBatchId, assignment.id))).map(row => row.userId)
      : assignedRows.map(row => row.userId))]
  if (!recipientIds.length) return []

  const submittedUserIds = new Set(assignment
    ? (await database().select({ userId: testSubmissions.userId }).from(testSubmissions)
        .where(eq(testSubmissions.assignmentBatchId, assignment.id))).map(row => row.userId)
    : (await database().select({ userId: taskSubmissions.userId }).from(taskSubmissions)
        .where(eq(taskSubmissions.taskId, task.id))).map(row => row.userId))
  const eventType = eventTypeForJob(job)
  const people = await database().select().from(users).where(inArray(users.id, recipientIds))
  const actionPath = assignment
    ? `/tests/${encodeURIComponent(assignment.testId)}?assignment=${encodeURIComponent(assignment.id)}`
    : '/tasks'
  const itemType = assignment ? 'assignment' : 'task'
  const studentDeliveries = people.flatMap(recipient => {
    const skipReason = taskEmailSkipReason({
      eventType,
      manuallyClosed: task.isClosed,
      assigneeStatus: statusByUser.get(recipient.id),
      submitted: submittedUserIds.has(recipient.id),
    })
    if (skipReason) return []
    return [{
      recipient,
      content: buildTaskEmail({
        eventType,
        itemType,
        recipientName: recipient.name,
        taskTitle: assignment?.name || task.title,
        organisationName: organization?.name || 'Institute',
        description: task.description,
        startAt: assignment?.startAt || task.startAt,
        endAt: assignment?.deadline || task.endAt,
        actionUrl: `${appBaseUrl()}${actionPath}`,
        timeZone: process.env.APP_TIME_ZONE || 'Asia/Kolkata',
      }),
      metadata: {
        job_id: job.id,
        user_id: recipient.id,
        event_type: eventType,
      },
    }]
  })

  const notificationSkipReason = taskEmailSkipReason({
    eventType,
    manuallyClosed: task.isClosed,
    submitted: false,
  })
  if (notificationSkipReason) return uniqueByRecipientEmail(studentDeliveries)
  const notificationEmailRecipients = organizationNotificationRecipients(organization)
  if (!notificationEmailRecipients.length) return uniqueByRecipientEmail(studentDeliveries)

  const taskGroupNames = assignment ? [] : (await database().select({ name: organizationGroups.name })
    .from(taskGroups)
    .innerJoin(organizationGroups, eq(organizationGroups.id, taskGroups.groupId))
    .where(eq(taskGroups.taskId, task.id))).map(group => group.name)
  const audienceName = assignment?.audienceName
    || (taskGroupNames.length ? taskGroupNames.join(', ') : `${recipientIds.length} recipient${recipientIds.length === 1 ? '' : 's'}`)
  const notificationDeliveries = notificationEmailRecipients.map(recipient => ({
    recipient,
    content: buildTaskEmail({
      eventType,
      itemType,
      notificationCopy: true,
      recipientName: recipient.name,
      taskTitle: assignment?.name || task.title,
      organisationName: organization?.name || 'Institute',
      audienceName,
      description: task.description,
      startAt: assignment?.startAt || task.startAt,
      endAt: assignment?.deadline || task.endAt,
      actionUrl: `${appBaseUrl()}${actionPath}`,
      timeZone: process.env.APP_TIME_ZONE || 'Asia/Kolkata',
    }),
    metadata: {
      job_id: job.id,
      recipient_type: 'organization_notification',
      event_type: eventType,
    },
  }))

  return uniqueByRecipientEmail([...studentDeliveries, ...notificationDeliveries])
}

async function timetableAgendaDeliveries(job: ClaimedJob): Promise<PreparedDelivery[]> {
  const payload = (job.payload || {}) as JobPayload
  if (!job.organizationId || !payload.localDate) return []
  const localDate = payload.localDate
  const organization = (await database().select().from(organizations)
    .where(eq(organizations.id, job.organizationId)).limit(1))[0]
  const timetableRows = await database().select().from(timetables).where(and(
    eq(timetables.organizationId, job.organizationId),
    eq(timetables.status, 'active'),
  ))
  const versionIds = timetableRows.flatMap(item => item.currentPublishedVersionId ? [item.currentPublishedVersionId] : [])
  if (!versionIds.length) return []
  const versionRows = (await database().select().from(timetableVersions)
    .where(inArray(timetableVersions.id, versionIds)))
    .filter(version => version.effectiveFrom <= localDate && version.effectiveTo >= localDate)
  if (!versionRows.length) return []

  const activeVersionIds = versionRows.map(version => version.id)
  const entryRows = await database().select().from(timetableEntries)
    .where(inArray(timetableEntries.versionId, activeVersionIds))
  const entryIds = entryRows.map(entry => entry.id)
  const dayRows = entryIds.length
    ? await database().select().from(timetableEntryDays).where(inArray(timetableEntryDays.entryId, entryIds))
    : []
  const directRows = await database().select().from(timetableVersionUsers)
    .where(inArray(timetableVersionUsers.versionId, activeVersionIds))
  const versionGroupRows = await database().select().from(timetableVersionGroups)
    .where(inArray(timetableVersionGroups.versionId, activeVersionIds))
  const groupIds = [...new Set(versionGroupRows.map(row => row.groupId))]
  const groupMemberRows = groupIds.length
    ? await database().select().from(organizationGroupMembers)
        .where(inArray(organizationGroupMembers.groupId, groupIds))
    : []
  const timetableByVersion = new Map(timetableRows.flatMap(item => (
    item.currentPublishedVersionId ? [[item.currentPublishedVersionId, item] as const] : []
  )))
  const entriesByUser = new Map<string, Array<TimetableEntry & { timetableName: string }>>()
  const organizationAgenda: Array<TimetableEntry & { timetableName: string }> = []

  for (const version of versionRows) {
    const timetable = timetableByVersion.get(version.id)
    if (!timetable) continue
    const entries: TimetableEntry[] = entryRows
      .filter(entry => entry.versionId === version.id)
      .map(entry => ({
        id: entry.id,
        subject: entry.subject,
        weekdays: dayRows.filter(day => day.entryId === entry.id).map(day => day.weekday),
        startTime: entry.startTime,
        endTime: entry.endTime,
        teacher: entry.teacherLabel || undefined,
        location: entry.location || undefined,
        meetingUrl: entry.meetingUrl || undefined,
        notes: entry.notes || undefined,
      }))
    const todayEntries = entriesForDate(entries, localDate)
    if (!todayEntries.length) continue
    organizationAgenda.push(...todayEntries.map(entry => ({ ...entry, timetableName: timetable.name })))
    const directUserIds = directRows.filter(row => row.versionId === version.id).map(row => row.userId)
    const ownGroupIds = versionGroupRows.filter(row => row.versionId === version.id).map(row => row.groupId)
    const groupUserIds = groupMemberRows.filter(row => ownGroupIds.includes(row.groupId)).map(row => row.userId)
    for (const userId of new Set([...directUserIds, ...groupUserIds])) {
      const agenda = entriesByUser.get(userId) || []
      agenda.push(...todayEntries.map(entry => ({ ...entry, timetableName: timetable.name })))
      entriesByUser.set(userId, agenda)
    }
  }

  const recipientIds = [...entriesByUser.keys()]
  const people = recipientIds.length
    ? await database().select().from(users).where(inArray(users.id, recipientIds))
    : []
  const studentDeliveries = people.map(recipient => ({
    recipient,
    content: buildTimetableAgendaEmail({
      recipientName: recipient.name,
      organisationName: organization?.name || 'Institute',
      localDate,
      entries: entriesByUser.get(recipient.id) || [],
      actionUrl: `${appBaseUrl()}/timetables`,
    }),
    metadata: {
      job_id: job.id,
      user_id: recipient.id,
      local_date: localDate,
    },
  }))
  const notificationDeliveries = organizationAgenda.length
    ? organizationNotificationRecipients(organization).map(recipient => ({
        recipient,
        content: buildTimetableAgendaEmail({
          recipientName: recipient.name,
          notificationCopy: true,
          organisationName: organization?.name || 'Institute',
          localDate,
          entries: organizationAgenda,
          actionUrl: `${appBaseUrl()}/timetables`,
        }),
        metadata: {
          job_id: job.id,
          recipient_type: 'organization_notification',
          local_date: localDate,
        },
      }))
    : []
  return uniqueByRecipientEmail([...studentDeliveries, ...notificationDeliveries])
}

async function attendanceAbsenceDeliveries(job: ClaimedJob): Promise<PreparedDelivery[]> {
  const payload = (job.payload || {}) as JobPayload
  const recipientIds = [...new Set(payload.recipientIds || [])]
  if (!recipientIds.length) return []
  const session = (await database().select().from(attendanceSessions)
    .where(eq(attendanceSessions.id, job.entityId)).limit(1))[0]
  if (!session) return []
  const entry = (await database().select().from(timetableEntries)
    .where(eq(timetableEntries.id, session.timetableEntryId)).limit(1))[0]
  const organization = (await database().select().from(organizations)
    .where(eq(organizations.id, session.organizationId)).limit(1))[0]
  const recipients = await database().select().from(users).where(inArray(users.id, recipientIds))
  const baseUrl = appBaseUrl()
  const brand = getBrandConfig(new URL(baseUrl).hostname)

  return recipients.map(recipient => ({
    recipient,
    brand,
    content: buildAttendanceAbsenceEmail({
      brand,
      appUrl: baseUrl,
      recipientName: recipient.name,
      organisationName: organization?.name || brand.organizationName || 'Institute',
      subject: entry?.subject || 'Class',
      classDate: session.classDate,
      startTime: entry?.startTime,
      endTime: entry?.endTime,
      actionUrl: `${baseUrl}/attendance`,
    }),
    metadata: {
      job_id: job.id,
      session_id: session.id,
      user_id: recipient.id,
      event_type: 'attendance_absent',
    },
  }))
}

async function existingDelivery(jobId: string, recipientEmail: string) {
  return (await database().select().from(emailDeliveries).where(and(
    eq(emailDeliveries.jobId, jobId),
    eq(emailDeliveries.recipientEmail, recipientEmail),
  )).limit(1))[0]
}

async function deliver(job: ClaimedJob, delivery: PreparedDelivery) {
  const { recipient, content, metadata, brand } = delivery
  const existing = await existingDelivery(job.id, recipient.email)
  if (existing?.status === 'sent' || existing?.status === 'skipped') return true
  if (!isEmailAddress(recipient.email)) {
    await database().insert(emailDeliveries).values({
      jobId: job.id,
      recipientUserId: recipient.id,
      recipientEmail: recipient.email,
      status: 'skipped',
      error: 'Missing or invalid email address.',
    }).onConflictDoUpdate({
      target: [emailDeliveries.jobId, emailDeliveries.recipientEmail],
      set: { status: 'skipped', error: 'Missing or invalid email address.', attemptedAt: new Date() },
    })
    return true
  }
  try {
    const result = await sendEmail({ to: recipient.email, ...content, metadata, brand })
    await database().insert(emailDeliveries).values({
      jobId: job.id,
      recipientUserId: recipient.id,
      recipientEmail: recipient.email,
      status: 'sent',
      providerMessageId: result.providerMessageId,
    }).onConflictDoUpdate({
      target: [emailDeliveries.jobId, emailDeliveries.recipientEmail],
      set: { status: 'sent', providerMessageId: result.providerMessageId, error: null, attemptedAt: new Date() },
    })
    return true
  } catch (error) {
    const message = (error instanceof Error ? error.message : 'Delivery failed.')
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500)
    await database().insert(emailDeliveries).values({
      jobId: job.id,
      recipientUserId: recipient.id,
      recipientEmail: recipient.email,
      status: 'failed',
      error: message,
    }).onConflictDoUpdate({
      target: [emailDeliveries.jobId, emailDeliveries.recipientEmail],
      set: { status: 'failed', error: message, attemptedAt: new Date() },
    })
    return false
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

async function processClaimedJob(job: ClaimedJob, now: Date) {
  if (job.kind === 'timetable_published') {
    await database().update(emailJobs).set({
      status: 'cancelled',
      leaseUntil: null,
      lastError: 'Superseded by the once-daily 7:00 AM timetable agenda.',
      updatedAt: now,
    }).where(eq(emailJobs.id, job.id))
    return 'cancelled' as const
  }

  const deliveries = job.kind === 'timetable_agenda'
    ? await timetableAgendaDeliveries(job)
    : job.kind === 'attendance_absent'
      ? await attendanceAbsenceDeliveries(job)
      : await taskDeliveries(job)
  const results = await mapWithConcurrency(deliveries, 8, delivery => deliver(job, delivery))
  const failedDeliveries = results.filter(result => !result).length
  const attempts = job.attempts + 1
  if (failedDeliveries) {
    await database().update(emailJobs).set({
      status: attempts >= maxAttempts ? 'failed' : 'pending',
      attempts,
      leaseUntil: null,
      nextAttemptAt: retryAtForAttempt(attempts, now),
      lastError: `${failedDeliveries} email delivery attempt${failedDeliveries === 1 ? '' : 's'} failed.`,
      updatedAt: now,
    }).where(eq(emailJobs.id, job.id))
    return 'failed' as const
  }
  await database().update(emailJobs).set({
    status: 'sent',
    attempts,
    leaseUntil: null,
    lastError: null,
    updatedAt: now,
  }).where(eq(emailJobs.id, job.id))
  return 'sent' as const
}

export async function processEmailJob(jobId: string, now = new Date()) {
  const job = await claimJob(jobId, now)
  if (!job) return { processed: false, status: null }
  return { processed: true, status: await processClaimedJob(job, now) }
}

export async function processDueEmailJobs(limit = 20, now = new Date()) {
  const jobs = await claimJobs(limit, now)
  let sent = 0
  let failed = 0
  let cancelled = 0
  for (const job of jobs) {
    const status = await processClaimedJob(job, now)
    if (status === 'sent') sent += 1
    else if (status === 'failed') failed += 1
    else cancelled += 1
  }
  return { claimed: jobs.length, sent, failed, cancelled }
}
