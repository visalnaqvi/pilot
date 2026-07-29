import { errorResponse, requireRole } from '@/lib/admin-api'
import { adminDb, FieldValue } from '@/lib/firebase-admin'
import { timetableInputSchema } from '@/lib/timetable-schema'

export const runtime = 'nodejs'

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ['organisation'])
  if ('error' in auth) return auth.error
  try {
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const parsed = timetableInputSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message || 'Invalid timetable details.', issues: parsed.error.issues }, { status: 400 })
    }
    const reference = adminDb.collection('timetableDrafts').doc(id)
    const draft = await reference.get()
    if (!draft.exists) return Response.json({ error: 'Timetable draft not found.' }, { status: 404 })
    if (draft.data()?.organisationId !== auth.user.uid) {
      return Response.json({ error: 'You cannot edit this timetable.' }, { status: 403 })
    }
    await reference.update({ ...parsed.data, updatedAt: FieldValue.serverTimestamp() })
    return Response.json({ timetableId: id })
  } catch (error) {
    return errorResponse(error, 'Unable to update the timetable draft.')
  }
}
