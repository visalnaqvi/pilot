import { z } from 'zod'

export const timetablePayloadSchema = z.object({
  name: z.string().trim().min(1).max(240),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date(),
  timeZone: z.string().min(1).max(100).default('Asia/Kolkata'),
  selectedUserIds: z.array(z.string().min(1)).max(1_000).default([]),
  selectedGroupIds: z.array(z.string().uuid()).max(100).default([]),
  entries: z.array(z.object({
    subject: z.string().trim().min(1).max(240),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1),
    startTime: z.string().regex(/^\d{2}:\d{2}/),
    endTime: z.string().regex(/^\d{2}:\d{2}/),
    teacherUserId: z.string().nullable().optional(),
    teacher: z.string().max(160).optional(),
    location: z.string().max(240).optional(),
    meetingUrl: z.string().max(500).optional(),
    notes: z.string().max(5_000).optional(),
  })).min(1).max(500),
})

export const createTimetablePayloadSchema = timetablePayloadSchema.extend({
  organizationId: z.string().uuid(),
})
