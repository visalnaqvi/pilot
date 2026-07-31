import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  submissionAnswers,
  submissionOrganizationAccess,
  testSubmissions,
  users,
} from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'

async function accessible(user: { uid: string; globalRole: string; organizationId: string | null }, submission: typeof testSubmissions.$inferSelect) {
  if (user.globalRole === 'admin' || submission.userId === user.uid) return true
  if (!user.organizationId) return false
  return Boolean((await database().select().from(submissionOrganizationAccess).where(and(
    eq(submissionOrganizationAccess.submissionId, submission.id),
    eq(submissionOrganizationAccess.organizationId, user.organizationId),
  )).limit(1)).length)
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const { id } = await context.params
    const db = database()
    const item = (await db.select().from(testSubmissions).where(eq(testSubmissions.id, id)).limit(1))[0]
    if (!item || !(await accessible(auth.user, item))) return Response.json({ error: 'Submission not found.' }, { status: 404 })
    const answers = await db.select().from(submissionAnswers).where(eq(submissionAnswers.submissionId, id)).orderBy(submissionAnswers.questionIndex)
    const person = (await db.select().from(users).where(eq(users.id, item.userId)).limit(1))[0]
    return Response.json({
      item: {
        ...item,
        userEmail: person?.email || '',
        userName: person?.name || '',
        testExam: item.examName,
        testCategory: item.categoryName,
        testVisibility: item.visibility,
        submittedAt: item.submittedAt.toISOString(),
        answers: answers.map(answer => ({
          id: answer.id,
          questionIndex: answer.questionIndex,
          ...(answer.questionSnapshot as Record<string, unknown>),
          selectedAnswer: typeof answer.response === 'number' ? answer.response : null,
          response: typeof answer.response === 'string' ? answer.response : null,
          correctAnswer: answer.correctAnswer,
          isCorrect: typeof answer.response === 'number' && answer.response === answer.correctAnswer,
          awardedMarks: answer.awardedMarks,
          feedback: answer.feedback,
          gradingStatus: answer.gradingStatus,
        })),
      },
      submission: {
        ...item,
        userEmail: person?.email || '',
        userName: person?.name || '',
        testExam: item.examName,
        testCategory: item.categoryName,
        testVisibility: item.visibility,
        submittedAt: item.submittedAt.toISOString(),
        answers: answers.map(answer => ({
          id: answer.id,
          questionIndex: answer.questionIndex,
          ...(answer.questionSnapshot as Record<string, unknown>),
          selectedAnswer: typeof answer.response === 'number' ? answer.response : null,
          response: typeof answer.response === 'string' ? answer.response : null,
          correctAnswer: answer.correctAnswer,
          isCorrect: typeof answer.response === 'number' && answer.response === answer.correctAnswer,
          awardedMarks: answer.awardedMarks,
          feedback: answer.feedback,
          gradingStatus: answer.gradingStatus,
        })),
      },
      canGrade: auth.user.globalRole === 'admin' || ['owner', 'teacher'].includes(auth.user.membershipRole || ''),
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load submission.')
  }
}

const gradeSchema = z.object({
  answers: z.array(z.object({
    id: z.string().uuid(),
    awardedMarks: z.number().int().min(0),
    feedback: z.string().max(10_000).default(''),
  })).min(1),
})

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  if (auth.user.globalRole !== 'admin' && !['owner', 'teacher'].includes(auth.user.membershipRole || '')) {
    return Response.json({ error: 'Grader access required.' }, { status: 403 })
  }
  try {
    const { id } = await context.params
    const parsed = gradeSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid grades.', issues: parsed.error.issues }, { status: 400 })
    const db = database()
    const item = (await db.select().from(testSubmissions).where(eq(testSubmissions.id, id)).limit(1))[0]
    if (!item || !(await accessible(auth.user, item))) return Response.json({ error: 'Submission not found.' }, { status: 404 })
    const currentAnswers = await db.select().from(submissionAnswers).where(eq(submissionAnswers.submissionId, id))
    for (const grade of parsed.data.answers) {
      const answer = currentAnswers.find(value => value.id === grade.id)
      const marks = Number((answer?.questionSnapshot as { marks?: unknown } | null)?.marks)
      if (!answer || !Number.isFinite(marks) || grade.awardedMarks > marks) {
        return Response.json({ error: 'Awarded marks exceed the question maximum.' }, { status: 400 })
      }
    }
    await db.transaction(async tx => {
      for (const answer of parsed.data.answers) {
        await tx.update(submissionAnswers).set({
          awardedMarks: answer.awardedMarks,
          feedback: answer.feedback,
          gradingStatus: 'graded',
        }).where(and(eq(submissionAnswers.id, answer.id), eq(submissionAnswers.submissionId, id)))
      }
      const totals = await tx.select({
        score: sql<number>`coalesce(sum(${submissionAnswers.awardedMarks}), 0)::int`,
        pending: sql<number>`coalesce(sum(case when ${submissionAnswers.gradingStatus} = 'pending' then 1 else 0 end), 0)::int`,
      }).from(submissionAnswers).where(eq(submissionAnswers.submissionId, id))
      await tx.update(testSubmissions).set({
        score: totals[0].score,
        pendingMarks: 0,
        gradingStatus: totals[0].pending ? 'pending' : 'graded',
      }).where(eq(testSubmissions.id, id))
    })
    return Response.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'Unable to grade submission.')
  }
}
