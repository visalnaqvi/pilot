import { errorResponse, requireRole } from '@/lib/admin-api'
import { reorderGeneratedQuestions } from '@/lib/test-generation/service'

export const runtime = 'nodejs'

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ['organisation', 'admin'])
  if ('error' in auth) return auth.error
  try {
    const body = await request.json() as { questionIds?: unknown }
    await reorderGeneratedQuestions((await context.params).id, auth.user, body.questionIds)
    return Response.json({ ok: true })
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status) || 500
    if (status !== 500) return Response.json({ error: (error as Error).message }, { status })
    return errorResponse(error, 'Unable to reorder generated questions.')
  }
}
