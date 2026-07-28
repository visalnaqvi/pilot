import { after } from 'next/server'
import { z } from 'zod'
import { errorResponse, requireRole } from '@/lib/admin-api'
import { isEmailConfigured } from '@/lib/email'
import { adminDb, Timestamp } from '@/lib/firebase-admin'
import { resolveOrganisationTaskAudience } from '@/lib/task-api'
import { ensureTaskEmailJobs } from '@/lib/task-email-jobs'
import { taskEmailJobId } from '@/lib/task-email-plan'
import { processTaskEmailJob } from '@/lib/task-email-worker'

export const runtime = 'nodejs'
export const maxDuration = 60

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const attachmentSchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(255),
  path: z.string().trim().min(1).max(1_000),
  size: z.number().int().min(0).max(20 * 1024 * 1024),
  contentType: z.string().trim().min(1).max(200),
})
const createTaskSchema = z.object({
  taskId: identifier,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(10_000),
  taskType: z.enum(['basic', 'submission']),
  startAt: z.string().datetime().nullable(),
  endAt: z.string().datetime().nullable(),
  selectedUserIds: z.array(identifier).max(500),
  selectedGroupIds: z.array(identifier).max(100),
  attachments: z.array(attachmentSchema).max(50),
})

function queueImmediateDelivery(taskId: string) {
  if (!isEmailConfigured()) return
  after(() => processTaskEmailJob(taskEmailJobId(taskId, 'assigned'))
    .catch(error => console.error('Immediate task email processing failed.', error)))
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ['organisation'])
  if ('error' in auth) return auth.error
  try {
    const body = await request.json().catch(() => null)
    const parsed = createTaskSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: 'Invalid task details.', issues: parsed.error.issues }, { status: 400 })
    }
    const input = parsed.data
    const now = new Date()
    const startAt = input.startAt ? new Date(input.startAt) : null
    const endAt = input.endAt ? new Date(input.endAt) : null
    if (startAt && endAt && endAt <= startAt) {
      return Response.json({ error: 'The end time must be after the start time.' }, { status: 400 })
    }
    if (endAt && endAt <= now) {
      return Response.json({ error: 'The end time must be in the future.' }, { status: 400 })
    }
    const expectedPrefix = `task-attachments/${auth.user.uid}/${input.taskId}/`
    if (input.attachments.some(attachment => !attachment.path.startsWith(expectedPrefix))) {
      return Response.json({ error: 'One or more attachment paths is invalid.' }, { status: 400 })
    }

    const taskReference = adminDb.collection('tasks').doc(input.taskId)
    const existing = await taskReference.get()
    if (existing.exists) {
      if (existing.data()?.createdBy !== auth.user.uid) {
        return Response.json({ error: 'That task ID is already in use.' }, { status: 409 })
      }
      await ensureTaskEmailJobs({
        taskId: input.taskId,
        createdAt: existing.data()?.createdAt?.toDate() || now,
        startAt: existing.data()?.startAt?.toDate() || null,
        endAt: existing.data()?.endAt?.toDate() || null,
      })
      queueImmediateDelivery(input.taskId)
      return Response.json({ taskId: input.taskId, existing: true })
    }

    const audience = await resolveOrganisationTaskAudience({
      organisationId: auth.user.uid,
      selectedUserIds: input.selectedUserIds,
      selectedGroupIds: input.selectedGroupIds,
    })
    await taskReference.create({
      organisationId: auth.user.uid,
      createdBy: auth.user.uid,
      createdByName: auth.user.name,
      organisationName: auth.user.name,
      title: input.title,
      description: input.description,
      taskType: input.taskType,
      status: 'todo',
      assignedUserIds: audience.assignees.map(assignee => assignee.userId),
      assignedUsers: audience.assignees,
      assignedGroupIds: audience.groupIds,
      audienceNames: audience.audienceNames,
      attachments: input.attachments,
      isClosed: false,
      startAt: startAt ? Timestamp.fromDate(startAt) : null,
      endAt: endAt ? Timestamp.fromDate(endAt) : null,
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
      statusUpdatedAt: Timestamp.fromDate(now),
      statusUpdatedBy: auth.user.uid,
      statusUpdatedByName: auth.user.name,
    })
    await ensureTaskEmailJobs({ taskId: input.taskId, createdAt: now, startAt, endAt })
    queueImmediateDelivery(input.taskId)
    return Response.json({ taskId: input.taskId }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'Unable to create the task.')
  }
}
