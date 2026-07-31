import { eq } from 'drizzle-orm'
import { files, testGenerationSources } from '@/db/schema'
import { errorResponse, requireRole } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { cancelGenerationJob, listGeneratedQuestions, reconcileGenerationJob } from '@/lib/test-generation/service'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ['organisation', 'admin', 'user'])
  if ('error' in auth) return auth.error
  try {
    const job = await reconcileGenerationJob((await context.params).id, auth.user)
    const sources = await database().select({
      id: files.id,
      name: files.name,
      path: files.path,
      mimeType: files.contentType,
      size: files.size,
    }).from(testGenerationSources)
      .innerJoin(files, eq(files.id, testGenerationSources.fileId))
      .where(eq(testGenerationSources.jobId, job.id))
      .orderBy(testGenerationSources.position)
    return Response.json({
      job: {
        ...job,
        ownerId: job.organizationId,
        sources,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      },
      questions: await listGeneratedQuestions(job.id),
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load this AI test draft.')
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ['organisation', 'admin', 'user'])
  if ('error' in auth) return auth.error
  try {
    await cancelGenerationJob((await context.params).id, auth.user)
    return Response.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'Unable to discard this AI test draft.')
  }
}
