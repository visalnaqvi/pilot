import { errorResponse, requireRole } from '@/lib/admin-api'
import { adminDb, FieldValue } from '@/lib/firebase-admin'
import { timetableInputSchema } from '@/lib/timetable-schema'
import { membershipsForUser } from '@/lib/attendance-api'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const auth = await requireRole(request, ['user', 'organisation'])
  if ('error' in auth) return auth.error
  try {
    let source: FirebaseFirestore.Query = adminDb.collection('timetables')
    let mode: 'organisation' | 'teacher' | 'student'
    if (auth.user.role === 'organisation') {
      mode = 'organisation'
      source = source.where('organisationId', '==', auth.user.uid)
    } else {
      const teacherMemberships = await membershipsForUser(auth.user.uid, 'teacher')
      mode = teacherMemberships.length ? 'teacher' : 'student'
      source = teacherMemberships.length
        ? source.where('teacherUserIds', 'array-contains', auth.user.uid)
        : source.where('assignedUserIds', 'array-contains', auth.user.uid)
    }
    const snapshot = await source.get()
    return Response.json({
      mode,
      timetables: snapshot.docs.map(document => ({
        id: document.id,
        ...document.data(),
        publishedAt: document.data().publishedAt?.toDate?.().toISOString() || null,
        archivedAt: document.data().archivedAt?.toDate?.().toISOString() || null,
        createdAt: document.data().createdAt?.toDate?.().toISOString() || null,
        updatedAt: document.data().updatedAt?.toDate?.().toISOString() || null,
      })),
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load published timetables.')
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ['organisation'])
  if ('error' in auth) return auth.error
  try {
    const body = await request.json().catch(() => null)
    const parsed = timetableInputSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message || 'Invalid timetable details.', issues: parsed.error.issues }, { status: 400 })
    }
    const reference = adminDb.collection('timetableDrafts').doc()
    await reference.create({
      ...parsed.data,
      organisationId: auth.user.uid,
      organisationName: auth.user.name,
      timeZone: process.env.APP_TIME_ZONE || 'Asia/Kolkata',
      createdBy: auth.user.uid,
      publishedRevision: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return Response.json({ timetableId: reference.id }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'Unable to create the timetable draft.')
  }
}
