import { z } from 'zod'
import { timetableEntryOverlaps, validDateKey, validTime } from './timetable'

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const optionalText = (maximum: number) => z.string().trim().max(maximum).optional().default('')

export const timetableEntrySchema = z.object({
  id: identifier,
  subject: z.string().trim().min(1).max(160),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
  startTime: z.string().refine(validTime, 'Enter a valid start time.'),
  endTime: z.string().refine(validTime, 'Enter a valid end time.'),
  teacher: optionalText(160),
  location: optionalText(300),
  meetingUrl: optionalText(2_000).refine(value => {
    if (!value) return true
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }, 'Meeting links must use http or https.'),
  notes: optionalText(2_000),
}).superRefine((entry, context) => {
  if (!entry.weekdays?.length && typeof entry.weekday !== 'number') {
    context.addIssue({
      code: 'custom',
      path: ['weekdays'],
      message: 'Select at least one day.',
    })
  }
  if (entry.endTime <= entry.startTime) {
    context.addIssue({
      code: 'custom',
      path: ['endTime'],
      message: 'The end time must be after the start time.',
    })
  }
}).transform(entry => {
  const { weekday, ...rest } = entry
  return {
    ...rest,
    weekdays: [...new Set(entry.weekdays?.length ? entry.weekdays : [weekday!])].sort((first, second) => first - second),
  }
})

export const timetableInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  effectiveFrom: z.string().refine(validDateKey, 'Enter a valid start date.'),
  effectiveTo: z.string().refine(validDateKey, 'Enter a valid end date.'),
  selectedUserIds: z.array(identifier).max(500),
  selectedGroupIds: z.array(identifier).max(100),
  entries: z.array(timetableEntrySchema).min(1).max(100),
}).superRefine((input, context) => {
  if (input.effectiveTo < input.effectiveFrom) {
    context.addIssue({
      code: 'custom',
      path: ['effectiveTo'],
      message: 'The end date must be on or after the start date.',
    })
  }
  if (!input.selectedUserIds.length && !input.selectedGroupIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['selectedUserIds'],
      message: 'Select at least one group or student.',
    })
  }
  if (timetableEntryOverlaps(input.entries).length) {
    context.addIssue({
      code: 'custom',
      path: ['entries'],
      message: 'Class times cannot overlap within the same timetable.',
    })
  }
})
