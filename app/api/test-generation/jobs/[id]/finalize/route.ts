import { z } from 'zod'
import { errorResponse, requireRole } from '@/lib/admin-api'
import { attachGenerationSources } from '@/lib/test-generation/service'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ['organisation', 'user'])
  if ('error' in auth) return auth.error
  try {
    const body = z.object({ fileIds: z.array(z.string().uuid()).min(1).max(10) }).parse(await request.json())
    await attachGenerationSources((await context.params).id, auth.user, body.fileIds)
    return Response.json({ status: 'analysis_ready' })
  } catch (error) {
    return errorResponse(error, 'Unable to attach source material.')
  }
}
