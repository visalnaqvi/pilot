import { z } from 'zod'
import { requireAdmin, errorResponse } from '@/lib/admin-api'
import { refreshExams } from '@/lib/exam-refresh/worker'

export const runtime = 'nodejs'
export const maxDuration = 300

const RequestSchema = z.object({
  examId: z.string().min(1),
})

export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if ('error' in auth) return auth.error
  try {
    const input = RequestSchema.parse(await request.json())
    const result = await refreshExams({ examId: input.examId, write: true })
    if (result.errors.length) return Response.json({ error: result.errors[0], result }, { status: 502 })
    return Response.json({ ok: true, result })
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Choose an exam to refresh.' }, { status: 400 })
    return errorResponse(error, 'Unable to refresh exam information.')
  }
}
