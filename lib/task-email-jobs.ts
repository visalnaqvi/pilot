import 'server-only'

import { adminDb, FieldValue, Timestamp } from './firebase-admin'
import { planTaskEmailJobs } from './task-email-plan'

export async function ensureTaskEmailJobs(input: {
  taskId: string
  createdAt: Date
  startAt?: Date | null
  endAt?: Date | null
}) {
  const jobs = planTaskEmailJobs(input)
  await Promise.all(jobs.map(job => adminDb.runTransaction(async transaction => {
    const reference = adminDb.collection('taskEmailJobs').doc(job.id)
    const existing = await transaction.get(reference)
    if (existing.exists) return
    transaction.create(reference, {
      taskId: job.taskId,
      eventType: job.eventType,
      dueAt: Timestamp.fromDate(job.dueAt),
      nextAttemptAt: Timestamp.fromDate(job.dueAt),
      status: 'pending',
      attempts: 0,
      leaseUntil: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  })))
  return jobs
}
