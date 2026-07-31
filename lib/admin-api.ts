import 'server-only'

import { and, eq } from 'drizzle-orm'
import { database } from '@/lib/db'
import {
  organizationMemberships,
  organizations,
  users,
} from '@/db/schema'
import { verifyFirebaseIdToken } from '@/lib/firebase-id-token'
import { profileDisplayName } from '@/lib/profile-display-name'

export type ServerRole = 'user' | 'organisation' | 'admin'
export type MembershipRole = 'owner' | 'teacher' | 'student'

export type ServerUser = {
  uid: string
  email: string
  name: string
  role: ServerRole
  globalRole: 'user' | 'admin'
  organizationId: string | null
  membershipRole: MembershipRole | null
}

function bootstrapAdmin(email: string) {
  const configured = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase()
  return Boolean(configured && configured === email.trim().toLowerCase())
}

async function ensureUser(input: { uid: string; email?: string; name?: string }) {
  const db = database()
  const email = input.email?.trim().toLowerCase()
  if (!email) throw new Error('Your Firebase account must have an email address.')
  const name = input.name?.trim() || email
  const [account] = await db
    .insert(users)
    .values({
      id: input.uid,
      email,
      name,
      globalRole: bootstrapAdmin(email) ? 'admin' : 'user',
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email,
        updatedAt: new Date(),
      },
    })
    .returning()
  return account
}

async function userContext(uid: string): Promise<ServerUser | null> {
  const db = database()
  const rows = await db
    .select({
      uid: users.id,
      email: users.email,
      name: users.name,
      globalRole: users.globalRole,
      organizationId: organizationMemberships.organizationId,
      membershipRole: organizationMemberships.role,
    })
    .from(users)
    .leftJoin(
      organizationMemberships,
      and(
        eq(organizationMemberships.userId, users.id),
        eq(organizationMemberships.status, 'accepted'),
      ),
    )
    .where(eq(users.id, uid))

  const account = rows[0]
  if (!account) return null
  const owner = rows.find(row => row.membershipRole === 'owner')
  const membership = owner || rows.find(row => row.organizationId)
  return {
    uid: account.uid,
    email: account.email,
    name: account.name,
    globalRole: account.globalRole,
    role: account.globalRole === 'admin'
      ? 'admin'
      : owner
        ? 'organisation'
        : 'user',
    organizationId: membership?.organizationId || null,
    membershipRole: membership?.membershipRole || null,
  }
}

export async function authenticateRequest(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) {
    return { error: Response.json({ error: 'Authentication required.' }, { status: 401 }) } as const
  }

  try {
    const decoded = await verifyFirebaseIdToken(token)
    await ensureUser(decoded)
    const actor = await userContext(decoded.uid)
    if (!actor) throw new Error('Unable to bootstrap your account.')

    const impersonatedUid = request.headers.get('x-impersonate-user')?.trim()
    if (!impersonatedUid) return { actor, user: actor } as const
    if (actor.globalRole !== 'admin') {
      return { error: Response.json({ error: 'Administrator access required for impersonation.' }, { status: 403 }) } as const
    }
    const subject = await userContext(impersonatedUid)
    if (!subject || subject.globalRole === 'admin') {
      return { error: Response.json({ error: 'The selected impersonation account is unavailable.' }, { status: 404 }) } as const
    }
    return { actor, user: subject } as const
  } catch (error) {
    console.error(error)
    return { error: Response.json({ error: 'Invalid or expired authentication token.' }, { status: 401 }) } as const
  }
}

export async function requireRole(request: Request, allowedRoles: ServerRole[]) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth
  if (!allowedRoles.includes(auth.user.role)) {
    return { error: Response.json({ error: 'You do not have permission to perform this action.' }, { status: 403 }) } as const
  }
  return auth
}

export async function requireMembership(
  request: Request,
  roles: MembershipRole[],
  organizationId?: string,
) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth
  if (auth.actor.globalRole === 'admin' && !request.headers.get('x-impersonate-user')) return auth

  const db = database()
  const memberships = await db
    .select()
    .from(organizationMemberships)
    .where(and(
      eq(organizationMemberships.userId, auth.user.uid),
      eq(organizationMemberships.status, 'accepted'),
    ))
  const membership = memberships.find(item => (
    roles.includes(item.role)
    && (!organizationId || item.organizationId === organizationId)
  ))
  if (!membership) {
    return { error: Response.json({ error: 'Accepted organization membership required.' }, { status: 403 }) } as const
  }
  return { ...auth, membership } as const
}

export async function requireAdmin(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth
  if (auth.actor.globalRole !== 'admin' || request.headers.get('x-impersonate-user')) {
    return { error: Response.json({ error: 'Administrator access required.' }, { status: 403 }) } as const
  }
  return auth
}

export async function profileDto(uid: string) {
  const context = await userContext(uid)
  if (!context) return null
  const db = database()
  const organization = context.organizationId
    ? (await db.select().from(organizations).where(eq(organizations.id, context.organizationId)).limit(1))[0]
    : null
  return {
    uid: context.uid,
    email: context.email,
    name: profileDisplayName(context.role, context.name, organization?.name),
    role: context.role,
    globalRole: context.globalRole,
    organizationId: context.organizationId,
    membershipRole: context.membershipRole,
    profilePhotoPath: organization?.profilePhotoPath || null,
    logoPath: organization?.logoPath || null,
    address: organization?.address || null,
    contactNumbers: organization?.contactNumbers || [],
    googleMapsUrl: organization?.googleMapsUrl || null,
    instagramUrl: organization?.instagramUrl || null,
    facebookUrl: organization?.facebookUrl || null,
  }
}

export function errorResponse(error: unknown, fallback = 'Unable to complete the request.') {
  console.error(error)
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 })
}
