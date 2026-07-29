import {
  enumerateTimetableDates,
  localDateKey,
  localDateTimeToDate,
  type TimetableEntry,
} from './timetable'

export function timetableAgendaJobId(organisationId: string, localDate: string) {
  return `agenda:${organisationId}:${localDate}`
}

export function timetableEmailDeliveryId(jobId: string, userId: string) {
  return `${jobId}:${userId}`
}

export function planTimetableAgendaJobs(input: {
  organisationId: string
  effectiveFrom: string
  effectiveTo: string
  entries: TimetableEntry[]
  timeZone: string
  now: Date
}) {
  const today = localDateKey(input.now, input.timeZone)
  return enumerateTimetableDates({
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    entries: input.entries,
    notBefore: today,
  }).map(localDate => ({
    id: timetableAgendaJobId(input.organisationId, localDate),
    organisationId: input.organisationId,
    localDate,
    dueAt: localDateTimeToDate(localDate, '07:00', input.timeZone),
  })).filter(job => job.dueAt.getTime() >= input.now.getTime())
}
