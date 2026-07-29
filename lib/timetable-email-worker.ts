import 'server-only'

import type { Timestamp as FirestoreTimestamp } from 'firebase-admin/firestore'
import { adminDb, FieldValue, Timestamp } from './firebase-admin'
import { isEmailConfigured, sendEmail } from './email'
import { isEmailAddress } from './task-email-content'
import { retryAtForAttempt } from './task-email-plan'
import { resolveUserRecipients } from './task-api'
import { buildTimetableAgendaEmail } from './timetable-email-content'
import { timetableEmailDeliveryId } from './timetable-email-plan'
import { entriesForDate, type TimetableEntry } from './timetable'

type Recipient = {
  userId: string
  userName?: string
  userEmail?: string
}

type TimetableEmailJob = {
  jobType: 'publication' | 'agenda'
  eventType: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  nextAttemptAt: FirestoreTimestamp
  leaseUntil?: FirestoreTimestamp | null
  attempts?: number
  organisationId?: string
  localDate?: string
}

type PublishedTimetable = {
  id: string
  status: 'active' | 'archived'
  name: string
  organisationId: string
  organisationName: string
  effectiveFrom: string
  effectiveTo: string
  assignedUserIds: string[]
  entries: TimetableEntry[]
}

type PreparedDelivery = {
  recipient: Recipient
  content: { subject: string; text: string; html?: string }
}

type DeliveryResult =
  | { state: 'settled' }
  | { state: 'failed' }
  | { state: 'retry'; nextAttemptAt: Date }

const leaseMilliseconds = 3 * 60_000
const maxDeliveryAttempts = 5

function actionUrl() {
  const base = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
  return `${base}/timetables`
}

function sanitizeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown email delivery error.'
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500)
}

async function claimJob(jobId: string, now: Date) {
  const reference = adminDb.collection('timetableEmailJobs').doc(jobId)
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists) return null
    const data = snapshot.data() as TimetableEmailJob
    if (data.status !== 'pending' || data.nextAttemptAt.toDate().getTime() > now.getTime()) return null
    transaction.update(reference, {
      status: 'processing',
      attempts: (data.attempts || 0) + 1,
      leaseUntil: Timestamp.fromMillis(now.getTime() + leaseMilliseconds),
      updatedAt: Timestamp.fromDate(now),
    })
    return data
  })
}

async function claimDelivery(jobId: string, recipient: Recipient, now: Date) {
  const reference = adminDb.collection('timetableEmailDeliveries')
    .doc(timetableEmailDeliveryId(jobId, recipient.userId))
  const claim = await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference)
    const data = snapshot.data()
    if (['sent', 'skipped', 'failed'].includes(data?.status)) {
      return { claimed: false as const, terminal: true as const }
    }
    if (data?.status === 'processing' && data.leaseUntil?.toDate().getTime() > now.getTime()) {
      return { claimed: false as const, terminal: false as const, retryAt: data.leaseUntil.toDate() as Date }
    }
    if (data?.status === 'pending' && data.nextAttemptAt?.toDate().getTime() > now.getTime()) {
      return { claimed: false as const, terminal: false as const, retryAt: data.nextAttemptAt.toDate() as Date }
    }
    const attempts = (data?.attempts || 0) + 1
    transaction.set(reference, {
      jobId,
      userId: recipient.userId,
      status: 'processing',
      attempts,
      leaseUntil: Timestamp.fromMillis(now.getTime() + leaseMilliseconds),
      createdAt: snapshot.exists ? data?.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      updatedAt: Timestamp.fromDate(now),
    }, { merge: true })
    return { claimed: true as const, attempts }
  })
  return { reference, claim }
}

async function skipInvalidRecipient(jobId: string, recipient: Recipient, now: Date) {
  const reference = adminDb.collection('timetableEmailDeliveries')
    .doc(timetableEmailDeliveryId(jobId, recipient.userId))
  await reference.set({
    jobId,
    userId: recipient.userId,
    status: 'skipped',
    skipReason: 'missing-or-invalid-email',
    leaseUntil: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: Timestamp.fromDate(now),
  }, { merge: true })
  return { state: 'settled' } as DeliveryResult
}

