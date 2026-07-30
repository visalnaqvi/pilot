import 'server-only'

import { adminDb } from './firebase-admin'
import { memberRole, type MemberRole } from './membership'
import type { ServerRole } from './admin-api'

export type AttendanceActor = {
  uid: string
  name: string
  role: ServerRole
}

export async function membershipFor(organisationId: string, userId: string) {
  const snapshot = await adminDb.collection('organisationInvites').doc(`${organisationId}_${userId}`).get()
  if (!snapshot.exists || snapshot.data()?.status !== 'accepted') return null
  return {
    organisationId,
    userId,
    memberRole: memberRole(snapshot.data()?.memberRole),
    organisationName: String(snapshot.data()?.organisationName || snapshot.data()?.organisationEmail || organisationId),
  }
}

export async function membershipsForUser(userId: string, expectedRole?: MemberRole) {
  const snapshot = await adminDb.collection('organisationInvites')
    .where('userId', '==', userId)
    .where('status', '==', 'accepted')
    .get()
  return snapshot.docs
    .map(document => ({
      organisationId: String(document.data().organisationId),
      organisationName: String(document.data().organisationName || document.data().organisationEmail || document.data().organisationId),
      memberRole: memberRole(document.data().memberRole),
    }))
    .filter(item => !expectedRole || item.memberRole === expectedRole)
}

export async function assertAcceptedTeachers(
  organisationId: string,
  teacherUserIds: string[],
) {
  const ids = [...new Set(teacherUserIds.filter(Boolean))]
  if (!ids.length) return
  const snapshots = await adminDb.getAll(...ids.map(userId => (
    adminDb.collection('organisationInvites').doc(`${organisationId}_${userId}`)
  )))
  if (snapshots.some(snapshot => !snapshot.exists
    || snapshot.data()?.status !== 'accepted'
    || memberRole(snapshot.data()?.memberRole) !== 'teacher')) {
    throw new Error('Every linked teacher must be an accepted teacher in your institute.')
  }
}

export async function canManageAttendance(
  actor: AttendanceActor,
  input: { organisationId: string; teacherUserId?: string },
) {
  if (actor.role === 'organisation') return actor.uid === input.organisationId
  if (actor.role !== 'user' || input.teacherUserId !== actor.uid) return false
  return (await membershipFor(input.organisationId, actor.uid))?.memberRole === 'teacher'
}

export function serializableTimestamp(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString()
  }
  return value ?? null
}
