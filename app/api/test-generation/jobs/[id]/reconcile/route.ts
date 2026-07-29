import { errorResponse, requireRole } from '@/lib/admin-api'
import { reconcileGenerationJob } from '@/lib/test-generation/service'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ['organisation', 'admin'])
  if ('error' in auth) return auth.error
  try {
    const { id } = await params
    const job = await reconcileGenerationJob(id, auth.user)
    return Response.json({ status: job?.status || 'missing' })
  } catch (error) {
    return errorResponse(error, 'Unable to refresh generation status.')
  }
}
