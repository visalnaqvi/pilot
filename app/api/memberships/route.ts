import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { notifications, organizationMemberships, organizations, users } from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { canManageOrganization } from '@/lib/services/access'
import { clientOrganizationNameForHostname } from '@/lib/branding'

const createSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().email().optional(),
  role: z.enum(['teacher', 'student']).default('student'),
})
const updateSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().min(1),
  status: z.enum(['pending', 'accepted', 'declined']).optional(),
  role: z.enum(['teacher', 'student']).optional(),
})

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const db = database()
    const requestedOrganization = new URL(request.url).searchParams.get('organizationId')
    const managed = requestedOrganization && await canManageOrganization(auth.user, requestedOrganization)
    const clientOrganizationName = clientOrganizationNameForHostname(
      request.headers.get('host') || new URL(request.url).hostname,
    )
    const clientOrganization = clientOrganizationName
      ? (await db.select({ id: organizations.id }).from(organizations).where(
          eq(sql`lower(${organizations.name})`, clientOrganizationName.toLowerCase()),
        ).limit(1))[0]
      : undefined
    const rows = await db
      .select({
        organizationId: organizationMemberships.organizationId,
        organizationName: organizations.name,
        userId: organizationMemberships.userId,
        email: users.email,
        name: users.name,
        role: organizationMemberships.role,
        status: organizationMemberships.status,
        initiatedBy: organizationMemberships.initiatedBy,
        createdAt: organizationMemberships.createdAt,
      })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(managed && requestedOrganization
        ? eq(organizationMemberships.organizationId, requestedOrganization)
        : clientOrganizationName
          ? clientOrganization
            ? and(
                eq(organizationMemberships.userId, auth.user.uid),
                eq(organizationMemberships.organizationId, clientOrganization.id),
              )
            : sql`false`
          : eq(organizationMemberships.userId, auth.user.uid))
    return Response.json({
      items: rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() })),
      nextCursor: null,
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load memberships.')
  }
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const parsed = createSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid membership request.', issues: parsed.error.issues }, { status: 400 })
    const organization = (await database().select().from(organizations).where(eq(organizations.id, parsed.data.organizationId)).limit(1))[0]
    if (!organization) return Response.json({ error: 'Organization not found.' }, { status: 404 })
    const clientOrganizationName = clientOrganizationNameForHostname(
      request.headers.get('host') || new URL(request.url).hostname,
    )
    if (clientOrganizationName && organization.name.trim().toLowerCase() !== clientOrganizationName.toLowerCase()) {
      return Response.json({ error: `This deployment only accepts requests for ${clientOrganizationName}.` }, { status: 403 })
    }
    const manager = await canManageOrganization(auth.user, parsed.data.organizationId)
    let targetUserId = auth.user.uid
    const status: 'pending' | 'accepted' = 'pending'
    if (parsed.data.email) {
      if (!manager) return Response.json({ error: 'Organization manager access required.' }, { status: 403 })
      const target = (await database().select().from(users).where(eq(users.email, parsed.data.email.toLowerCase())).limit(1))[0]
      if (!target) return Response.json({ error: 'That user must create an account before being invited.' }, { status: 404 })
      targetUserId = target.id
    }
    const [item] = await database().insert(organizationMemberships).values({
      organizationId: parsed.data.organizationId,
      userId: targetUserId,
      role: parsed.data.role,
      status,
      initiatedBy: auth.user.uid,
    }).onConflictDoUpdate({
      target: [organizationMemberships.organizationId, organizationMemberships.userId],
      set: { role: parsed.data.role, status, initiatedBy: auth.user.uid, updatedAt: new Date() },
    }).returning()
    await database().insert(notifications).values({
      type: parsed.data.email ? 'organization_invitation' : 'membership_request',
      recipientUserId: parsed.data.email ? targetUserId : null,
      recipientOrganizationId: parsed.data.email ? null : parsed.data.organizationId,
      title: parsed.data.email ? `Invitation from ${organization?.name || 'an organization'}` : 'New membership request',
      detail: parsed.data.email ? `You were invited as a ${parsed.data.role}.` : `${auth.user.name} asked to join as a ${parsed.data.role}.`,
      href: parsed.data.email ? '/invitations' : '/organisation/users',
      tone: 'violet',
      icon: 'users',
      dedupeKey: `membership:${parsed.data.organizationId}:${targetUserId}:created`,
      visibleAt: new Date(),
    }).onConflictDoNothing()
    return Response.json({ item }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'Unable to create membership request.')
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const parsed = updateSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid membership update.', issues: parsed.error.issues }, { status: 400 })
    const ownDecision = parsed.data.userId === auth.user.uid && Boolean(parsed.data.status)
    const clientOrganizationName = clientOrganizationNameForHostname(
      request.headers.get('host') || new URL(request.url).hostname,
    )
    if (ownDecision && clientOrganizationName) {
      const organization = (await database().select({ name: organizations.name }).from(organizations).where(eq(organizations.id, parsed.data.organizationId)).limit(1))[0]
      if (!organization || organization.name.trim().toLowerCase() !== clientOrganizationName.toLowerCase()) {
        return Response.json({ error: `This deployment only allows membership in ${clientOrganizationName}.` }, { status: 403 })
      }
    }
    if (!ownDecision && !(await canManageOrganization(auth.user, parsed.data.organizationId))) {
      return Response.json({ error: 'You cannot update this membership.' }, { status: 403 })
    }
    const changes = {
      ...(parsed.data.status ? {
        status: parsed.data.status,
        respondedAt: parsed.data.status === 'pending' ? null : new Date(),
      } : {}),
      ...(parsed.data.role ? { role: parsed.data.role } : {}),
      updatedAt: new Date(),
    }
    const [item] = await database().update(organizationMemberships).set(changes).where(and(
      eq(organizationMemberships.organizationId, parsed.data.organizationId),
      eq(organizationMemberships.userId, parsed.data.userId),
    )).returning()
    if (!item) return Response.json({ error: 'Membership not found.' }, { status: 404 })
    return Response.json({ item })
  } catch (error) {
    return errorResponse(error, 'Unable to update membership.')
  }
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const url = new URL(request.url)
    const organizationId = url.searchParams.get('organizationId')
    const userId = url.searchParams.get('userId')
    if (!organizationId || !userId) return Response.json({ error: 'Organization and user are required.' }, { status: 400 })
    const ownMembership = userId === auth.user.uid
    if (!ownMembership && !(await canManageOrganization(auth.user, organizationId))) {
      return Response.json({ error: 'You cannot remove this membership.' }, { status: 403 })
    }
    await database().delete(organizationMemberships).where(and(
      eq(organizationMemberships.organizationId, organizationId),
      eq(organizationMemberships.userId, userId),
    ))
    return new Response(null, { status: 204 })
  } catch (error) {
    return errorResponse(error, 'Unable to remove membership.')
  }
}
