import 'server-only'

import { and, eq } from 'drizzle-orm'
import { organizationMemberships } from '@/db/schema'
import { database } from '@/lib/db'
import type { ServerUser } from '@/lib/admin-api'

export async function acceptedMemberships(userId: string) {
  return database()
    .select()
    .from(organizationMemberships)
    .where(and(
      eq(organizationMemberships.userId, userId),
      eq(organizationMemberships.status, 'accepted'),
    ))
}

export async function canManageOrganization(user: ServerUser, organizationId: string) {
  if (user.globalRole === 'admin') return true
  const membership = (await acceptedMemberships(user.uid)).find(item => item.organizationId === organizationId)
  return membership?.role === 'owner' || membership?.role === 'teacher'
}

export async function canAdministerOrganization(user: ServerUser, organizationId: string) {
  if (user.globalRole === 'admin') return true
  const membership = (await acceptedMemberships(user.uid)).find(item => item.organizationId === organizationId)
  return membership?.role === 'owner'
}

export async function canViewOrganization(user: ServerUser, organizationId: string) {
  if (user.globalRole === 'admin') return true
  return (await acceptedMemberships(user.uid)).some(item => item.organizationId === organizationId)
}

export async function organizationScope(user: ServerUser) {
  if (user.globalRole === 'admin') return null
  return (await acceptedMemberships(user.uid)).map(item => item.organizationId)
}
