import { after } from 'next/server'
import { z } from 'zod'
import { errorResponse, requireRole } from '@/lib/admin-api'
import { isEmailConfigured } from '@/lib/email'
import { adminDb, Timestamp } from '@/lib/firebase-admin'
import { resolveAssignmentAudience } from '@/lib/task-api'
import { ensureTaskEmailJobs } from '@/lib/task-email-jobs'
import { taskEmailJobId } from '@/lib/task-email-plan'
import { processTaskEmailJob } from '@/lib/task-email-worker'
import { assignmentInstanceId } from '@/lib/assignment-instance'
import { contentOrganisationFor } from '@/lib/teacher-access'
import { assignmentMatchesOrganisation } from '@/lib/assignment-scope'
import { memberRole } from '@/lib/membership'

export const runtime = 'nodejs'
export const maxDuration = 60

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const createAssignmentSchema = z.object({
  taskId: identifier,
  assignmentBatchId: identifier,
  organisationId: identifier.optional(),
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

function timestampJson(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value
    && typeof value.toDate === 'function') {
    return value.toDate().toISOString()
  }
  return value ?? null
}

function assignmentJson(document: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = document.data()
  return {
    id: document.id,
    ...data,
    startAt: timestampJson(data.startAt),
    deadline: timestampJson(data.deadline),
    endAt: timestampJson(data.endAt),
    createdAt: timestampJson(data.createdAt),
  }
}

function testJson(document: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = document.data()
  return {
    id: document.id,
    ...data,
    createdAt: timestampJson(data.createdAt),
    publishedAt: timestampJson(data.publishedAt),
    deletedAt: timestampJson(data.deletedAt),
  }
}

function submissionJson(document: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = document.data()
  return {
    id: document.id,
    ...data,
    submittedAt: timestampJson(data.submittedAt),
  }
}

function uniqueDocuments(snapshots: FirebaseFirestore.QuerySnapshot[]) {
  return [...new Map(snapshots
    .flatMap(snapshot => snapshot.docs)
    .map(document => [document.id, document])).values()]
}

async function organisationAssignments(organisationId: string) {
  const collection = adminDb.collection('assignmentBatches')
  const snapshots = await Promise.all([
    collection.where('organisationId', '==', organisationId).get(),
    collection.where('assignedBy', '==', organisationId).get(),
  ])
  return uniqueDocuments(snapshots)
    .filter(document => assignmentMatchesOrganisation(document.data(), organisationId))
}

async function assignmentSubmissions(assignmentIds: string[]) {
  const ids = [...new Set(assignmentIds)]
  const snapshots = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / 30) }, (_, index) => (
      adminDb.collection('submissions')
        .where('assignmentBatchId', 'in', ids.slice(index * 30, index * 30 + 30))
        .get()
    )),
  )
  return snapshots
    .flatMap(snapshot => snapshot.docs)
    .filter(document => document.data().gradingStatus !== 'pending')
}

async function organisationTests(organisationId: string) {
  const collection = adminDb.collection('tests')
  const snapshots = await Promise.all([
    collection.where('organisationId', '==', organisationId).get(),
    collection.where('createdBy', '==', organisationId).get(),
  ])
  return uniqueDocuments(snapshots).filter(document => {
    const data = document.data()
    const belongsToOrganisation = data.organisationId
      ? data.organisationId === organisationId
      : data.createdBy === organisationId
    return belongsToOrganisation
      && data.visibility === 'assigned'
      && data.deletedAt == null
      && data.published !== false
  })
}

async function managementGroups(organisationId?: string) {
  const snapshot = organisationId
    ? await adminDb.collection('organisationGroups').where('organisationId', '==', organisationId).get()
    : await adminDb.collection('organisationGroups').get()
  return Promise.all(snapshot.docs.map(async document => ({
    id: document.id,
    name: String(document.data().name || 'Batch'),
    members: (await document.ref.collection('members').get()).docs.map(member => ({
      userId: String(member.data().userId || member.id),
      userEmail: String(member.data().userEmail || ''),
    })),
  })))
}

async function managementUsers(organisationId?: string) {
  if (!organisationId) {
    const snapshot = await adminDb.collection('users').where('role', '==', 'user').get()
    return snapshot.docs.map(document => ({
      uid: document.id,
      email: String(document.data().email || ''),
      name: String(document.data().name || document.data().email || document.id),
      role: 'user' as const,
    }))
  }

  const invites = await adminDb.collection('organisationInvites')
    .where('organisationId', '==', organisationId)
    .get()
  const acceptedStudents = invites.docs.filter(document => (
    document.data().status === 'accepted'
      && memberRole(document.data().memberRole) === 'student'
  ))
  const profiles = acceptedStudents.length
    ? await adminDb.getAll(...acceptedStudents.map(document => (
        adminDb.collection('users').doc(String(document.data().userId))
      )))
    : []
  const profileById = new Map(profiles.map(profile => [profile.id, profile.data()]))
  return acceptedStudents.map(document => {
    const data = document.data()
    const uid = String(data.userId)
    const profile = profileById.get(uid)
    const email = String(profile?.email || data.userEmail || '')
    return {
      uid,
      email,
      name: String(profile?.name || data.userName || email || uid),
      role: 'user' as const,
    }
  })
}

