import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  assignmentBatches,
  assignmentRecipients,
  categories,
  exams,
  organizationMemberships,
  questionKeys,
  questions,
  submissionAnswers,
  submissionOrganizationAccess,
  taskActivity,
  taskAssignees,
  tasks,
  testAttemptCounters,
  testQuestions,
  testSubmissions,
  tests,
  users,
} from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'

const submissionSchema = z.object({
  testId: z.string().uuid(),
  assignmentBatchId: z.string().uuid().optional(),
  answers: z.array(z.union([z.number().int(), z.string().max(20_000), z.null()])),
  autoSubmitted: z.boolean().default(false),
  autoSubmitReason: z.enum(['time_expired', 'fullscreen_exited']).optional(),
})

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const db = database()
    let rows
    if (auth.user.globalRole === 'admin') {
      rows = await db.select().from(testSubmissions).orderBy(desc(testSubmissions.submittedAt))
    } else if (auth.user.organizationId && ['owner', 'teacher'].includes(auth.user.membershipRole || '')) {
      rows = await db.select({
        submission: testSubmissions,
      }).from(submissionOrganizationAccess)
        .innerJoin(testSubmissions, eq(testSubmissions.id, submissionOrganizationAccess.submissionId))
        .where(eq(submissionOrganizationAccess.organizationId, auth.user.organizationId))
        .orderBy(desc(testSubmissions.submittedAt))
        .then(result => result.map(item => item.submission))
    } else {
      rows = await db.select().from(testSubmissions)
        .where(eq(testSubmissions.userId, auth.user.uid))
        .orderBy(desc(testSubmissions.submittedAt))
    }
    const userIds = [...new Set(rows.map(item => item.userId))]
    const people = userIds.length ? await db.select().from(users).where(inArray(users.id, userIds)) : []
    const submissionIds = rows.map(item => item.id)
    const organizationAccess = submissionIds.length
      ? await db.select().from(submissionOrganizationAccess).where(inArray(submissionOrganizationAccess.submissionId, submissionIds))
      : []
    return Response.json({
      items: rows.map(item => ({
        id: item.id,
        userId: item.userId,
        userEmail: people.find(person => person.id === item.userId)?.email || '',
        userName: people.find(person => person.id === item.userId)?.name || '',
        testId: item.testId,
        testTitle: item.testTitle,
        testExam: item.examName,
        testCategory: item.categoryName,
        testVisibility: item.visibility,
        score: item.score || 0,
        gradingStatus: item.gradingStatus,
        mcqScore: item.mcqScore,
        mcqMarks: item.mcqMarks,
        pendingMarks: item.pendingMarks,
        totalMarks: item.totalMarks,
        correctAnswers: item.correctAnswers,
        questionCount: item.questionCount,
        attemptNumber: item.attemptNumber,
        assignmentBatchId: item.assignmentBatchId,
        organizationIds: organizationAccess.filter(access => access.submissionId === item.id).map(access => access.organizationId),
        autoSubmitted: item.autoSubmitted,
        autoSubmitReason: item.autoSubmitReason,
        submittedAt: item.submittedAt.toISOString(),
      })),
      nextCursor: null,
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load submissions.')
  }
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const parsed = submissionSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid submission.', issues: parsed.error.issues }, { status: 400 })
    const db = database()
    const submissionId = await db.transaction(async tx => {
      const test = (await tx.select().from(tests).where(and(eq(tests.id, parsed.data.testId), eq(tests.published, true))).limit(1))[0]
      if (!test || test.deletedAt) throw new Error('Test not found.')
      if (test.visibility === 'assigned' && !parsed.data.assignmentBatchId) throw new Error('This test must be opened from an assignment.')
      if (test.visibility === 'private'
        && test.organizationId !== auth.user.organizationId
        && auth.user.globalRole !== 'admin') {
        throw new Error('You cannot submit this private test.')
      }
      let attemptNumber = 1
      let assignment: typeof assignmentBatches.$inferSelect | null = null
      if (parsed.data.assignmentBatchId) {
        await tx.execute(sql`select 1 from assignment_recipients where assignment_batch_id = ${parsed.data.assignmentBatchId} and user_id = ${auth.user.uid} for update`)
        assignment = (await tx.select().from(assignmentBatches).where(eq(assignmentBatches.id, parsed.data.assignmentBatchId)).limit(1))[0] || null
        const recipient = (await tx.select().from(assignmentRecipients).where(and(
          eq(assignmentRecipients.assignmentBatchId, parsed.data.assignmentBatchId),
          eq(assignmentRecipients.userId, auth.user.uid),
        )).limit(1))[0]
        if (!assignment || assignment.testId !== test.id || !recipient) throw new Error('Assignment not found.')
        const now = new Date()
        if (now < assignment.startAt || now > assignment.deadline) throw new Error('This assignment is not open.')
        if (recipient.attemptsUsed >= assignment.maxAttempts) throw new Error('No attempts remain for this assignment.')
        attemptNumber = recipient.attemptsUsed + 1
        await tx.update(assignmentRecipients).set({ attemptsUsed: attemptNumber }).where(and(
          eq(assignmentRecipients.assignmentBatchId, assignment.id),
          eq(assignmentRecipients.userId, auth.user.uid),
        ))
      } else {
        const scope = 'standard'
        await tx.insert(testAttemptCounters).values({
          testId: test.id,
          userId: auth.user.uid,
          scope,
          count: 1,
        }).onConflictDoUpdate({
          target: [testAttemptCounters.testId, testAttemptCounters.userId, testAttemptCounters.scope],
          set: { count: sql`${testAttemptCounters.count} + 1`, updatedAt: new Date() },
        })
        const counter = (await tx.select().from(testAttemptCounters).where(and(
          eq(testAttemptCounters.testId, test.id),
          eq(testAttemptCounters.userId, auth.user.uid),
          eq(testAttemptCounters.scope, scope),
        )).limit(1))[0]
        attemptNumber = counter.count
      }

      const joins = await tx.select().from(testQuestions).where(eq(testQuestions.testId, test.id)).orderBy(testQuestions.position)
      if (parsed.data.answers.length !== joins.length) throw new Error('Every test question must have an answer slot.')
      const questionIds = joins.flatMap(join => join.questionId ? [join.questionId] : [])
      const questionRows = questionIds.length ? await tx.select().from(questions).where(inArray(questions.id, questionIds)) : []
      const keys = questionIds.length ? await tx.select().from(questionKeys).where(inArray(questionKeys.questionId, questionIds)) : []
      const exam = (await tx.select().from(exams).where(eq(exams.id, test.examId)).limit(1))[0]
      const category = (await tx.select().from(categories).where(eq(categories.id, test.categoryId)).limit(1))[0]
      let mcqScore = 0
      let mcqMarks = 0
      let pendingMarks = 0
      let correctAnswers = 0
      const answerRows = joins.map((join, index) => {
        const question = questionRows.find(item => item.id === join.questionId)
        const key = keys.find(item => item.questionId === join.questionId)
        const snapshot = (join.snapshot || {}) as Record<string, unknown>
        const kind = question?.kind || snapshot.kind || 'mcq'
        const response = parsed.data.answers[index]
        const correct = kind === 'mcq' && typeof response === 'number' && response === key?.correctAnswer
        if (kind === 'mcq') {
          mcqMarks += join.marks
          if (correct) { mcqScore += join.marks; correctAnswers += 1 }
        } else {
          pendingMarks += join.marks
        }
        return {
          questionIndex: index,
          questionSnapshot: {
            kind,
            prompt: question?.prompt || snapshot.prompt || '',
            options: question?.options || snapshot.options || [],
            marks: join.marks,
            modelAnswer: key?.modelAnswer,
            rubric: key?.rubric,
            explanation: key?.explanation,
          },
          response,
          correctAnswer: kind === 'mcq' ? key?.correctAnswer : null,
          awardedMarks: kind === 'mcq' ? (correct ? join.marks : 0) : null,
          gradingStatus: kind === 'mcq' ? 'not_required' as const : 'pending' as const,
        }
      })
      const gradingStatus = pendingMarks ? 'pending' as const : 'not_required' as const
      const [submission] = await tx.insert(testSubmissions).values({
        testId: test.id,
        userId: auth.user.uid,
        assignmentBatchId: assignment?.id,
        attemptNumber,
        testTitle: test.title,
        examName: exam?.name,
        categoryName: category?.name || 'General',
        visibility: test.visibility,
        gradingStatus,
        score: pendingMarks ? mcqScore : mcqScore,
        mcqScore,
        mcqMarks,
        pendingMarks,
        totalMarks: test.totalMarks,
        correctAnswers,
        questionCount: joins.length,
        autoSubmitted: parsed.data.autoSubmitted,
        autoSubmitReason: parsed.data.autoSubmitReason,
      }).returning()
      await tx.insert(submissionAnswers).values(answerRows.map(answer => ({ ...answer, submissionId: submission.id })))

      const access = new Set<string>()
      if (test.organizationId) access.add(test.organizationId)
      if (assignment?.organizationId) access.add(assignment.organizationId)
      const memberships = await tx.select().from(organizationMemberships).where(and(
        eq(organizationMemberships.userId, auth.user.uid),
        eq(organizationMemberships.status, 'accepted'),
      ))
      memberships.forEach(item => access.add(item.organizationId))
      if (access.size) await tx.insert(submissionOrganizationAccess).values([...access].map(organizationId => ({ submissionId: submission.id, organizationId })))

      if (assignment) {
        const linkedTask = (await tx.select().from(tasks).where(eq(tasks.assignmentBatchId, assignment.id)).limit(1))[0]
        if (linkedTask) {
          await tx.update(taskAssignees).set({ status: 'done', updatedBy: auth.user.uid, updatedAt: new Date() }).where(and(
            eq(taskAssignees.taskId, linkedTask.id),
            eq(taskAssignees.userId, auth.user.uid),
          ))
          await tx.insert(taskActivity).values({
            taskId: linkedTask.id,
            subjectUserId: auth.user.uid,
            actorUserId: auth.user.uid,
            type: 'assignment_submitted',
            data: { submissionId: submission.id },
          })
        }
      }
      return submission.id
    })
    return Response.json({ id: submissionId }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to submit test.'
    const conflict = /attempt|open|assignment/i.test(message)
    return conflict ? Response.json({ error: message }, { status: 409 }) : errorResponse(error, 'Unable to submit test.')
  }
}
