import 'server-only'

import type { DocumentData, DocumentReference, Timestamp as FirestoreTimestamp } from 'firebase-admin/firestore'
import { adminDb, FieldValue, Timestamp } from './firebase-admin'
import { isEmailConfigured, sendEmail } from './email'
import { buildTaskEmail, isEmailAddress } from './task-email-content'
import {
  retryAtForAttempt,
  taskEmailSkipReason,
  taskEmailDeliveryId,
  type TaskEmailEventType,
} from './task-email-plan'

type JobData = {
  taskId: string
  eventType: TaskEmailEventType
  status: 'pending' | 'processing' | 'completed' | 'failed'
  nextAttemptAt: FirestoreTimestamp
  leaseUntil?: FirestoreTimestamp | null
  attempts?: number
}

type Assignee = {
  userId: string
  userName?: string
  userEmail?: string
}

type TaskData = {
  title: string
  description?: string
  organisationName?: string
  createdByName?: string
  assignedUsers?: Assignee[]
  assignedUserIds?: string[]
  sourceType?: 'assignment'
  linkedAssignmentBatchId?: string
  linkedTestId?: string
  startAt?: FirestoreTimestamp | null
  endAt?: FirestoreTimestamp | null
  isClosed?: boolean
  closedBy?: string
}

type DeliveryResult =
  | { state: 'settled' }
  | { state: 'failed' }
  | { state: 'retry'; nextAttemptAt: Date }

const leaseMilliseconds = 3 * 60_000
const maxDeliveryAttempts = 5

function sanitizeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown email delivery error.'
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500)
}

function timestampDate(value?: FirestoreTimestamp | null) {
  return value?.toDate() || null
}

function actionUrl(task: TaskData) {
  const base = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
  const path = task.sourceType === 'assignment' && task.linkedTestId
    ? `/tests/${encodeURIComponent(task.linkedTestId)}${task.linkedAssignmentBatchId ? `?assignment=${encodeURIComponent(task.linkedAssignmentBatchId)}` : ''}`
    : '/tasks'
  return `${base}${path}`
}

async function settleSkippedDelivery(
  reference: DocumentReference<DocumentData>,
  jobId: string,
  job: JobData,
  recipient: Assignee,
  reason: string,
  now: Date,
): Promise<DeliveryResult> {
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference)
    const status = snapshot.data()?.status
    if (status === 'sent' || status === 'skipped' || status === 'failed') return
    transaction.set(reference, {
      jobId,
      taskId: job.taskId,
      userId: recipient.userId,
      eventType: job.eventType,
      status: 'skipped',
      skipReason: reason,
      attempts: snapshot.data()?.attempts || 0,
      leaseUntil: null,
      updatedAt: Timestamp.fromDate(now),
      createdAt: snapshot.exists ? snapshot.data()?.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
    }, { merge: true })
  })
  return { state: 'settled' }
}

async function claimDelivery(
  reference: DocumentReference<DocumentData>,
  jobId: string,
  job: JobData,
  recipient: Assignee,
  now: Date,
) {
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference)
    const data = snapshot.data()
    if (data?.status === 'sent' || data?.status === 'skipped' || data?.status === 'failed') {
      return { claimed: false as const, terminal: true as const }
    }
    if (data?.status === 'processing' && data.leaseUntil?.toDate().getTime() > now.getTime()) {
      return {
        claimed: false as const,
        terminal: false as const,
        retryAt: data.leaseUntil.toDate() as Date,
      }
    }
    if (data?.status === 'pending' && data.nextAttemptAt?.toDate().getTime() > now.getTime()) {
      return {
        claimed: false as const,
        terminal: false as const,
        retryAt: data.nextAttemptAt.toDate() as Date,
      }
    }
    const attempts = (data?.attempts || 0) + 1
    transaction.set(reference, {
      jobId,
      taskId: job.taskId,
      userId: recipient.userId,
      eventType: job.eventType,
      status: 'processing',
      attempts,
      leaseUntil: Timestamp.fromMillis(now.getTime() + leaseMilliseconds),
      updatedAt: Timestamp.fromDate(now),
      createdAt: snapshot.exists ? data?.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
    }, { merge: true })
    return { claimed: true as const, attempts }
  })
}

