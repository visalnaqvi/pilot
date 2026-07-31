import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  assignmentBatches,
  assignmentRecipients,
  categories,
  exams,
  questionKeys,
  questions,
  testQuestions,
  tests,
} from '@/db/schema'
import { authenticateRequest, errorResponse, type ServerUser } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { normalizeExamKey } from '@/lib/exam-catalog'
import { adminStorage } from '@/lib/firebase-admin'
import { canManageOrganization } from '@/lib/services/access'

const questionSchema = z.object({
  questionId: z.string().uuid().optional(),
  kind: z.enum(['mcq', 'short_answer']).default('mcq'),
  prompt: z.string().trim().min(1).max(10_000),
  options: z.array(z.string().trim().min(1).max(2_000)).min(2).max(8).optional(),
  correctAnswer: z.number().int().min(0).optional(),
  modelAnswer: z.string().max(10_000).optional(),
  explanation: z.string().max(10_000).optional(),
  format: z.enum(['plain', 'equation', 'image']).default('plain'),
  promptImagePath: z.string().max(1_200).nullable().optional(),
  optionImagePaths: z.array(z.string().max(1_200)).max(8).optional(),
  marks: z.number().int().min(1).max(100),
})
const saveSchema = z.object({
  id: z.string().uuid().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  examId: z.string().uuid(),
  categoryId: z.string().uuid().optional(),
  categoryName: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(10_000).default(''),
  durationMinutes: z.number().int().min(0).max(1_440),
  visibility: z.enum(['public', 'private', 'assigned']),
  published: z.boolean().default(true),
  questions: z.array(questionSchema).min(1).max(500),
})

async function serializeTests(rows: (typeof tests.$inferSelect)[]) {
  const db = database()
  const examRows = rows.length ? await db.select().from(exams).where(inArray(exams.id, rows.map(item => item.examId))) : []
  const categoryRows = rows.length ? await db.select().from(categories).where(inArray(categories.id, rows.map(item => item.categoryId))) : []
  return rows.map(item => ({
    ...item,
    organisationId: item.organizationId,
    exam: examRows.find(exam => exam.id === item.examId)?.name || '',
    examAlias: examRows.find(exam => exam.id === item.examId)?.name || '',
    category: categoryRows.find(category => category.id === item.categoryId)?.name || '',
    createdAt: item.createdAt.toISOString(),
    publishedAt: item.publishedAt?.toISOString() || null,
    deletedAt: item.deletedAt?.toISOString() || null,
    updatedAt: item.updatedAt.toISOString(),
  }))
}

async function canEditTest(user: ServerUser, item: typeof tests.$inferSelect) {
  return user.globalRole === 'admin'
    || item.createdBy === user.uid
    || Boolean(item.organizationId && await canManageOrganization(user, item.organizationId))
}

