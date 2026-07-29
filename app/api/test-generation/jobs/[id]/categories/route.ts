import { z } from 'zod'
import { errorResponse, requireRole } from '@/lib/admin-api'
import { adminDb, FieldValue } from '@/lib/firebase-admin'
import { requireGenerationJob } from '@/lib/test-generation/service'

export const runtime = 'nodejs'

const inputSchema = z.object({
  examId: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(160),
})

function categorySlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ['organisation', 'admin'])
  if ('error' in auth) return auth.error
  try {
    const job = await requireGenerationJob((await context.params).id, auth.user)
    if (job.status !== 'review') return Response.json({ error: 'Categories can only be added while reviewing a draft.' }, { status: 409 })
    const parsed = inputSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Enter a valid category name.' }, { status: 400 })
    const slug = categorySlug(parsed.data.name)
    if (!slug) return Response.json({ error: 'The category name must contain letters or numbers.' }, { status: 400 })
    const exam = await adminDb.collection('examCatalog').doc(parsed.data.examId).get()
    if (!exam.exists) return Response.json({ error: 'Select a valid exam first.' }, { status: 400 })

    const reference = adminDb.collection('categories').doc(`${job.ownerId}_${parsed.data.examId}_${slug}`)
    await reference.set({
      name: parsed.data.name,
      examId: parsed.data.examId,
      createdBy: job.ownerId,
      organisationId: job.ownerId,
      createdByReviewer: auth.user.uid,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return Response.json({ category: { id: reference.id, name: parsed.data.name, examId: parsed.data.examId, createdBy: job.ownerId } }, { status: 201 })
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status) || 500
    if (status !== 500) return Response.json({ error: (error as Error).message }, { status })
    return errorResponse(error, 'Unable to create this category.')
  }
}
