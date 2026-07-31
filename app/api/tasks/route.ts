import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import {
  assignmentBatches,
  emailJobs,
  files,
  notifications,
  organizationGroupMembers,
  organizationGroups,
  taskActivity,
  taskAssignees,
  taskAttachments,
  taskComments,
  taskGroups,
  taskSubmissions,
  taskSubmissionFiles,
  tasks,
  users,
} from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { canManageOrganization } from '@/lib/services/access'

const createSchema = z.object({
  organizationId: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(20_000).default(''),
  type: z.enum(['basic', 'submission']).default('basic'),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  groupIds: z.array(z.string().uuid()).max(100).default([]),
  userIds: z.array(z.string().min(1)).max(1_000).default([]),
  fileIds: z.array(z.string().uuid()).max(10).default([]),
})
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), taskId: z.string().uuid(), status: z.enum(['todo', 'in_progress', 'done', 'closed']), userId: z.string().min(1).optional() }),
  z.object({
    action: z.literal('bulk_status'),
    taskId: z.string().uuid(),
    changes: z.array(z.object({
      userId: z.string().min(1),
      status: z.enum(['todo', 'in_progress', 'done', 'closed']),
    })).min(1).max(1_000),
  }),
  z.object({ action: z.literal('comment'), taskId: z.string().uuid(), body: z.string().trim().min(1).max(10_000) }),
  z.object({ action: z.literal('close'), taskId: z.string().uuid(), closed: z.boolean() }),
  z.object({ action: z.literal('submit'), taskId: z.string().uuid(), note: z.string().trim().max(10_000).default(''), fileId: z.string().uuid().optional() }),
])

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const db = database()
    const organizationId = new URL(request.url).searchParams.get('organizationId') || auth.user.organizationId
    const manager = organizationId ? await canManageOrganization(auth.user, organizationId) : auth.user.globalRole === 'admin'
    const rows = manager
      ? await db.select().from(tasks).where(organizationId ? eq(tasks.organizationId, organizationId) : undefined).orderBy(desc(tasks.updatedAt))
      : await db.select({ task: tasks }).from(taskAssignees)
          .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
          .where(eq(taskAssignees.userId, auth.user.uid))
          .orderBy(desc(tasks.updatedAt))
          .then(result => result.map(item => item.task))
    const ids = rows.map(item => item.id)
    const assignmentBatchIds = [...new Set(rows.flatMap(item => item.assignmentBatchId ? [item.assignmentBatchId] : []))]
    const linkedAssignments = assignmentBatchIds.length
      ? await db.select({
          id: assignmentBatches.id,
          testId: assignmentBatches.testId,
        }).from(assignmentBatches).where(inArray(assignmentBatches.id, assignmentBatchIds))
      : []
    const linkedTestIds = new Map(linkedAssignments.map(assignment => [assignment.id, assignment.testId]))
    const assignees = ids.length ? await db.select({
      taskId: taskAssignees.taskId,
      userId: taskAssignees.userId,
      status: taskAssignees.status,
      userName: users.name,
      userEmail: users.email,
    }).from(taskAssignees).innerJoin(users, eq(users.id, taskAssignees.userId))
      .where(inArray(taskAssignees.taskId, ids)) : []
    const groups = ids.length ? await db.select({
      taskId: taskGroups.taskId,
      groupId: organizationGroups.id,
      groupName: organizationGroups.name,
    }).from(taskGroups).innerJoin(organizationGroups, eq(organizationGroups.id, taskGroups.groupId))
      .where(inArray(taskGroups.taskId, ids)) : []
    const comments = ids.length ? await db.select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      authorUserId: taskComments.authorUserId,
      authorName: users.name,
      body: taskComments.body,
      createdAt: taskComments.createdAt,
    }).from(taskComments).innerJoin(users, eq(users.id, taskComments.authorUserId))
      .where(inArray(taskComments.taskId, ids)).orderBy(taskComments.createdAt) : []
    const submissions = ids.length ? await db.select().from(taskSubmissions).where(inArray(taskSubmissions.taskId, ids)) : []
    const attachmentRows = ids.length ? await db.select({
      taskId: taskAttachments.taskId,
      id: files.id,
      name: files.name,
      path: files.path,
      size: files.size,
      contentType: files.contentType,
    }).from(taskAttachments).innerJoin(files, eq(files.id, taskAttachments.fileId))
      .where(inArray(taskAttachments.taskId, ids)) : []
    const submissionIds = submissions.map(item => item.id)
    const submissionFileRows = submissionIds.length ? await db.select({
      taskSubmissionId: taskSubmissionFiles.taskSubmissionId,
      id: files.id,
      name: files.name,
      path: files.path,
      size: files.size,
      contentType: files.contentType,
    }).from(taskSubmissionFiles).innerJoin(files, eq(files.id, taskSubmissionFiles.fileId))
      .where(inArray(taskSubmissionFiles.taskSubmissionId, submissionIds)) : []
    return Response.json({
      items: rows.map(item => ({
        ...item,
        organisationId: item.organizationId,
        taskType: item.type,
        sourceType: item.assignmentBatchId ? 'assignment' : undefined,
        linkedAssignmentBatchId: item.assignmentBatchId,
        linkedTestId: item.assignmentBatchId ? linkedTestIds.get(item.assignmentBatchId) : undefined,
        status: 'todo',
        assignedUsers: assignees.filter(value => value.taskId === item.id),
        assigneeIds: assignees.filter(value => value.taskId === item.id).map(value => value.userId),
        assignedGroupIds: groups.filter(value => value.taskId === item.id).map(value => value.groupId),
        audienceNames: groups.filter(value => value.taskId === item.id).map(value => value.groupName),
        groups: groups.filter(value => value.taskId === item.id),
        attachments: attachmentRows.filter(value => value.taskId === item.id),
        comments: comments.filter(value => value.taskId === item.id).map(value => ({
          id: value.id,
          body: value.body,
          authorId: value.authorUserId,
          authorName: value.authorName,
          authorRole: value.authorUserId === item.createdBy ? 'organisation' : 'user',
          createdAt: value.createdAt.toISOString(),
        })),
        submissions: submissions.filter(value => value.taskId === item.id).map(value => ({
          ...value,
          userName: assignees.find(assignee => assignee.taskId === item.id && assignee.userId === value.userId)?.userName || '',
          userEmail: assignees.find(assignee => assignee.taskId === item.id && assignee.userId === value.userId)?.userEmail || '',
          attachment: submissionFileRows.find(file => file.taskSubmissionId === value.id),
          submittedAt: value.submittedAt.toISOString(),
        })),
        startAt: item.startAt?.toISOString() || null,
        endAt: item.endAt?.toISOString() || null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        closedAt: item.closedAt?.toISOString() || null,
      })),
      nextCursor: null,
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load tasks.')
  }
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const parsed = createSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid task.', issues: parsed.error.issues }, { status: 400 })
    if (!(await canManageOrganization(auth.user, parsed.data.organizationId))) {
      return Response.json({ error: 'Organization manager access required.' }, { status: 403 })
    }
    const id = await database().transaction(async tx => {
      const groupMembers = parsed.data.groupIds.length
        ? await tx.select().from(organizationGroupMembers).where(inArray(organizationGroupMembers.groupId, parsed.data.groupIds))
        : []
      const recipientIds = [...new Set([...parsed.data.userIds, ...groupMembers.map(item => item.userId)])]
      if (!recipientIds.length) throw new Error('Select at least one assignee.')
      const [task] = await tx.insert(tasks).values({
        organizationId: parsed.data.organizationId,
        createdBy: auth.user.uid,
        title: parsed.data.title,
        description: parsed.data.description,
        type: parsed.data.type,
        startAt: parsed.data.startAt ? new Date(parsed.data.startAt) : null,
        endAt: parsed.data.endAt ? new Date(parsed.data.endAt) : null,
      }).returning()
      await tx.insert(taskAssignees).values(recipientIds.map(userId => ({ taskId: task.id, userId })))
      if (parsed.data.groupIds.length) await tx.insert(taskGroups).values(parsed.data.groupIds.map(groupId => ({ taskId: task.id, groupId })))
      if (parsed.data.fileIds.length) {
        const ownedFiles = await tx.select().from(files).where(inArray(files.id, parsed.data.fileIds))
        if (ownedFiles.length !== parsed.data.fileIds.length || ownedFiles.some(file => file.ownerUserId !== auth.user.uid || file.organizationId !== parsed.data.organizationId || file.deletedAt)) {
          throw new Error('One or more task attachments are invalid.')
        }
        await tx.insert(taskAttachments).values(parsed.data.fileIds.map((fileId, position) => ({ taskId: task.id, fileId, position })))
        await tx.update(files).set({ status: 'attached', attachedAt: new Date() }).where(inArray(files.id, parsed.data.fileIds))
      }
      await tx.insert(taskActivity).values({ taskId: task.id, actorUserId: auth.user.uid, type: 'created', data: { recipientCount: recipientIds.length } })
      await tx.insert(emailJobs).values({
        kind: 'task_assigned',
        organizationId: parsed.data.organizationId,
        entityType: 'task',
        entityId: task.id,
        payload: { recipientIds },
        scheduledFor: new Date(),
        dedupeKey: `task:${task.id}:assigned`,
      })
      await tx.insert(notifications).values(recipientIds.map(userId => ({
        type: 'task_assigned',
        recipientUserId: userId,
        title: task.title,
        detail: task.description || 'A task was assigned to you.',
        href: '/tasks',
        tone: 'indigo',
        icon: 'task',
        dedupeKey: `task:${task.id}:user:${userId}`,
        visibleAt: new Date(),
      })))
      return task.id
    })
    return Response.json({ id }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'Unable to create task.')
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const parsed = actionSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid task action.', issues: parsed.error.issues }, { status: 400 })
    const db = database()
    const task = (await db.select().from(tasks).where(eq(tasks.id, parsed.data.taskId)).limit(1))[0]
    if (!task) return Response.json({ error: 'Task not found.' }, { status: 404 })
    const manager = await canManageOrganization(auth.user, task.organizationId)
    const assignee = Boolean((await db.select().from(taskAssignees).where(and(
      eq(taskAssignees.taskId, task.id),
      eq(taskAssignees.userId, auth.user.uid),
    )).limit(1)).length)
    if (!manager && !assignee) return Response.json({ error: 'Task access required.' }, { status: 403 })
    await db.transaction(async tx => {
      if (parsed.data.action === 'status') {
        if (!manager && parsed.data.status === 'closed') throw new Error('Only an organization manager can close task work.')
        if (!manager && task.isClosed) throw new Error('This task is closed.')
        if (!manager && task.type === 'submission' && parsed.data.status === 'done') {
          const submission = await tx.select({ id: taskSubmissions.id }).from(taskSubmissions)
            .innerJoin(taskSubmissionFiles, eq(taskSubmissionFiles.taskSubmissionId, taskSubmissions.id))
            .where(and(
              eq(taskSubmissions.taskId, task.id),
              eq(taskSubmissions.userId, auth.user.uid),
            )).limit(1)
          if (!submission.length) throw new Error('A submission file is required before this task can move to Done.')
        }
        const subjectUserId = manager ? parsed.data.userId : auth.user.uid
        if (!subjectUserId) throw new Error('Select an assignee.')
        await tx.update(taskAssignees).set({ status: parsed.data.status, updatedBy: auth.user.uid, updatedAt: new Date() }).where(and(
          eq(taskAssignees.taskId, task.id),
          eq(taskAssignees.userId, subjectUserId),
        ))
        await tx.insert(taskActivity).values({ taskId: task.id, actorUserId: auth.user.uid, subjectUserId, type: 'status_changed', data: { status: parsed.data.status } })
      } else if (parsed.data.action === 'bulk_status') {
        if (!manager) throw new Error('Organization manager access required.')
        if (task.isClosed) throw new Error('This task is closed.')
        const subjectUserIds = parsed.data.changes.map(change => change.userId)
        if (new Set(subjectUserIds).size !== subjectUserIds.length) throw new Error('Each assignee can only be updated once.')
        const assignedUsers = await tx.select({ userId: taskAssignees.userId }).from(taskAssignees).where(and(
          eq(taskAssignees.taskId, task.id),
          inArray(taskAssignees.userId, subjectUserIds),
        ))
        if (assignedUsers.length !== subjectUserIds.length) throw new Error('One or more selected users are not assigned to this task.')
        const changedAt = new Date()
        for (const change of parsed.data.changes) {
          await tx.update(taskAssignees).set({ status: change.status, updatedBy: auth.user.uid, updatedAt: changedAt }).where(and(
            eq(taskAssignees.taskId, task.id),
            eq(taskAssignees.userId, change.userId),
          ))
        }
        await tx.insert(taskActivity).values(parsed.data.changes.map(change => ({
          taskId: task.id,
          actorUserId: auth.user.uid,
          subjectUserId: change.userId,
          type: 'status_changed',
          data: { status: change.status },
        })))
      } else if (parsed.data.action === 'comment') {
        await tx.insert(taskComments).values({ taskId: task.id, authorUserId: auth.user.uid, body: parsed.data.body })
      } else if (parsed.data.action === 'close') {
        if (!manager) throw new Error('Organization manager access required.')
        await tx.update(tasks).set({ isClosed: parsed.data.closed, closedAt: parsed.data.closed ? new Date() : null, closedBy: parsed.data.closed ? auth.user.uid : null, updatedAt: new Date() }).where(eq(tasks.id, task.id))
        await tx.insert(taskActivity).values({ taskId: task.id, actorUserId: auth.user.uid, type: parsed.data.closed ? 'closed' : 'reopened' })
      } else {
        if (!assignee) throw new Error('Task assignment required.')
        if (task.type === 'submission' && !parsed.data.fileId) throw new Error('A submission file is required.')
        const [submission] = await tx.insert(taskSubmissions).values({ taskId: task.id, userId: auth.user.uid, note: parsed.data.note }).onConflictDoUpdate({
          target: [taskSubmissions.taskId, taskSubmissions.userId],
          set: { note: parsed.data.note, submittedAt: new Date() },
        }).returning()
        if (parsed.data.fileId) {
          const file = (await tx.select().from(files).where(eq(files.id, parsed.data.fileId)).limit(1))[0]
          if (!file || file.ownerUserId !== auth.user.uid || file.organizationId !== task.organizationId || file.deletedAt) throw new Error('Submission file is invalid.')
          await tx.delete(taskSubmissionFiles).where(eq(taskSubmissionFiles.taskSubmissionId, submission.id))
          await tx.insert(taskSubmissionFiles).values({ taskSubmissionId: submission.id, fileId: file.id, position: 0 })
          await tx.update(files).set({ status: 'attached', attachedAt: new Date() }).where(eq(files.id, file.id))
        }
        await tx.update(taskAssignees).set({ status: 'done', updatedBy: auth.user.uid, updatedAt: new Date() }).where(and(eq(taskAssignees.taskId, task.id), eq(taskAssignees.userId, auth.user.uid)))
        await tx.insert(taskActivity).values({ taskId: task.id, actorUserId: auth.user.uid, subjectUserId: auth.user.uid, type: 'submitted' })
      }
      await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id))
    })
    return Response.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'Unable to update task.')
  }
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return Response.json({ error: 'Task ID required.' }, { status: 400 })
    const task = (await database().select().from(tasks).where(eq(tasks.id, id)).limit(1))[0]
    if (!task) return Response.json({ error: 'Task not found.' }, { status: 404 })
    if (!(await canManageOrganization(auth.user, task.organizationId)) || (auth.user.membershipRole === 'teacher' && task.createdBy !== auth.user.uid)) {
      return Response.json({ error: 'You cannot delete this task.' }, { status: 403 })
    }
    await database().delete(tasks).where(eq(tasks.id, id))
    return new Response(null, { status: 204 })
  } catch (error) {
    return errorResponse(error, 'Unable to delete task.')
  }
}
