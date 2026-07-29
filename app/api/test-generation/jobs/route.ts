import { errorResponse, requireRole } from '@/lib/admin-api'
import { adminDb } from '@/lib/firebase-admin'
import { createGenerationJob } from '@/lib/test-generation/service'

export const runtime = 'nodejs'

function enabled() {
  return process.env.AI_TEST_GENERATION_ENABLED !== 'false'
}

function timestamp(value: unknown) {
  return value && typeof value === 'object' && 'toDate' in value
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : null
}

export async function GET(request: Request) {
  const auth = await requireRole(request, ['organisation', 'admin'])
  if ('error' in auth) return auth.error
  try {
    const query = auth.user.role === 'admin'
      ? adminDb.collection('testGenerationJobs').limit(100)
      : adminDb.collection('testGenerationJobs').where('ownerId', '==', auth.user.uid).limit(100)
    const snapshot = await query.get()
    const jobs = snapshot.docs
      .map(item => {
        const data = item.data()
        return {
          id: item.id,
          ownerId: data.ownerId,
          status: data.status,
          subject: data.analysis?.subject || '',
          titleSuggestion: data.titleSuggestion || '',
          publishedTestId: data.publishedTestId || null,
          createdAt: timestamp(data.createdAt),
          updatedAt: timestamp(data.updatedAt),
        }
      })
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    return Response.json({ jobs, enabled: enabled() })
  } catch (error) {
    return errorResponse(error, 'Unable to load AI test drafts.')
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ['organisation'])
  if ('error' in auth) return auth.error
  if (!enabled()) return Response.json({ error: 'AI test generation is currently disabled.' }, { status: 503 })
  try {
    return Response.json({
      jobId: await createGenerationJob(auth.user),
      storagePrefix: `test-generation-sources/${auth.user.uid}`,
    }, { status: 201 })
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status) || 500
    if (status !== 500) return Response.json({ error: (error as Error).message }, { status })
    return errorResponse(error, 'Unable to create an AI test draft.')
  }
}
