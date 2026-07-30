import { errorResponse, requireRole } from '@/lib/admin-api'
import { adminDb } from '@/lib/firebase-admin'
import { memberRole } from '@/lib/membership'

export const runtime = 'nodejs'

function testJson(document: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = document.data()
  return {
    id: document.id,
    ...data,
    createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
    publishedAt: data.publishedAt?.toDate?.()?.toISOString() || null,
    deletedAt: data.deletedAt?.toDate?.()?.toISOString() || data.deletedAt || null,
  }
}

export async function GET(request: Request) {
  const auth = await requireRole(request, ['user', 'organisation', 'admin'])
  if ('error' in auth) return auth.error

  try {
    if (auth.user.role === 'admin') {
      const snapshot = await adminDb.collection('tests').get()
      return Response.json({ tests: snapshot.docs.map(testJson) })
    }

    const snapshot = await adminDb.collection('tests')
      .where('createdBy', '==', auth.user.uid)
      .get()

    if (auth.user.role === 'organisation') {
      return Response.json({
        tests: snapshot.docs
          .filter(document => {
            const organisationId = document.data().organisationId
            return document.data().visibility === 'public'
              || !organisationId
              || organisationId === auth.user.uid
          })
          .map(testJson),
      })
    }

    const memberships = await adminDb.collection('organisationInvites')
      .where('userId', '==', auth.user.uid)
      .where('status', '==', 'accepted')
      .get()
    const teacherOrganisationIds = new Set(memberships.docs
      .filter(document => memberRole(document.data().memberRole) === 'teacher')
      .map(document => String(document.data().organisationId)))

    return Response.json({
      tests: snapshot.docs
        .filter(document => {
          const data = document.data()
          return data.createdBy === auth.user.uid
            && ['private', 'assigned'].includes(data.visibility)
            && teacherOrganisationIds.has(String(data.organisationId))
        })
        .map(testJson),
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load tests.')
  }
}
