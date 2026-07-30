import { z } from 'zod'

const identifier = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/)
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const openAttendanceSchema = z.object({
  timetableId: identifier,
  entryId: identifier,
  classDate: dateKey,
  intent: z.enum(['attendance', 'cancel']).optional().default('attendance'),
})

export const saveAttendanceSchema = z.object({
  revision: z.number().int().min(0),
  status: z.enum(['submitted', 'cancelled']),
  records: z.array(z.object({
    userId: identifier,
    status: z.enum(['present', 'absent']),
  })).max(500).default([]),
  cancellationReason: z.string().trim().max(500).optional().default(''),
}).superRefine((value, context) => {
  if (value.status === 'submitted' && !value.records.length) {
    context.addIssue({ code: 'custom', path: ['records'], message: 'Mark every student before submitting attendance.' })
  }
})

export const memberRoleUpdateSchema = z.object({
  memberRole: z.enum(['student', 'teacher']),
})
