import { errorResponse, requireRole } from '@/lib/admin-api'
import { adminDb, Timestamp } from '@/lib/firebase-admin'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ['organisation'])
  if ('error' in auth) return auth.error
  try {
    const { id } = await context.params
    const reference = adminDb.collection('timetables').doc(id)
    const initial = await reference.get()
    if (!initial.exists) return Response.json({ error: 'Published timetable not found.' }, { status: 404 })
    if (initial.data()?.organisationId !== auth.user.uid) {
      return Response.json({ error: 'You cannot archive this timetable.' }, { status: 403 })
    }
    const result = await adminDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new Error('Published timetable not found.')
      const timetable = snapshot.data()!
      if (timetable.organisationId !== auth.user.uid) throw new Error('You cannot archive this timetable.')
      if (timetable.status === 'archived') return { changed: false }
      const revision = Number(timetable.revision || 0) + 1
      const now = Timestamp.now()
      transaction.update(reference, {
        status: 'archived',
        revision,
        archivedAt: now,
        updatedAt: now,
      })
      return { changed: true }
    })
    return Response.json({ timetableId: id, changed: result.changed })
  } catch (error) {
    return errorResponse(error, 'Unable to archive the timetable.')
  }
}
