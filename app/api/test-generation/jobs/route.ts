import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { testGenerationJobs } from '@/db/schema'
import { errorResponse, requireRole } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { createGenerationJob, createTopicGenerationJob } from '@/lib/test-generation/service'

const createJobSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('sources') }),
  z.object({
    mode: z.literal('topic'),
    examId: z.string().uuid(),
    topic: z.string().trim().min(2).max(160),
  }),
])

export async function GET(request: Request) {
  const auth = await requireRole(request, ['organisation', 'admin', 'user'])
  if ('error' in auth) return auth.error
  try {
    const rows = await database().select().from(testGenerationJobs)
      .where(auth.user.globalRole === 'admin' ? undefined : auth.user.organizationId ? eq(testGenerationJobs.organizationId, auth.user.organizationId) : eq(testGenerationJobs.createdBy, auth.user.uid))
      .orderBy(desc(testGenerationJobs.updatedAt)).limit(100)
    return Response.json({ jobs: rows.map(item => ({ ...item, ownerId: item.organizationId, subject: (item.analysis as { subject?: string } | null)?.subject || '', createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() })), enabled: process.env.AI_TEST_GENERATION_ENABLED !== 'false' })
  } catch (error) {
    return errorResponse(error, 'Unable to load AI test drafts.')
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ['organisation', 'user'])
  if ('error' in auth) return auth.error
  if (process.env.AI_TEST_GENERATION_ENABLED === 'false') return Response.json({ error: 'AI test generation is disabled.' }, { status: 503 })
  try {
    const raw = await request.json().catch(() => ({}))
    const parsed = createJobSchema.parse(
      raw && typeof raw === 'object' && !Array.isArray(raw) && !('mode' in raw)
        ? { ...raw, mode: 'sources' }
        : raw,
    )
    if (parsed.mode === 'sources') {
      return Response.json({ status: 'ready', jobId: await createGenerationJob(auth.user) }, { status: 201 })
    }
    const result = await createTopicGenerationJob(auth.user, parsed.examId, parsed.topic)
    if (result.resolution.status !== 'recognized' || !('jobId' in result)) {
      return Response.json(result.resolution)
    }
    return Response.json({
      ...result.resolution,
      jobId: result.jobId,
      analysis: result.analysis,
    }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'Unable to create an AI test draft.')
  }
}
