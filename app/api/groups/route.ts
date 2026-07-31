import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { exams, organizationGroupMembers, organizationGroups, users } from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { acceptedMemberships, canManageOrganization } from '@/lib/services/access'

const groupSchema = z.object({
  id: z.string().uuid().optional(),
  organizationId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  targetExamId: z.string().uuid().nullable().optional(),
  memberIds: z.array(z.string().min(1)).max(500).default([]),
})

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const requested = new URL(request.url).searchParams.get('organizationId')
    let ids: string[]
    if (requested) {
      const memberships = await acceptedMemberships(auth.user.uid)
      if (auth.user.globalRole !== 'admin' && !memberships.some(item => item.organizationId === requested)) {
        return Response.json({ error: 'Organization access required.' }, { status: 403 })
      }
      ids = [requested]
    } else if (auth.user.globalRole === 'admin') {
      ids = []
    } else {
      ids = (await acceptedMemberships(auth.user.uid)).map(item => item.organizationId)
    }
    if (auth.user.globalRole !== 'admin' && !ids.length) {
      return Response.json({ items: [], nextCursor: null })
    }
    const db = database()
    const groups = await db.select({
      id: organizationGroups.id,
      organizationId: organizationGroups.organizationId,
      name: organizationGroups.name,
      targetExamId: organizationGroups.targetExamId,
      targetExamName: exams.name,
      createdAt: organizationGroups.createdAt,
    }).from(organizationGroups)
      .leftJoin(exams, eq(exams.id, organizationGroups.targetExamId))
      .where(ids.length ? inArray(organizationGroups.organizationId, ids) : undefined)
    const groupIds = groups.map(group => group.id)
    const members = groupIds.length ? await db.select({
      groupId: organizationGroupMembers.groupId,
      userId: users.id,
      userEmail: users.email,
      userName: users.name,
    }).from(organizationGroupMembers)
      .innerJoin(users, eq(users.id, organizationGroupMembers.userId))
      .where(inArray(organizationGroupMembers.groupId, groupIds)) : []
    return Response.json({
      items: groups.map(group => ({
        ...group,
        createdAt: group.createdAt.toISOString(),
        members: members.filter(member => member.groupId === group.id),
      })),
      nextCursor: null,
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load groups.')
  }
}

async function save(request: Request, update: boolean) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const parsed = groupSchema.safeParse(await request.json())
    if (!parsed.success || (update && !parsed.data.id)) {
      return Response.json({ error: 'Invalid group.', issues: parsed.success ? [] : parsed.error.issues }, { status: 400 })
    }
    if (!(await canManageOrganization(auth.user, parsed.data.organizationId))) {
      return Response.json({ error: 'Organization manager access required.' }, { status: 403 })
    }
    const item = await database().transaction(async tx => {
      const values = {
        organizationId: parsed.data.organizationId,
        name: parsed.data.name,
        targetExamId: parsed.data.targetExamId || null,
        createdBy: auth.user.uid,
        updatedAt: new Date(),
      }
      const [group] = update
        ? await tx.update(organizationGroups).set(values).where(and(
            eq(organizationGroups.id, parsed.data.id!),
            eq(organizationGroups.organizationId, parsed.data.organizationId),
          )).returning()
        : await tx.insert(organizationGroups).values(values).returning()
      if (!group) throw new Error('Group not found.')
      await tx.delete(organizationGroupMembers).where(eq(organizationGroupMembers.groupId, group.id))
      if (parsed.data.memberIds.length) {
        await tx.insert(organizationGroupMembers).values(parsed.data.memberIds.map(userId => ({
          groupId: group.id,
          userId,
          addedBy: auth.user.uid,
        })))
      }
      return group
    })
    return Response.json({ item }, { status: update ? 200 : 201 })
  } catch (error) {
    return errorResponse(error, 'Unable to save group.')
  }
}

export const POST = (request: Request) => save(request, false)
export const PATCH = (request: Request) => save(request, true)

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return Response.json({ error: 'Group ID required.' }, { status: 400 })
    const group = (await database().select().from(organizationGroups).where(eq(organizationGroups.id, id)).limit(1))[0]
    if (!group) return Response.json({ error: 'Group not found.' }, { status: 404 })
    if (!(await canManageOrganization(auth.user, group.organizationId))) {
      return Response.json({ error: 'Organization manager access required.' }, { status: 403 })
    }
    await database().delete(organizationGroups).where(eq(organizationGroups.id, id))
    return new Response(null, { status: 204 })
  } catch (error) {
    return errorResponse(error, 'Unable to delete group.')
  }
}
