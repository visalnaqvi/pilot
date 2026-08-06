import { eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { organizationMemberships, organizations } from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { adminStorage } from '@/lib/firebase-admin'
import { acceptedMemberships, canManageOrganization } from '@/lib/services/access'
import { clientOrganizationNameForHostname } from '@/lib/branding'

const createSchema = z.object({
  name: z.string().trim().min(2).max(160),
})
const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(160).optional(),
  address: z.string().trim().max(500).nullable().optional(),
  contactNumbers: z.array(z.string().trim().min(3).max(40)).max(8).optional(),
  notificationEmails: z.array(z.string().trim().toLowerCase().email().max(320)).max(20)
    .transform(emails => [...new Set(emails)]).optional(),
  googleMapsUrl: z.string().url().nullable().optional(),
  instagramUrl: z.string().url().nullable().optional(),
  facebookUrl: z.string().url().nullable().optional(),
  logoPath: z.string().max(500).nullable().optional(),
  profilePhotoPath: z.string().max(500).nullable().optional(),
})

function serialize(item: typeof organizations.$inferSelect, includeNotificationEmails = false) {
  const { notificationEmails, ...publicItem } = item
  return {
    ...publicItem,
    ...(includeNotificationEmails ? { notificationEmails } : {}),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}

async function profileImageUrl(path: string | null) {
  if (!path) return ''
  const [url] = await adminStorage.bucket().file(path).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 60 * 60_000,
    responseDisposition: 'inline',
  })
  return url
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const requestedId = new URL(request.url).searchParams.get('id')
    const directory = new URL(request.url).searchParams.get('directory') === '1'
    const db = database()
    if (requestedId) {
      const item = (await db.select().from(organizations).where(eq(organizations.id, requestedId)).limit(1))[0]
      if (!item) return Response.json({ error: 'Organization not found.' }, { status: 404 })
      const manager = await canManageOrganization(auth.user, item.id)
      return Response.json({
        item: {
          ...serialize(item, manager),
          profilePhotoUrl: await profileImageUrl(item.profilePhotoPath),
          logoUrl: await profileImageUrl(item.logoPath),
        },
      })
    }
    if (auth.user.globalRole === 'admin') {
      const items = await db.select().from(organizations)
      return Response.json({ items: items.map(item => serialize(item, true)), nextCursor: null })
    }
    if (directory) {
      const clientOrganizationName = clientOrganizationNameForHostname(
        request.headers.get('host') || new URL(request.url).hostname,
      )
      const items = await db.select().from(organizations).where(
        clientOrganizationName
          ? eq(sql`lower(${organizations.name})`, clientOrganizationName.toLowerCase())
          : undefined,
      )
      return Response.json({
        items: await Promise.all(items.map(async item => ({
          id: item.id,
          name: item.name,
          address: item.address,
          logoUrl: await profileImageUrl(item.logoPath),
        }))),
        nextCursor: null,
      })
    }
    const memberships = await acceptedMemberships(auth.user.uid)
    const ids = memberships.map(item => item.organizationId)
    const items = ids.length ? await db.select().from(organizations).where(inArray(organizations.id, ids)) : []
    return Response.json({ items: items.map(item => serialize(item)), memberships, nextCursor: null })
  } catch (error) {
    return errorResponse(error, 'Unable to load organizations.')
  }
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const parsed = createSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid organization.', issues: parsed.error.issues }, { status: 400 })
    const item = await database().transaction(async tx => {
      const [created] = await tx.insert(organizations).values({
        ownerUserId: auth.user.uid,
        name: parsed.data.name,
      }).returning()
      await tx.insert(organizationMemberships).values({
        organizationId: created.id,
        userId: auth.user.uid,
        role: 'owner',
        status: 'accepted',
        initiatedBy: auth.user.uid,
        respondedAt: new Date(),
      })
      return created
    })
    return Response.json({ item: serialize(item) }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'Unable to create organization.')
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const parsed = updateSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid organization profile.', issues: parsed.error.issues }, { status: 400 })
    if (!(await canManageOrganization(auth.user, parsed.data.id))) {
      return Response.json({ error: 'Organization manager access required.' }, { status: 403 })
    }
    const { id, ...changes } = parsed.data
    const [item] = await database().update(organizations).set({ ...changes, updatedAt: new Date() }).where(eq(organizations.id, id)).returning()
    if (!item) return Response.json({ error: 'Organization not found.' }, { status: 404 })
    return Response.json({ item: serialize(item, true) })
  } catch (error) {
    return errorResponse(error, 'Unable to update organization.')
  }
}
