import { and, asc, eq } from 'drizzle-orm'
import {
  assignmentBatches,
  assignmentRecipients,
  questions,
  tasks,
  testQuestions,
  tests,
} from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { adminStorage } from '@/lib/firebase-admin'

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
    const testId = url.searchParams.get('testId')
    const assignmentBatchId = url.searchParams.get('assignment')
    if (!testId) return Response.json({ error: 'Test is required.' }, { status: 400 })
    const db = database()
    const test = (await db.select().from(tests).where(eq(tests.id, testId)).limit(1))[0]
    if (!test || !test.published || test.deletedAt) return Response.json({ error: 'Test not found.' }, { status: 404 })

    let assignment: null | {
      id: string
      assignmentBatchId: string
      assignmentName: string
      linkedTaskId?: string
      maxAttempts: number
      attemptsUsed: number
      startAt: string
      endAt: string
      deadline: string
    } = null
    let status: 'open' | 'not_started' | 'ended' | 'attempts_exhausted' | 'invalid' = 'open'
    if (assignmentBatchId) {
      const row = (await db.select({
        batch: assignmentBatches,
        recipient: assignmentRecipients,
      }).from(assignmentRecipients)
        .innerJoin(assignmentBatches, eq(assignmentBatches.id, assignmentRecipients.assignmentBatchId))
        .where(and(
          eq(assignmentRecipients.assignmentBatchId, assignmentBatchId),
          eq(assignmentRecipients.userId, auth.user.uid),
        )).limit(1))[0]
      if (!row || row.batch.testId !== test.id) {
        status = 'invalid'
      } else {
        const linkedTask = (await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.assignmentBatchId, row.batch.id)).limit(1))[0]
        const now = new Date()
        status = now < row.batch.startAt
          ? 'not_started'
          : now > row.batch.deadline
            ? 'ended'
            : row.recipient.attemptsUsed >= row.batch.maxAttempts
              ? 'attempts_exhausted'
              : 'open'
        assignment = {
          id: row.batch.id,
          assignmentBatchId: row.batch.id,
          assignmentName: row.batch.name,
          linkedTaskId: linkedTask?.id,
          maxAttempts: row.batch.maxAttempts,
          attemptsUsed: row.recipient.attemptsUsed,
          startAt: row.batch.startAt.toISOString(),
          endAt: row.batch.deadline.toISOString(),
          deadline: row.batch.deadline.toISOString(),
        }
      }
    } else if (test.visibility === 'assigned') {
      status = 'invalid'
    } else if (test.visibility === 'private' && test.organizationId !== auth.user.organizationId && auth.user.globalRole !== 'admin') {
      return Response.json({ error: 'You cannot access this test.' }, { status: 403 })
    }

    const joins = await db.select().from(testQuestions).where(eq(testQuestions.testId, test.id)).orderBy(asc(testQuestions.position))
    const loadedQuestions = await Promise.all(joins.map(async join => {
      const question = join.questionId
        ? (await db.select().from(questions).where(eq(questions.id, join.questionId)).limit(1))[0]
        : null
      const snapshot = (join.snapshot || {}) as Record<string, unknown>
      const promptImagePath = question?.promptImagePath || (typeof snapshot.promptImagePath === 'string' ? snapshot.promptImagePath : null)
      const optionImagePaths = question?.optionImagePaths || (Array.isArray(snapshot.optionImagePaths) ? snapshot.optionImagePaths as string[] : [])
      return {
        kind: question?.kind || snapshot.kind || 'mcq',
        prompt: question?.prompt || snapshot.prompt || '',
        options: question?.options || snapshot.options || [],
        marks: join.marks,
        format: question?.format || snapshot.format || 'plain',
        promptImageUrl: await signedImage(promptImagePath),
        optionImageUrls: await Promise.all(optionImagePaths.map(path => signedImage(path))),
      }
    }))
    return Response.json({
      status,
      test: {
        ...test,
        organisationId: test.organizationId,
        createdAt: test.createdAt.toISOString(),
        publishedAt: test.publishedAt?.toISOString() || null,
      },
      questions: loadedQuestions,
      assignment,
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load this test.')
  }
}