async function deliverToRecipient(input: {
  jobId: string
  job: JobData
  task: TaskData
  recipient: Assignee
  status?: string
  submitted: boolean
  now: Date
}): Promise<DeliveryResult> {
  const { jobId, job, task, recipient, status, submitted, now } = input
  const reference = adminDb.collection('taskEmailDeliveries').doc(taskEmailDeliveryId(jobId, recipient.userId))

  if (!recipient.userEmail || !isEmailAddress(recipient.userEmail)) {
    return settleSkippedDelivery(reference, jobId, job, recipient, 'missing-or-invalid-email', now)
  }
  const skipReason = taskEmailSkipReason({
    eventType: job.eventType,
    manuallyClosed: Boolean(task.isClosed && task.closedBy !== 'system'),
    assigneeStatus: status,
    submitted,
  })
  if (skipReason) {
    return settleSkippedDelivery(reference, jobId, job, recipient, skipReason, now)
  }

  const claim = await claimDelivery(reference, jobId, job, recipient, now)
  if (!claim.claimed) {
    return claim.terminal
      ? { state: 'settled' }
      : { state: 'retry', nextAttemptAt: claim.retryAt }
  }

  try {
    const content = buildTaskEmail({
      eventType: job.eventType,
      recipientName: recipient.userName,
      taskTitle: task.title,
      organisationName: task.organisationName || task.createdByName || 'Institute',
      description: task.description,
      startAt: timestampDate(task.startAt),
      endAt: timestampDate(task.endAt),
      actionUrl: actionUrl(task),
      timeZone: process.env.APP_TIME_ZONE || 'Asia/Kolkata',
      now,
    })
    const response = await sendEmail({
      to: recipient.userEmail,
      ...content,
      metadata: {
        task_id: job.taskId,
        user_id: recipient.userId,
        event_type: job.eventType,
      },
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

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
) {
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

async function claimJob(jobId: string, now: Date) {
  const reference = adminDb.collection('taskEmailJobs').doc(jobId)
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists) return null
    const data = snapshot.data() as JobData
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

export async function processTaskEmailJob(jobId: string, now = new Date()) {
  const job = await claimJob(jobId, now)
  if (!job) return { processed: false, sentOrSkipped: 0, failed: 0, retrying: 0 }
  const jobReference = adminDb.collection('taskEmailJobs').doc(jobId)
  const taskSnapshot = await adminDb.collection('tasks').doc(job.taskId).get()
  if (!taskSnapshot.exists) {
    await jobReference.update({
      status: 'completed',
      completionReason: 'task-missing',
      completedAt: FieldValue.serverTimestamp(),
      leaseUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { processed: true, sentOrSkipped: 0, failed: 0, retrying: 0 }
  }

  const task = taskSnapshot.data() as TaskData
  const recipients = task.assignedUsers || []
  const statusSnapshot = await taskSnapshot.ref.collection('assignees').get()
  const statuses = new Map(statusSnapshot.docs.map(document => [
    document.id,
    document.data().status as string | undefined,
  ]))
  const submittedUserIds = new Set<string>()
  if (task.sourceType === 'assignment' && task.linkedAssignmentBatchId) {
    const submissions = await adminDb.collection('submissions')
      .where('assignmentBatchId', '==', task.linkedAssignmentBatchId)
      .get()
    submissions.docs.forEach(document => {
      const userId = document.data().userId
      if (typeof userId === 'string') submittedUserIds.add(userId)
    })
  }

  const results = await mapWithConcurrency(recipients, 8, recipient => deliverToRecipient({
    jobId,
    job,
    task,
    recipient,
    status: statuses.get(recipient.userId),
    submitted: submittedUserIds.has(recipient.userId),
    now,
  }))
  const retries = results.filter((result): result is Extract<DeliveryResult, { state: 'retry' }> => result.state === 'retry')
  const failures = results.filter(result => result.state === 'failed')

  if (retries.length) {
    const nextAttemptAt = new Date(Math.min(...retries.map(result => result.nextAttemptAt.getTime())))
    await jobReference.update({
      status: 'pending',
      nextAttemptAt: Timestamp.fromDate(nextAttemptAt),
      leaseUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
    })
  } else {
    await jobReference.update({
      status: failures.length ? 'failed' : 'completed',
      completedAt: FieldValue.serverTimestamp(),
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
  const expired = await adminDb.collection('taskEmailJobs')
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

export async function processDueTaskEmailJobs(now = new Date()) {
  if (!isEmailConfigured()) {
    throw new Error('Email delivery is not configured. Set SENDGRID_API_KEY and EMAIL_FROM_ADDRESS.')
  }
  const reclaimed = await reclaimExpiredJobs(now)
  const due = await adminDb.collection('taskEmailJobs')
    .where('status', '==', 'pending')
    .where('nextAttemptAt', '<=', Timestamp.fromDate(now))
    .orderBy('nextAttemptAt', 'asc')
    .limit(10)
    .get()
  const results = await mapWithConcurrency(due.docs, 3, document => processTaskEmailJob(document.id, now))
  return {
    reclaimed,
    jobsFound: due.size,
    jobsProcessed: results.filter(result => result.processed).length,
    deliveriesSettled: results.reduce((sum, result) => sum + result.sentOrSkipped, 0),
    deliveriesRetrying: results.reduce((sum, result) => sum + result.retrying, 0),
    deliveriesFailed: results.reduce((sum, result) => sum + result.failed, 0),
  }
}
