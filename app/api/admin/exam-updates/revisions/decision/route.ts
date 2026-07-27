import { z } from 'zod'
import { requireAdmin, errorResponse } from '@/lib/admin-api'
import { adminDb } from '@/lib/firebase-admin'
import { applyRevisionDecisions } from '@/lib/exam-review'

export const runtime = 'nodejs'

const RequestSchema = z.object({
  examId: z.string().min(1),
  revisionId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  decision: z.enum(['approved', 'rejected']),
}).refine((value) => Boolean(value.revisionId) !== Boolean(value.runId), {
  message: 'Pass exactly one of revisionId or runId.',
})

export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if ('error' in auth) return auth.error
  try {
    const input = RequestSchema.parse(await request.json())
    let revisionIds = input.revisionId ? [input.revisionId] : []
    if (input.runId) {
      const snapshots = await adminDb.collection('examCatalog').doc(input.examId).collection('revisions').get()
      revisionIds = snapshots.docs
        .filter((document) => document.data().status === 'pending' && document.data().runId === input.runId)
        .map((document) => document.id)
    }
    if (!revisionIds.length) return Response.json({ error: 'No pending revisions matched this request.' }, { status: 404 })
    await applyRevisionDecisions({
      examId: input.examId,
      revisionIds,
      decision: input.decision,
      reviewer: auth.user,
    })
    return Response.json({ ok: true, reviewed: revisionIds.length })
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message || 'Invalid revision decision request.' }, { status: 400 })
    return errorResponse(error, 'Unable to review the revision.')
  }
}
