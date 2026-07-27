import { after } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { z } from 'zod'
import { errorResponse, requireRole } from '@/lib/admin-api'
import { isEmailConfigured } from '@/lib/email'
import { adminDb } from '@/lib/firebase-admin'
import { resolveAssignmentAudience } from '@/lib/task-api'
import { ensureTaskEmailJobs } from '@/lib/task-email-jobs'
import { taskEmailJobId } from '@/lib/task-email-plan'
import { processTaskEmailJob } from '@/lib/task-email-worker'

export const runtime = 'nodejs'
export const maxDuration = 60

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const createAssignmentSchema = z.object({
  taskId: identifier,
  assignmentBatchId: identifier,
  name: z.string().trim().min(1).max(200),
  testId: identifier,
  targetType: z.enum(['group', 'user']),
  targetId: identifier,
  startAt: z.string().datetime(),
  deadline: z.string().datetime(),
  maxAttempts: z.number().int().min(1).max(100),
})

function queueImmediateDelivery(taskId: string) {
  if (!isEmailConfigured()) return
  after(() => processTaskEmailJob(taskEmailJobId(taskId, 'assigned'))
    .catch(error => console.error('Immediate assignment email processing failed.', error)))
}

async function repairMissingAssignmentDocuments(
  taskId: string,
  assignmentBatchId: string,
  taskData: FirebaseFirestore.DocumentData,
  batchData: FirebaseFirestore.DocumentData,
) {
  const assignees = Array.isArray(taskData.assignedUsers)
    ? taskData.assignedUsers.filter((assignee: unknown): assignee is { userId: string; userEmail: string } => {
      if (!assignee || typeof assignee !== 'object') return false
      const candidate = assignee as { userId?: unknown; userEmail?: unknown }
      return typeof candidate.userId === 'string' && typeof candidate.userEmail === 'string'
    })
    : []
  for (let index = 0; index < assignees.length; index += 450) {
    const chunk = assignees.slice(index, index + 450)
    const references = chunk.map(assignee => (
      adminDb.collection('testAssignments').doc(`${batchData.testId}_${assignee.userId}`)
    ))
    const snapshots = await adminDb.getAll(...references)
    const missing = snapshots
      .map((snapshot, snapshotIndex) => ({ snapshot, assignee: chunk[snapshotIndex] }))
      .filter(item => !item.snapshot.exists)
    if (!missing.length) continue
    const write = adminDb.batch()
    missing.forEach(({ snapshot, assignee }) => write.set(snapshot.ref, {
      testId: batchData.testId,
      testTitle: batchData.testTitle,
      userId: assignee.userId,
      userEmail: assignee.userEmail,
      assignedBy: batchData.assignedBy,
      assignmentBatchId,
      assignmentName: batchData.name,
      linkedTaskId: taskId,
      maxAttempts: batchData.maxAttempts,
      attemptsUsed: 0,
      startAt: batchData.startAt,
      deadline: batchData.deadline,
      endAt: batchData.endAt,
      createdAt: batchData.createdAt,
    }))
    await write.commit()
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ['organisation', 'admin'])
  if ('error' in auth) return auth.error
  try {
    const body = await request.json().catch(() => null)
    const parsed = createAssignmentSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: 'Invalid assignment details.', issues: parsed.error.issues }, { status: 400 })
    }
    const input = parsed.data
    const now = new Date()
    const startAt = new Date(input.startAt)
    const deadline = new Date(input.deadline)
    if (deadline <= startAt) {
      return Response.json({ error: 'The deadline must be after the start time.' }, { status: 400 })
    }
    if (deadline <= now) {
      return Response.json({ error: 'The deadline must be in the future.' }, { status: 400 })
    }

    const [test, existingTask, existingBatch] = await Promise.all([
      adminDb.collection('tests').doc(input.testId).get(),
      adminDb.collection('tasks').doc(input.taskId).get(),
      adminDb.collection('assignmentBatches').doc(input.assignmentBatchId).get(),
    ])
    if (!test.exists || test.data()?.deletedAt != null || test.data()?.published === false || test.data()?.visibility !== 'assigned') {
      return Response.json({ error: 'Select a published Assigned-mode test.' }, { status: 400 })
    }
    if (auth.user.role === 'organisation' && test.data()?.createdBy !== auth.user.uid) {
      return Response.json({ error: 'You can only assign tests created by your institute.' }, { status: 403 })
    }
    if (existingTask.exists || existingBatch.exists) {
      const matchingTask = existingTask.data()?.createdBy === auth.user.uid
        && existingTask.data()?.linkedAssignmentBatchId === input.assignmentBatchId
      const matchingBatch = existingBatch.data()?.assignedBy === auth.user.uid
        && existingBatch.data()?.linkedTaskId === input.taskId
      if (!matchingTask || !matchingBatch) {
        return Response.json({ error: 'One of the submitted IDs is already in use.' }, { status: 409 })
      }
      await repairMissingAssignmentDocuments(
        input.taskId,
        input.assignmentBatchId,
        existingTask.data()!,
        existingBatch.data()!,
      )
      const existingStart = existingTask.data()?.startAt?.toDate() || null
      const existingEnd = existingTask.data()?.endAt?.toDate() || null
      await ensureTaskEmailJobs({
        taskId: input.taskId,
        createdAt: existingTask.data()?.createdAt?.toDate() || now,
        startAt: existingStart,
        endAt: existingEnd,
      })
      queueImmediateDelivery(input.taskId)
      return Response.json({ taskId: input.taskId, assignmentBatchId: input.assignmentBatchId, existing: true })
    }

    const audience = await resolveAssignmentAudience({
      actorId: auth.user.uid,
      actorRole: auth.user.role as 'organisation' | 'admin',
      targetType: input.targetType,
      targetId: input.targetId,
    })
    const testData = test.data()!
    const batchReference = adminDb.collection('assignmentBatches').doc(input.assignmentBatchId)
    const taskReference = adminDb.collection('tasks').doc(input.taskId)
    const baseAssignment = {
      testId: input.testId,
      testTitle: String(testData.title),
      assignedBy: auth.user.uid,
      assignmentBatchId: input.assignmentBatchId,
      assignmentName: input.name,
      linkedTaskId: input.taskId,
      maxAttempts: input.maxAttempts,
      attemptsUsed: 0,
      startAt: Timestamp.fromDate(startAt),
      deadline: Timestamp.fromDate(deadline),
      endAt: Timestamp.fromDate(deadline),
      createdAt: Timestamp.fromDate(now),
    }

    const firstWrite = adminDb.batch()
    firstWrite.create(batchReference, {
      name: input.name,
      testId: input.testId,
      testTitle: String(testData.title),
      exam: testData.exam || 'Uncategorised',
      assignedBy: auth.user.uid,
      audienceName: audience.audienceName,
      assignedUserIds: audience.assignees.map(assignee => assignee.userId),
      assignedCount: audience.assignees.length,
      maxAttempts: input.maxAttempts,
      linkedTaskId: input.taskId,
      startAt: Timestamp.fromDate(startAt),
      deadline: Timestamp.fromDate(deadline),
      endAt: Timestamp.fromDate(deadline),
      createdAt: Timestamp.fromDate(now),
    })
    firstWrite.create(taskReference, {
      organisationId: auth.user.uid,
      createdBy: auth.user.uid,
      createdByName: auth.user.name,
      organisationName: auth.user.name,
      title: input.name,
      description: `Complete the assigned test “${String(testData.title)}” before the assignment deadline.`,
      taskType: 'basic',
      sourceType: 'assignment',
      linkedAssignmentBatchId: input.assignmentBatchId,
      linkedTestId: input.testId,
      status: 'todo',
      assignedUserIds: audience.assignees.map(assignee => assignee.userId),
      assignedUsers: audience.assignees,
      assignedGroupIds: input.targetType === 'group' ? [input.targetId] : [],
      audienceNames: audience.audienceName ? [audience.audienceName] : [],
      attachments: [],
      isClosed: false,
      startAt: Timestamp.fromDate(startAt),
      endAt: Timestamp.fromDate(deadline),
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
      statusUpdatedAt: Timestamp.fromDate(now),
      statusUpdatedBy: auth.user.uid,
      statusUpdatedByName: auth.user.name,
    })
    audience.assignees.slice(0, 448).forEach(assignee => {
      firstWrite.set(adminDb.collection('testAssignments').doc(`${input.testId}_${assignee.userId}`), {
        ...baseAssignment,
        userId: assignee.userId,
        userEmail: assignee.userEmail,
      })
    })
    await firstWrite.commit()
    for (let index = 448; index < audience.assignees.length; index += 450) {
      const write = adminDb.batch()
      audience.assignees.slice(index, index + 450).forEach(assignee => {
        write.set(adminDb.collection('testAssignments').doc(`${input.testId}_${assignee.userId}`), {
          ...baseAssignment,
          userId: assignee.userId,
          userEmail: assignee.userEmail,
        })
      })
      await write.commit()
    }

    await ensureTaskEmailJobs({ taskId: input.taskId, createdAt: now, startAt, endAt: deadline })
    queueImmediateDelivery(input.taskId)
    return Response.json({ taskId: input.taskId, assignmentBatchId: input.assignmentBatchId }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'Unable to create the assignment.')
  }
}
