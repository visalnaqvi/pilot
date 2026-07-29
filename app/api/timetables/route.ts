import { errorResponse, requireRole } from '@/lib/admin-api'
import { adminDb, FieldValue } from '@/lib/firebase-admin'
import { timetableInputSchema } from '@/lib/timetable-schema'

export const runtime = 'nodejs'

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

