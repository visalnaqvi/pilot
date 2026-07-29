import { errorResponse, requireRole } from '@/lib/admin-api'
import { finalizeGenerationUpload } from '@/lib/test-generation/service'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ['organisation'])
  if ('error' in auth) return auth.error
  try {
    const { id } = await params
    const body: unknown = await request.json()
    await finalizeGenerationUpload(
      id,
      auth.user,
      body && typeof body === 'object' ? (body as { sources?: unknown }).sources : null,
    )
    return Response.json({ status: 'analyzing' }, { status: 202 })
  } catch (error) {
    return errorResponse(error, 'Unable to analyse the uploaded material.')
  }
}
