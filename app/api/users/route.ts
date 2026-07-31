import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { organizationMemberships, organizations, users } from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { acceptedMemberships } from '@/lib/services/access'

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const db = database()
    if (auth.user.globalRole === 'admin') {
      const items = await db.select().from(users).orderBy(asc(users.name))
      const memberships = await db.select().from(organizationMemberships)
        .where(eq(organizationMemberships.status, 'accepted'))
      return Response.json({ items: items.map(item => ({
        uid: item.id,
        email: item.email,
        name: item.name,
        role: item.globalRole === 'admin'
          ? 'admin'
          : memberships.some(membership => membership.userId === item.id && membership.role === 'owner')
            ? 'organisation'
            : 'user',
        organizationId: memberships.find(membership => membership.userId === item.id)?.organizationId || null,
        membershipRole: memberships.find(membership => membership.userId === item.id)?.role || null,
        createdAt: item.createdAt.toISOString(),
      })), nextCursor: null })
    }
    const memberships = await acceptedMemberships(auth.user.uid)
    const manageable = memberships.filter(item => item.role === 'owner' || item.role === 'teacher')
    if (!manageable.length) {
      return Response.json({ items: [{
        uid: auth.user.uid,
        email: auth.user.email,
        name: auth.user.name,
        role: auth.user.role,
      }], nextCursor: null })
    }
    if (new URL(request.url).searchParams.get('directory') === '1') {
      const items = await db.select().from(users).where(eq(users.globalRole, 'user')).orderBy(asc(users.name))
      return Response.json({
        items: items.map(item => ({ uid: item.id, email: item.email, name: item.name, role: 'user' as const })),
        nextCursor: null,
      })
    }
    const rows = await db
      .select({
        uid: users.id,
        email: users.email,
        name: users.name,
        membershipRole: organizationMemberships.role,
        membershipStatus: organizationMemberships.status,
        organizationId: organizationMemberships.organizationId,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(and(
        inArray(organizationMemberships.organizationId, manageable.map(item => item.organizationId)),
        eq(organizationMemberships.status, 'accepted'),
      ))
      .orderBy(asc(users.name))
    return Response.json({ items: rows, nextCursor: null })
  } catch (error) {
    return errorResponse(error, 'Unable to load users.')
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  if (auth.user.globalRole !== 'admin') return Response.json({ error: 'Administrator access required.' }, { status: 403 })
  try {
    const body = z.object({
      userId: z.string().min(1),
      role: z.enum(['user', 'organisation']),
    }).parse(await request.json())
    const db = database()
    const account = (await db.select().from(users).where(eq(users.id, body.userId)).limit(1))[0]
    if (!account || account.globalRole === 'admin') return Response.json({ error: 'Account not found.' }, { status: 404 })
    await db.transaction(async tx => {
      let organization = (await tx.select().from(organizations).where(eq(organizations.ownerUserId, account.id)).limit(1))[0]
      if (body.role === 'organisation') {
        if (!organization) {
          [organization] = await tx.insert(organizations).values({
            ownerUserId: account.id,
            name: account.name || account.email,
          }).returning()
        }
        await tx.insert(organizationMemberships).values({
          organizationId: organization.id,
          userId: account.id,
          role: 'owner',
          status: 'accepted',
          initiatedBy: account.id,
          respondedAt: new Date(),
        }).onConflictDoUpdate({
          target: [organizationMemberships.organizationId, organizationMemberships.userId],
          set: { role: 'owner', status: 'accepted', respondedAt: new Date(), updatedAt: new Date() },
        })
      } else if (organization) {
        await tx.update(organizationMemberships).set({
          role: 'student',
          updatedAt: new Date(),
        }).where(and(
          eq(organizationMemberships.organizationId, organization.id),
          eq(organizationMemberships.userId, account.id),
        ))
      }
    })
    return Response.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'Unable to update this account role.')
  }
}
