import 'server-only'

import { adminDb } from './firebase-admin'
import { membershipFor } from './attendance-api'

type ContentActor = {
  uid: string
  role: string
  name: string
}

export async function contentOrganisationFor(actor: ContentActor, requestedOrganisationId?: string) {
  if (actor.role === 'organisation') {
    if (requestedOrganisationId && requestedOrganisationId !== actor.uid) return null
    return { id: actor.uid, name: actor.name }
  }
  if (actor.role !== 'user' || !requestedOrganisationId) return null
  const membership = await membershipFor(requestedOrganisationId, actor.uid)
  if (membership?.memberRole !== 'teacher') return null
  return { id: membership.organisationId, name: membership.organisationName }
}

export async function isTeacherForOrganisation(userId: string, organisationId: string) {
  return (await membershipFor(organisationId, userId))?.memberRole === 'teacher'
}

export async function organisationName(organisationId: string) {
  const profile = await adminDb.collection('users').doc(organisationId).get()
  return String(profile.data()?.name || profile.data()?.email || organisationId)
}
