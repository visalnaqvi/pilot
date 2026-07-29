import { errorResponse, requireRole } from '@/lib/admin-api'
import { publishGenerationJob } from '@/lib/test-generation/service'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ['organisation', 'admin'])
  if ('error' in auth) return auth.error
  try {
    const { id } = await params
    const body: unknown = await request.json()
    return Response.json({ testId: await publishGenerationJob(id, auth.user, body) })
  } catch (error) {
    return errorResponse(error, 'Unable to publish this generated test.')
  }
}
