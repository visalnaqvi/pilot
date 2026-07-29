import { errorResponse, requireRole } from '@/lib/admin-api'
import { updateGeneratedQuestion } from '@/lib/test-generation/service'

export const runtime = 'nodejs'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; questionId: string }> },
) {
  const auth = await requireRole(request, ['organisation', 'admin'])
  if ('error' in auth) return auth.error
  try {
    const { id, questionId } = await params
    await updateGeneratedQuestion(id, questionId, auth.user, await request.json())
    return Response.json({ ok: true })
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status) || 500
    if (status !== 500) return Response.json({ error: (error as Error).message }, { status })
    return errorResponse(error, 'Unable to update this generated question.')
  }
}
