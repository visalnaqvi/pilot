import { eq } from 'drizzle-orm'
import { timetables } from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { canAdministerOrganization } from '@/lib/services/access'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const { id } = await context.params
    const item = (await database().select().from(timetables).where(eq(timetables.id, id)).limit(1))[0]
    if (!item) return Response.json({ error: 'Timetable not found.' }, { status: 404 })
    if (!(await canAdministerOrganization(auth.user, item.organizationId))) return Response.json({ error: 'Organization owner access required.' }, { status: 403 })
    await database().update(timetables).set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() }).where(eq(timetables.id, id))
    return Response.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'Unable to archive timetable.')
  }
}
