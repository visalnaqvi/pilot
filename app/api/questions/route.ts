import { and, eq, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { questionKeys, questions } from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { canManageOrganization } from '@/lib/services/access'

const updateSchema = z.object({
  id: z.string().uuid(),
  prompt: z.string().trim().min(1).max(10_000).optional(),
  options: z.array(z.string().trim().min(1).max(2_000)).min(2).max(8).optional(),
  correctAnswer: z.number().int().min(0).optional(),
  archived: z.boolean().optional(),
})

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  if (auth.user.globalRole !== 'admin' && !['owner', 'teacher'].includes(auth.user.membershipRole || '')) {
    return Response.json({ error: 'Question-bank access required.' }, { status: 403 })
  }
  try {
    const id = new URL(request.url).searchParams.get('id')
    const db = database()
    const rows = await db.select({
      id: questions.id,
      organizationId: questions.organizationId,
      createdBy: questions.createdBy,
      kind: questions.kind,
      visibility: questions.visibility,
      prompt: questions.prompt,
      options: questions.options,
      format: questions.format,
      promptImagePath: questions.promptImagePath,
      optionImagePaths: questions.optionImagePaths,
      revision: questions.revision,
      archivedAt: questions.archivedAt,
      createdAt: questions.createdAt,
      updatedAt: questions.updatedAt,
      correctAnswer: questionKeys.correctAnswer,
      explanation: questionKeys.explanation,
      modelAnswer: questionKeys.modelAnswer,
      rubric: questionKeys.rubric,
    }).from(questions)
      .leftJoin(questionKeys, eq(questionKeys.questionId, questions.id))
      .where(id
        ? eq(questions.id, id)
        : auth.user.globalRole === 'admin'
          ? undefined
          : or(
              eq(questions.createdBy, auth.user.uid),
              and(eq(questions.visibility, 'public'), isNull(questions.archivedAt)),
            ))
    const visible = rows.filter(row => (
      auth.user.globalRole === 'admin'
      || row.createdBy === auth.user.uid
      || row.visibility === 'public'
      || (row.organizationId && row.organizationId === auth.user.organizationId)
    ))
    if (id && !visible.length) return Response.json({ error: 'Question not found.' }, { status: 404 })
    const items = visible.map(row => ({
      ...row,
      organisationId: row.organizationId,
      promptImageUrl: row.promptImagePath,
      optionImageUrls: row.optionImagePaths,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() || null,
    }))
    return id ? Response.json({ item: items[0] }) : Response.json({ items, nextCursor: null })
  } catch (error) {
    return errorResponse(error, 'Unable to load questions.')
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const parsed = updateSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid question.', issues: parsed.error.issues }, { status: 400 })
    const db = database()
    const current = (await db.select().from(questions).where(eq(questions.id, parsed.data.id)).limit(1))[0]
    if (!current) return Response.json({ error: 'Question not found.' }, { status: 404 })
    const canEdit = auth.user.globalRole === 'admin'
      || current.createdBy === auth.user.uid
      || Boolean(current.organizationId && await canManageOrganization(auth.user, current.organizationId))
    if (!canEdit) return Response.json({ error: 'You cannot edit this question.' }, { status: 403 })
    await db.transaction(async tx => {
      await tx.update(questions).set({
        ...(parsed.data.prompt ? { prompt: parsed.data.prompt } : {}),
        ...(parsed.data.options ? { options: parsed.data.options } : {}),
        ...(parsed.data.archived !== undefined ? { archivedAt: parsed.data.archived ? new Date() : null } : {}),
        revision: current.revision + 1,
        updatedAt: new Date(),
      }).where(eq(questions.id, current.id))
      if (parsed.data.correctAnswer !== undefined) {
        await tx.insert(questionKeys).values({
          questionId: current.id,
          correctAnswer: parsed.data.correctAnswer,
        }).onConflictDoUpdate({
          target: questionKeys.questionId,
          set: { correctAnswer: parsed.data.correctAnswer, updatedAt: new Date() },
        })
      }
    })
    return Response.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'Unable to update question.')
  }
}
