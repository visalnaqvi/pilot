import { requireAdmin, errorResponse } from '@/lib/admin-api'
import { adminDb } from '@/lib/firebase-admin'
import { serializeAdminData } from '@/lib/exam-review'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const auth = await requireAdmin(request)
  if ('error' in auth) return auth.error
  try {
    const exams = await adminDb.collection('examCatalog').orderBy('name').get()
    const payload = await Promise.all(exams.docs.map(async (exam) => {
      const revisions = await exam.ref.collection('revisions').get()
      return {
        id: exam.id,
        name: exam.data().name,
        revisions: revisions.docs
          .map((document) => ({ id: document.id, ...document.data() }) as Record<string, unknown> & { id: string })
          .filter((revision) => revision.status === 'pending'),
      }
    }))
    return Response.json(serializeAdminData({
      catalog: payload.map(({ id, name }) => ({ id, name })),
      exams: payload.filter((exam) => exam.revisions.length),
    }))
  } catch (error) {
    return errorResponse(error, 'Unable to load exam update reviews.')
  }
}