async function deliver(jobId: string, delivery: PreparedDelivery, now: Date): Promise<DeliveryResult> {
  const { recipient, content } = delivery
  if (!recipient.userEmail || !isEmailAddress(recipient.userEmail)) {
    return skipInvalidRecipient(jobId, recipient, now)
  }
  const { reference, claim } = await claimDelivery(jobId, recipient, now)
  if (!claim.claimed) {
    return claim.terminal
      ? { state: 'settled' }
      : { state: 'retry', nextAttemptAt: claim.retryAt }
  }
  try {
    const response = await sendEmail({
      to: recipient.userEmail,
      ...content,
      metadata: { timetable_job_id: jobId, user_id: recipient.userId },
    })
    await reference.set({
      status: 'sent',
      providerMessageId: response.providerMessageId || null,
      sentAt: FieldValue.serverTimestamp(),
      leaseUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { state: 'settled' }
  } catch (error) {
    const lastError = sanitizeError(error)
    if (claim.attempts >= maxDeliveryAttempts) {
      await reference.set({
        status: 'failed',
        lastError,
        failedAt: FieldValue.serverTimestamp(),
        leaseUntil: null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return { state: 'failed' }
    }
    const nextAttemptAt = retryAtForAttempt(claim.attempts, now)
    await reference.set({
      status: 'pending',
      lastError,
      nextAttemptAt: Timestamp.fromDate(nextAttemptAt),
      leaseUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { state: 'retry', nextAttemptAt }
  }
}

async function prepareAgenda(job: TimetableEmailJob) {
  if (!job.organisationId || !job.localDate) return []
  const snapshot = await adminDb.collection('timetables')
    .where('organisationId', '==', job.organisationId)
    .get()
  const timetables = snapshot.docs
    .map(document => ({ id: document.id, ...document.data() }) as PublishedTimetable)
    .filter(timetable => (
      timetable.status === 'active'
      && timetable.effectiveFrom <= job.localDate!
      && timetable.effectiveTo >= job.localDate!
    ))
  const recipients = new Map((await resolveUserRecipients(
    [...new Set(timetables.flatMap(timetable => timetable.assignedUserIds || []))],
  )).map(recipient => [recipient.userId, recipient]))
  const byUser = new Map<string, {
    recipient: Recipient
    organisationName: string
    entries: Array<TimetableEntry & { timetableName: string }>
  }>()
  timetables.forEach(timetable => {
    const entries = entriesForDate(timetable.entries, job.localDate!)
    if (!entries.length) return
    timetable.assignedUserIds.forEach(userId => {
      const recipient = recipients.get(userId)
      if (!recipient) return
      const agenda = byUser.get(recipient.userId) || {
        recipient,
        organisationName: timetable.organisationName,
        entries: [],
      }
      agenda.entries.push(...entries.map(entry => ({ ...entry, timetableName: timetable.name })))
      byUser.set(recipient.userId, agenda)
    })
  })
  return [...byUser.values()].map(agenda => ({
    recipient: agenda.recipient,
    content: buildTimetableAgendaEmail({
      recipientName: agenda.recipient.userName,
      organisationName: agenda.organisationName,
      localDate: job.localDate!,
      entries: agenda.entries,
      actionUrl: actionUrl(),
    }),
  }))
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

export async function processTimetableEmailJob(jobId: string, now = new Date()) {
  const job = await claimJob(jobId, now)
  if (!job) return { processed: false, sentOrSkipped: 0, failed: 0, retrying: 0 }
  const reference = adminDb.collection('timetableEmailJobs').doc(jobId)
  // Publication/update/withdrawal emails were removed. Completing legacy jobs
  // with no deliveries prevents already-queued announcements from being sent.
  const deliveries = job.jobType === 'agenda'
    ? await prepareAgenda(job)
    : []
  const results = await mapWithConcurrency(deliveries, 8, delivery => deliver(jobId, delivery, now))
  const retries = results.filter((result): result is Extract<DeliveryResult, { state: 'retry' }> => result.state === 'retry')
  const failures = results.filter(result => result.state === 'failed')

  if (retries.length) {
    const nextAttemptAt = new Date(Math.min(...retries.map(result => result.nextAttemptAt.getTime())))
    await reference.update({
      status: 'pending',
      nextAttemptAt: Timestamp.fromDate(nextAttemptAt),
      leaseUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
    })
  } else {
    await reference.update({
      status: failures.length ? 'failed' : 'completed',
      completedAt: FieldValue.serverTimestamp(),
      completionReason: deliveries.length ? null : 'no-active-recipients',
      failedDeliveries: failures.length,
      leaseUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
  return {
    processed: true,
    sentOrSkipped: results.length - retries.length - failures.length,
    failed: failures.length,
    retrying: retries.length,
  }
}

async function reclaimExpiredJobs(now: Date) {
  const expired = await adminDb.collection('timetableEmailJobs')
    .where('status', '==', 'processing')
    .where('leaseUntil', '<=', Timestamp.fromDate(now))
    .limit(20)
    .get()
  if (expired.empty) return 0
  const batch = adminDb.batch()
  expired.docs.forEach(document => batch.update(document.ref, {
    status: 'pending',
    nextAttemptAt: Timestamp.fromDate(now),
    leaseUntil: null,
    updatedAt: Timestamp.fromDate(now),
  }))
  await batch.commit()
  return expired.size
}

export async function processDueTimetableEmailJobs(now = new Date()) {
  if (!isEmailConfigured()) {
    throw new Error('Email delivery is not configured. Set SENDGRID_API_KEY and EMAIL_FROM_ADDRESS.')
  }
  const reclaimed = await reclaimExpiredJobs(now)
  const due = await adminDb.collection('timetableEmailJobs')
    .where('status', '==', 'pending')
    .where('nextAttemptAt', '<=', Timestamp.fromDate(now))
    .orderBy('nextAttemptAt', 'asc')
    .limit(10)
    .get()
  const results = await mapWithConcurrency(due.docs, 3, document => processTimetableEmailJob(document.id, now))
  return {
    reclaimed,
    jobsFound: due.size,
    jobsProcessed: results.filter(result => result.processed).length,
    deliveriesSettled: results.reduce((sum, result) => sum + result.sentOrSkipped, 0),
    deliveriesRetrying: results.reduce((sum, result) => sum + result.retrying, 0),
    deliveriesFailed: results.reduce((sum, result) => sum + result.failed, 0),
  }
}