async function signedImage(path: string | null | undefined) {
  if (!path) return undefined
  const [url] = await adminStorage.bucket().file(path).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 60 * 60_000,
  })
  return url
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    const owned = url.searchParams.get('owned') === '1'
    const includeDeleted = url.searchParams.get('deleted') === '1'
    const edit = url.searchParams.get('edit') === '1'
    const db = database()
    let rows: (typeof tests.$inferSelect)[]
    if (id) {
      rows = await db.select().from(tests).where(eq(tests.id, id)).limit(1)
    } else if (owned) {
      rows = await db.select().from(tests).where(auth.user.globalRole === 'admin'
        ? includeDeleted ? undefined : isNull(tests.deletedAt)
        : and(
            or(
              eq(tests.createdBy, auth.user.uid),
              auth.user.organizationId ? eq(tests.organizationId, auth.user.organizationId) : eq(tests.createdBy, auth.user.uid),
            ),
            includeDeleted ? undefined : isNull(tests.deletedAt),
          )).orderBy(desc(tests.updatedAt))
    } else {
      const assignments = await db.select({ testId: assignmentBatches.testId }).from(assignmentRecipients)
        .innerJoin(assignmentBatches, eq(assignmentBatches.id, assignmentRecipients.assignmentBatchId))
        .where(eq(assignmentRecipients.userId, auth.user.uid))
      const assignedIds = assignments.map(item => item.testId)
      rows = await db.select().from(tests).where(and(
        isNull(tests.deletedAt),
        eq(tests.published, true),
        or(
          eq(tests.visibility, 'public'),
          auth.user.organizationId ? eq(tests.organizationId, auth.user.organizationId) : eq(tests.createdBy, auth.user.uid),
          assignedIds.length ? inArray(tests.id, assignedIds) : eq(tests.createdBy, auth.user.uid),
          eq(tests.createdBy, auth.user.uid),
        ),
      )).orderBy(desc(tests.createdAt))
    }
    if (id) {
      const item = rows[0]
      if (!item || item.deletedAt) return Response.json({ error: 'Test not found.' }, { status: 404 })
      const editable = await canEditTest(auth.user, item)
      const accessible = editable || item.visibility === 'public'
        || Boolean(item.organizationId && item.organizationId === auth.user.organizationId)
        || Boolean((await db.select().from(assignmentRecipients)
          .innerJoin(assignmentBatches, eq(assignmentBatches.id, assignmentRecipients.assignmentBatchId))
          .where(and(eq(assignmentRecipients.userId, auth.user.uid), eq(assignmentBatches.testId, item.id))).limit(1)).length)
      if (!accessible) return Response.json({ error: 'You cannot access this test.' }, { status: 403 })
      const joins = await db.select().from(testQuestions).where(eq(testQuestions.testId, item.id)).orderBy(asc(testQuestions.position))
      const questionIds = joins.flatMap(join => join.questionId ? [join.questionId] : [])
      const questionRows = questionIds.length ? await db.select().from(questions).where(inArray(questions.id, questionIds)) : []
      const keys = edit && editable && questionIds.length ? await db.select().from(questionKeys).where(inArray(questionKeys.questionId, questionIds)) : []
      const [serialized] = await serializeTests([item])
      return Response.json({
        item: {
          ...serialized,
          editable,
          questions: await Promise.all(joins.map(async join => {
            const question = questionRows.find(value => value.id === join.questionId)
            const snapshot = join.snapshot as Record<string, unknown> | null
            const key = keys.find(value => value.questionId === join.questionId)
            return {
              id: join.id,
              questionId: join.questionId,
              position: join.position,
              marks: join.marks,
              kind: question?.kind || snapshot?.kind || 'mcq',
              prompt: question?.prompt || snapshot?.prompt || '',
              options: question?.options || snapshot?.options || [],
              format: question?.format || snapshot?.format || 'plain',
              promptImagePath: question?.promptImagePath || snapshot?.promptImagePath || null,
              optionImagePaths: question?.optionImagePaths || snapshot?.optionImagePaths || [],
              promptImageUrl: await signedImage(question?.promptImagePath || (typeof snapshot?.promptImagePath === 'string' ? snapshot.promptImagePath : null)),
              optionImageUrls: await Promise.all((question?.optionImagePaths || (Array.isArray(snapshot?.optionImagePaths) ? snapshot.optionImagePaths as string[] : [])).map(path => signedImage(path))),
              ...(edit && editable ? {
                correctAnswer: key?.correctAnswer,
                modelAnswer: key?.modelAnswer,
                explanation: key?.explanation,
              } : {}),
            }
          })),
        },
      })
    }
    return Response.json({ items: await serializeTests(rows), nextCursor: null })
  } catch (error) {
    return errorResponse(error, 'Unable to load tests.')
  }
}

