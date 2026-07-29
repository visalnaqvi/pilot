import { errorResponse, requireRole } from '@/lib/admin-api'
import { startGeneration } from '@/lib/test-generation/service'

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
    await startGeneration(
      id,
      auth.user,
      body && typeof body === 'object' ? (body as { config?: unknown }).config : null,
    )
    return Response.json({ status: 'generating' }, { status: 202 })
  } catch (error) {
    return errorResponse(error, 'Unable to generate questions.')
  }
}
