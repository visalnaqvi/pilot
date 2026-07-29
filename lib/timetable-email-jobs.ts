import 'server-only'

import { adminDb, FieldValue, Timestamp } from './firebase-admin'
import { planTimetableAgendaJobs } from './timetable-email-plan'
import type { TimetableEntry } from './timetable'

export async function ensureTimetableAgendaJobs(input: {
  organisationId: string
  effectiveFrom: string
  effectiveTo: string
  entries: TimetableEntry[]
  timeZone: string
  now?: Date
}) {
  const jobs = planTimetableAgendaJobs({ ...input, now: input.now || new Date() })
  if (!jobs.length) return jobs
  const references = jobs.map(job => adminDb.collection('timetableEmailJobs').doc(job.id))
  const existing = await adminDb.getAll(...references)
  const missing = jobs.filter((_, index) => !existing[index].exists)

  for (let offset = 0; offset < missing.length; offset += 400) {
    const batch = adminDb.batch()
    missing.slice(offset, offset + 400).forEach(job => {
      batch.create(adminDb.collection('timetableEmailJobs').doc(job.id), {
        jobType: 'agenda',
        eventType: 'morning',
        organisationId: job.organisationId,
        localDate: job.localDate,
        dueAt: Timestamp.fromDate(job.dueAt),
        nextAttemptAt: Timestamp.fromDate(job.dueAt),
        status: 'pending',
        attempts: 0,
        leaseUntil: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    })
    await batch.commit()
  }
  return jobs
}