async function save(request: Request, update: boolean) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const parsed = saveSchema.safeParse(await request.json())
    if (!parsed.success || (update && !parsed.data.id)) {
      return Response.json({ error: 'Invalid test.', issues: parsed.success ? [] : parsed.error.issues }, { status: 400 })
    }
    const organizationId = parsed.data.organizationId || auth.user.organizationId
    if (organizationId && !(await canManageOrganization(auth.user, organizationId))) {
      return Response.json({ error: 'Organization content access required.' }, { status: 403 })
    }
    const db = database()
    if (update) {
      const existing = (await db.select().from(tests).where(eq(tests.id, parsed.data.id!)).limit(1))[0]
      if (!existing || !(await canEditTest(auth.user, existing))) {
        return Response.json({ error: 'You cannot edit this test.' }, { status: 403 })
      }
    }
    const testId = await db.transaction(async tx => {
      let categoryId = parsed.data.categoryId
      if (!categoryId) {
        const categoryName = parsed.data.categoryName || 'General'
        const normalizedName = normalizeExamKey(categoryName)
        const existing = (await tx.select().from(categories).where(and(
          eq(categories.examId, parsed.data.examId),
          organizationId ? eq(categories.organizationId, organizationId) : isNull(categories.organizationId),
          eq(categories.normalizedName, normalizedName),
        )).limit(1))[0]
        categoryId = existing?.id || (await tx.insert(categories).values({
          organizationId,
          examId: parsed.data.examId,
          name: categoryName,
          normalizedName,
          createdBy: auth.user.uid,
        }).returning())[0].id
      }
      const values = {
        organizationId,
        examId: parsed.data.examId,
        categoryId,
        createdBy: auth.user.uid,
        title: parsed.data.title,
        description: parsed.data.description,
        durationMinutes: parsed.data.durationMinutes,
        visibility: parsed.data.visibility,
        published: parsed.data.published,
        publishedAt: parsed.data.published ? new Date() : null,
        questionCount: parsed.data.questions.length,
        totalMarks: parsed.data.questions.reduce((sum, item) => sum + item.marks, 0),
        updatedAt: new Date(),
      }
      const [test] = update
        ? await tx.update(tests).set(values).where(eq(tests.id, parsed.data.id!)).returning()
        : await tx.insert(tests).values(values).returning()
      if (update) await tx.delete(testQuestions).where(eq(testQuestions.testId, test.id))
      for (const [position, input] of parsed.data.questions.entries()) {
        let questionId = input.questionId
        if (!questionId) {
          const [question] = await tx.insert(questions).values({
            organizationId,
            createdBy: auth.user.uid,
            kind: input.kind,
            visibility: parsed.data.visibility,
            prompt: input.prompt,
            options: input.kind === 'mcq' ? input.options : null,
            format: input.format,
            promptImagePath: input.promptImagePath || null,
            optionImagePaths: input.optionImagePaths || [],
          }).returning()
          questionId = question.id
          await tx.insert(questionKeys).values({
            questionId,
            correctAnswer: input.kind === 'mcq' ? input.correctAnswer : null,
            modelAnswer: input.kind === 'short_answer' ? input.modelAnswer : null,
            explanation: input.explanation,
          })
        } else {
          await tx.update(questions).set({
            kind: input.kind,
            visibility: parsed.data.visibility,
            prompt: input.prompt,
            options: input.kind === 'mcq' ? input.options : null,
            format: input.format,
            promptImagePath: input.promptImagePath || null,
            optionImagePaths: input.optionImagePaths || [],
            revision: sql`${questions.revision} + 1`,
            updatedAt: new Date(),
          }).where(eq(questions.id, questionId))
          await tx.insert(questionKeys).values({
            questionId,
            correctAnswer: input.kind === 'mcq' ? input.correctAnswer : null,
            modelAnswer: input.kind === 'short_answer' ? input.modelAnswer : null,
            explanation: input.explanation,
          }).onConflictDoUpdate({
            target: questionKeys.questionId,
            set: {
              correctAnswer: input.kind === 'mcq' ? input.correctAnswer : null,
              modelAnswer: input.kind === 'short_answer' ? input.modelAnswer : null,
              explanation: input.explanation,
              updatedAt: new Date(),
            },
          })
        }
        await tx.insert(testQuestions).values({
          testId: test.id,
          questionId,
          position,
          marks: input.marks,
          snapshot: {
            kind: input.kind,
            prompt: input.prompt,
            options: input.options || [],
            format: input.format,
            promptImagePath: input.promptImagePath || null,
            optionImagePaths: input.optionImagePaths || [],
          },
        })
      }
      return test.id
    })
    return Response.json({ id: testId }, { status: update ? 200 : 201 })
  } catch (error) {
    return errorResponse(error, 'Unable to save test.')
  }
}

export const POST = (request: Request) => save(request, false)
export const PUT = (request: Request) => save(request, true)

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const body = z.object({ id: z.string().uuid(), deleted: z.boolean() }).parse(await request.json())
    const item = (await database().select().from(tests).where(eq(tests.id, body.id)).limit(1))[0]
    if (!item || !(await canEditTest(auth.user, item))) return Response.json({ error: 'Test not found.' }, { status: 404 })
    await database().update(tests).set({
      deletedAt: body.deleted ? new Date() : null,
      deletedBy: body.deleted ? auth.user.uid : null,
      updatedAt: new Date(),
    }).where(eq(tests.id, body.id))
    return Response.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'Unable to update test.')
  }
}