export async function GET(request: Request) {
  const auth = await requireRole(request, ['user', 'organisation', 'admin'])
  if ('error' in auth) return auth.error

  try {
    const requestedOrganisationId = new URL(request.url).searchParams.get('organisationId')?.trim() || ''
    let organisationId: string | undefined
    if (auth.user.role === 'admin') {
      if (requestedOrganisationId) {
        const organisation = await adminDb.collection('users').doc(requestedOrganisationId).get()
        if (!organisation.exists || organisation.data()?.role !== 'organisation') {
          return Response.json({ error: 'The selected institute does not exist.' }, { status: 400 })
        }
        organisationId = requestedOrganisationId
      }
    } else {
      const organisation = await contentOrganisationFor(auth.user, requestedOrganisationId || undefined)
      if (!organisation) {
        return Response.json({ error: 'Select an institute where you can manage assignments.' }, { status: 403 })
      }
      organisationId = organisation.id
    }

    const assignments = organisationId
      ? await organisationAssignments(organisationId)
      : (await adminDb.collection('assignmentBatches').get()).docs
    const [tests, groups, users, submissions] = await Promise.all([
      organisationId
        ? organisationTests(organisationId)
        : adminDb.collection('tests').where('visibility', '==', 'assigned').get()
          .then(snapshot => snapshot.docs.filter(document => (
            document.data().deletedAt == null && document.data().published !== false
          ))),
      managementGroups(organisationId),
      managementUsers(organisationId),
      assignmentSubmissions(assignments.map(document => document.id)),
    ])

    return Response.json({
      organisationId: organisationId || null,
      assignments: assignments.map(assignmentJson),
      tests: tests.map(testJson),
      groups,
      users,
      submissions: submissions.map(submissionJson),
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load assignments.')
  }
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
      adminDb.collection('testAssignments').doc(assignmentInstanceId(assignmentBatchId, assignee.userId))
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
  const auth = await requireRole(request, ['user', 'organisation', 'admin'])
  if ('error' in auth) return auth.error
  try {
    const body = await request.json().catch(() => null)
    const parsed = createAssignmentSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: 'Invalid assignment details.', issues: parsed.error.issues }, { status: 400 })
    }
    const input = parsed.data
    const organisation = auth.user.role === 'admin'
      ? null
      : await contentOrganisationFor(auth.user, input.organisationId)
    if (auth.user.role !== 'admin' && !organisation) {
      return Response.json({ error: 'Select an institute where you are an accepted teacher.' }, { status: 403 })
    }
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
    if (auth.user.role !== 'admin' && test.data()?.organisationId !== organisation?.id) {
      return Response.json({ error: 'You can only assign tests from the selected institute.' }, { status: 403 })
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
      actorRole: auth.user.role === 'admin' ? 'admin' : 'organisation',
      organisationId: organisation?.id,
      targetType: input.targetType,
      targetId: input.targetId,
    })
    const testData = test.data()!
    const batchReference = adminDb.collection('assignmentBatches').doc(input.assignmentBatchId)
    const taskReference = adminDb.collection('tasks').doc(input.taskId)
    const baseAssignment = {
      testId: input.testId,
      testTitle: String(testData.title),
      ...(organisation ? { organisationId: organisation.id } : {}),
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
      ...(organisation ? { organisationId: organisation.id } : {}),
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
      organisationId: organisation?.id || auth.user.uid,
      createdBy: auth.user.uid,
      createdByName: auth.user.name,
      organisationName: organisation?.name || auth.user.name,
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
      firstWrite.set(adminDb.collection('testAssignments').doc(assignmentInstanceId(input.assignmentBatchId, assignee.userId)), {
        ...baseAssignment,
        userId: assignee.userId,
        userEmail: assignee.userEmail,
      })
    })
    await firstWrite.commit()
    for (let index = 448; index < audience.assignees.length; index += 450) {
      const write = adminDb.batch()
      audience.assignees.slice(index, index + 450).forEach(assignee => {
        write.set(adminDb.collection('testAssignments').doc(assignmentInstanceId(input.assignmentBatchId, assignee.userId)), {
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
