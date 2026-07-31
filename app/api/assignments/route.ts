import { and, desc, eq, inArray } from 'drizzle-orm'
import { after } from 'next/server'
import { z } from 'zod'
import {
  assignmentBatches,
  assignmentRecipients,
  emailJobs,
  notifications,
  organizationGroupMembers,
  organizationGroups,
  organizationMemberships,
  taskActivity,
  taskAssignees,
  taskGroups,
  tasks,
  testSubmissions,
  tests,
  users,
} from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { isEmailConfigured } from '@/lib/email'
import { processEmailJob } from '@/lib/email-worker'
import { canManageOrganization } from '@/lib/services/access'
import { planTaskEmailJobs, taskEmailJobKind } from '@/lib/task-email-plan'

export const runtime = 'nodejs'
export const maxDuration = 60

function queueImmediateDelivery(jobId?: string) {
  if (!jobId || !isEmailConfigured()) return
  after(() => processEmailJob(jobId)
    .catch(error => console.error('Immediate assignment email processing failed.', error)))
}

const createSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(1).max(240),
  testId: z.string().uuid(),
  targetType: z.enum(['group', 'user']),
  targetId: z.string().min(1),
  startAt: z.string().datetime(),
  deadline: z.string().datetime(),
  maxAttempts: z.number().int().min(1).max(100),
})

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const requested = new URL(request.url).searchParams.get('organizationId')
      || new URL(request.url).searchParams.get('organisationId')
      || auth.user.organizationId
    const manager = requested ? await canManageOrganization(auth.user, requested) : auth.user.globalRole === 'admin'
    const db = database()
    let batches: (typeof assignmentBatches.$inferSelect)[]
    if (manager) {
      batches = await db.select().from(assignmentBatches)
        .where(requested ? eq(assignmentBatches.organizationId, requested) : undefined)
        .orderBy(desc(assignmentBatches.createdAt))
    } else {
      batches = await db.select({ batch: assignmentBatches }).from(assignmentRecipients)
        .innerJoin(assignmentBatches, eq(assignmentBatches.id, assignmentRecipients.assignmentBatchId))
        .where(eq(assignmentRecipients.userId, auth.user.uid))
        .orderBy(desc(assignmentBatches.createdAt))
        .then(rows => rows.map(row => row.batch))
    }
    const batchIds = batches.map(item => item.id)
    const recipients = batchIds.length ? await db.select({
      assignmentBatchId: assignmentRecipients.assignmentBatchId,
      userId: assignmentRecipients.userId,
      attemptsUsed: assignmentRecipients.attemptsUsed,
      userEmail: users.email,
      userName: users.name,
    }).from(assignmentRecipients)
      .innerJoin(users, eq(users.id, assignmentRecipients.userId))
      .where(inArray(assignmentRecipients.assignmentBatchId, batchIds)) : []
    const testIds = [...new Set(batches.map(item => item.testId))]
    const assignmentTests = testIds.length ? await db.select().from(tests).where(inArray(tests.id, testIds)) : []
    const organizationId = requested || batches[0]?.organizationId
    const allTests = manager && organizationId ? await db.select().from(tests).where(and(
      eq(tests.organizationId, organizationId),
      eq(tests.visibility, 'assigned'),
    )) : []
    const groups = manager && organizationId ? await db.select().from(organizationGroups).where(eq(organizationGroups.organizationId, organizationId)) : []
    const groupIds = groups.map(item => item.id)
    const groupMembers = groupIds.length ? await db.select({
      groupId: organizationGroupMembers.groupId,
      userId: organizationGroupMembers.userId,
      userEmail: users.email,
      userName: users.name,
    }).from(organizationGroupMembers).innerJoin(users, eq(users.id, organizationGroupMembers.userId))
      .where(inArray(organizationGroupMembers.groupId, groupIds)) : []
    const members = manager && organizationId ? await db.select({
      uid: users.id,
      email: users.email,
      name: users.name,
      membershipRole: organizationMemberships.role,
    }).from(organizationMemberships).innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.status, 'accepted'))) : []
    const submissions = manager && batchIds.length ? await db.select().from(testSubmissions).where(inArray(testSubmissions.assignmentBatchId, batchIds)) : []
    return Response.json({
      tests: allTests.map(item => ({ ...item, organisationId: item.organizationId, createdAt: item.createdAt.toISOString() })),
      groups: groups.map(group => ({ ...group, members: groupMembers.filter(member => member.groupId === group.id) })),
      users: members,
      submissions: submissions.map(item => ({ ...item, testCategory: item.categoryName, testExam: item.examName, submittedAt: item.submittedAt.toISOString() })),
      assignments: batches.map(batch => {
        const test = assignmentTests.find(item => item.id === batch.testId)
        const ownRecipients = recipients.filter(item => item.assignmentBatchId === batch.id)
        return {
          id: batch.id,
          organizationId: batch.organizationId,
          organisationId: batch.organizationId,
          name: batch.name,
          testId: batch.testId,
          testTitle: test?.title || 'Test',
          audienceName: batch.audienceName,
          assignedBy: batch.assignedBy,
          recipients: ownRecipients,
          assignedCount: ownRecipients.length,
          maxAttempts: batch.maxAttempts,
          startAt: batch.startAt.toISOString(),
          deadline: batch.deadline.toISOString(),
          createdAt: batch.createdAt.toISOString(),
        }
      }),
      nextCursor: null,
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load assignments.')
  }
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const parsed = createSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid assignment.', issues: parsed.error.issues }, { status: 400 })
    if (!(await canManageOrganization(auth.user, parsed.data.organizationId))) {
      return Response.json({ error: 'Organization manager access required.' }, { status: 403 })
    }
    const startAt = new Date(parsed.data.startAt)
    const deadline = new Date(parsed.data.deadline)
    if (deadline <= startAt) return Response.json({ error: 'Deadline must be after the start.' }, { status: 400 })
    const db = database()
    const result = await db.transaction(async tx => {
      const createdAt = new Date()
      const test = (await tx.select().from(tests).where(eq(tests.id, parsed.data.testId)).limit(1))[0]
      if (!test || test.organizationId !== parsed.data.organizationId || test.visibility !== 'assigned') {
        throw new Error('Select an assigned-mode test from this organization.')
      }
      let recipientIds: string[] = []
      let audienceName = 'Student'
      let groupId: string | null = null
      if (parsed.data.targetType === 'group') {
        const group = (await tx.select().from(organizationGroups).where(and(
          eq(organizationGroups.id, parsed.data.targetId),
          eq(organizationGroups.organizationId, parsed.data.organizationId),
        )).limit(1))[0]
        if (!group) throw new Error('Group not found.')
        groupId = group.id
        audienceName = group.name
        recipientIds = (await tx.select().from(organizationGroupMembers).where(eq(organizationGroupMembers.groupId, group.id))).map(item => item.userId)
      } else {
        const membership = (await tx.select().from(organizationMemberships).where(and(
          eq(organizationMemberships.organizationId, parsed.data.organizationId),
          eq(organizationMemberships.userId, parsed.data.targetId),
          eq(organizationMemberships.status, 'accepted'),
        )).limit(1))[0]
        if (!membership) throw new Error('Student not found.')
        recipientIds = [membership.userId]
        audienceName = (await tx.select().from(users).where(eq(users.id, membership.userId)).limit(1))[0]?.name || 'Student'
      }
      if (!recipientIds.length) throw new Error('The selected audience has no members.')
      const [batch] = await tx.insert(assignmentBatches).values({
        organizationId: parsed.data.organizationId,
        testId: test.id,
        assignedBy: auth.user.uid,
        name: parsed.data.name,
        audienceName,
        startAt,
        deadline,
        maxAttempts: parsed.data.maxAttempts,
        createdAt,
      }).returning()
      await tx.insert(assignmentRecipients).values(recipientIds.map(userId => ({ assignmentBatchId: batch.id, userId })))
      const [task] = await tx.insert(tasks).values({
        organizationId: parsed.data.organizationId,
        createdBy: auth.user.uid,
        assignmentBatchId: batch.id,
        title: parsed.data.name,
        description: `Complete ${test.title}.`,
        type: 'basic',
        startAt,
        endAt: deadline,
        createdAt,
        updatedAt: createdAt,
      }).returning()
      await tx.insert(taskAssignees).values(recipientIds.map(userId => ({ taskId: task.id, userId })))
      if (groupId) await tx.insert(taskGroups).values({ taskId: task.id, groupId })
      await tx.insert(taskActivity).values({ taskId: task.id, actorUserId: auth.user.uid, type: 'created', data: { assignmentBatchId: batch.id } })
      const plannedJobs = planTaskEmailJobs({
        taskId: task.id,
        createdAt,
        startAt,
        endAt: deadline,
      })
      const queuedJobs = await tx.insert(emailJobs).values(plannedJobs.map(job => ({
        kind: taskEmailJobKind('assignment', job.eventType),
        organizationId: parsed.data.organizationId,
        entityType: 'assignment',
        entityId: batch.id,
        payload: { recipientIds, eventType: job.eventType, taskId: task.id },
        scheduledFor: job.dueAt,
        nextAttemptAt: job.dueAt,
        dedupeKey: `assignment:${batch.id}:${job.eventType}`,
      }))).returning({ id: emailJobs.id, kind: emailJobs.kind })
      await tx.insert(notifications).values(recipientIds.map(userId => ({
        type: 'assignment_assigned',
        recipientUserId: userId,
        title: parsed.data.name,
        detail: `${test.title} is available from ${startAt.toLocaleString()} until ${deadline.toLocaleString()}.`,
        href: `/tests/${test.id}?assignment=${batch.id}`,
        tone: 'indigo',
        icon: 'assignment',
        dedupeKey: `assignment:${batch.id}:user:${userId}`,
        visibleAt: new Date(),
      })))
      return {
        id: batch.id,
        immediateEmailJobId: queuedJobs.find(job => job.kind === 'assignment_assigned')?.id,
      }
    })
    queueImmediateDelivery(result.immediateEmailJobId)
    return Response.json({ id: result.id }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'Unable to create assignment.')
  }
}
