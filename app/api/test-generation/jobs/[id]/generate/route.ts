import { errorResponse, requireRole } from '@/lib/admin-api'
import { generateFromSources } from '@/lib/test-generation/service'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ['organisation', 'admin', 'user'])
  if ('error' in auth) return auth.error
  try {
    const body = await request.json().catch(() => ({})) as { config?: unknown }
    await generateFromSources((await context.params).id, auth.user, body.config)
    return Response.json({ status: 'generating' }, { status: 202 })
  } catch (error) {
    return errorResponse(error, 'Unable to generate questions.')
  }
}
