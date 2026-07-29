import { errorResponse, requireRole } from '@/lib/admin-api'
import {
  cancelGenerationJob,
  listGeneratedQuestions,
  requireGenerationJob,
} from '@/lib/test-generation/service'

export const runtime = 'nodejs'

function timestamp(value: unknown) {
  return value && typeof value === 'object' && 'toDate' in value
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ['organisation', 'admin'])
  if ('error' in auth) return auth.error
  try {
    const { id } = await params
    const job = await requireGenerationJob(id, auth.user)
    return Response.json({
      job: {
        ...job,
        openaiFiles: undefined,
        activeResponseId: undefined,
        createdAt: timestamp((job as unknown as Record<string, unknown>).createdAt),
        updatedAt: timestamp((job as unknown as Record<string, unknown>).updatedAt),
      },
      questions: await listGeneratedQuestions(id),
    })
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status) || 500
    if (status !== 500) return Response.json({ error: (error as Error).message }, { status })
    return errorResponse(error, 'Unable to load this AI test draft.')
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ['organisation', 'admin'])
  if ('error' in auth) return auth.error
  try {
    const { id } = await params
    await cancelGenerationJob(id, auth.user)
    return Response.json({ ok: true })
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status) || 500
    if (status !== 500) return Response.json({ error: (error as Error).message }, { status })
    return errorResponse(error, 'Unable to discard this AI test draft.')
  }
}
