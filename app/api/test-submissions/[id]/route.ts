import { z } from 'zod'
import { errorResponse, requireRole } from '@/lib/admin-api'
import { adminDb, FieldValue } from '@/lib/firebase-admin'
import { resolveSubmissionAccess } from '@/lib/submission-access'
import type { CanonicalQuestion } from '@/lib/submission-scoring'

export const runtime = 'nodejs'

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const GradeSchema = z.object({
  grades: z.array(z.object({
    questionIndex: z.number().int().min(0),
    awardedMarks: z.number().min(0),
    feedback: z.string().trim().max(4_000).default(''),
  })).max(50),
})

async function access(
  request: Request,
  id: string,
) {
  const auth = await requireRole(request, ['user', 'organisation', 'admin'])
  if (auth.error) return { error: auth.error } as const
  const [submissionSnapshot, gradingSnapshot] = await Promise.all([
    adminDb.collection('submissions').doc(id).get(),
    adminDb.collection('submissionGrading').doc(id).get(),
  ])
  const submission = submissionSnapshot.data()
  if (!submissionSnapshot.exists || !submission) {
    return { error: Response.json({ error: 'Submission not found.' }, { status: 404 }) } as const
  }
  const { reviewer, canView } = resolveSubmissionAccess(auth.user, submission)
  if (!canView) {
    return { error: Response.json({ error: 'You do not have access to this submission.' }, { status: 403 }) } as const
  }
  return {
    auth: auth.user,
    reviewer,
    submissionSnapshot,
    gradingSnapshot,
    submission,
    grading: gradingSnapshot.data(),
  } as const
}

function resultAnswers(
  submission: FirebaseFirestore.DocumentData,
  grading: FirebaseFirestore.DocumentData | undefined,
  revealSolutions: boolean,
  reviewer: boolean,
) {
  const questions = (grading?.questions || []) as CanonicalQuestion[]
  const grades = grading?.grades || {}
  return (submission.answers || []).map((answer: FirebaseFirestore.DocumentData, index: number) => {
    const question = questions[index]
    if (!question) return answer
    if (question.kind === 'short_answer') {
      const grade = grades[String(index)]
      return {
        ...answer,
        ...(grade ? { awardedMarks: grade.awardedMarks, feedback: grade.feedback } : {}),
        ...(revealSolutions ? {
          modelAnswer: question.modelAnswer,
          rubric: question.rubric,
          ...(reviewer ? { answerOrigin: question.answerOrigin } : {}),
        } : {}),
      }
    }
    return {
      ...answer,
      ...(revealSolutions ? {
        correctAnswer: question.correctOption,
        isCorrect: answer.selectedAnswer === question.correctOption,
        explanation: question.explanation,
        ...(reviewer ? { answerOrigin: question.answerOrigin } : {}),
      } : {}),
    }
  })
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = identifier.safeParse((await context.params).id)
    if (!parsed.success) return Response.json({ error: 'Invalid submission identifier.' }, { status: 400 })
    const resolved = await access(request, parsed.data)
    if ('error' in resolved) return resolved.error
    const revealSolutions = resolved.reviewer || resolved.submission.gradingStatus !== 'pending'
    return Response.json({
      submission: {
        ...resolved.submission,
        id: resolved.submissionSnapshot.id,
        submittedAt: resolved.submission.submittedAt?.toDate?.()?.toISOString?.() || null,
        answers: resultAnswers(resolved.submission, resolved.grading, revealSolutions, resolved.reviewer),
      },
      canGrade: resolved.reviewer && resolved.submission.gradingStatus === 'pending',
      revealSolutions,
    })
  } catch (error) {
    return errorResponse(error, 'Unable to retrieve the submission.')
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsedId = identifier.safeParse((await context.params).id)
    if (!parsedId.success) return Response.json({ error: 'Invalid submission identifier.' }, { status: 400 })
    const resolved = await access(request, parsedId.data)
    if ('error' in resolved) return resolved.error
    if (!resolved.reviewer) return Response.json({ error: 'Only the test-owning organisation or an administrator can grade this submission.' }, { status: 403 })
    if (!resolved.gradingSnapshot.exists || !resolved.grading) {
      return Response.json({ error: 'The private grading snapshot is missing.' }, { status: 409 })
    }
    const parsed = GradeSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'The grading payload is invalid.', issues: parsed.error.issues }, { status: 400 })

    const questions = (resolved.grading.questions || []) as CanonicalQuestion[]
    const shortIndexes = questions.flatMap((question, index) => question.kind === 'short_answer' ? [index] : [])
    const supplied = new Map(parsed.data.grades.map(grade => [grade.questionIndex, grade]))
    if (shortIndexes.length !== supplied.size || shortIndexes.some(index => !supplied.has(index))) {
      return Response.json({ error: 'Awarded marks are required for every short-answer question.' }, { status: 400 })
    }
    for (const index of shortIndexes) {
      const grade = supplied.get(index)!
      if (grade.awardedMarks > questions[index].marks) {
        return Response.json({ error: `Question ${index + 1} cannot receive more than ${questions[index].marks} marks.` }, { status: 400 })
      }
    }
    const grades = Object.fromEntries([...supplied].map(([index, grade]) => [String(index), grade]))
    const awarded = parsed.data.grades.reduce((sum, grade) => sum + grade.awardedMarks, 0)
    const finalScore = Number(resolved.submission.mcqScore || 0) + awarded
    const publicAnswers = (resolved.submission.answers || []).map((answer: FirebaseFirestore.DocumentData, index: number) => {
      const grade = supplied.get(index)
      return grade ? { ...answer, awardedMarks: grade.awardedMarks, feedback: grade.feedback, gradingStatus: 'graded' } : answer
    })

    await adminDb.runTransaction(async transaction => {
      const latest = await transaction.get(resolved.submissionSnapshot.ref)
      if (!latest.exists) throw new Error('The submission was removed.')
      transaction.update(resolved.gradingSnapshot.ref, {
        grades,
        reviewerId: resolved.auth.uid,
        reviewerName: resolved.auth.name,
        gradedAt: FieldValue.serverTimestamp(),
      })
      transaction.update(resolved.submissionSnapshot.ref, {
        answers: publicAnswers,
        gradingStatus: 'graded',
        pendingMarks: 0,
        score: finalScore,
        gradedBy: resolved.auth.uid,
        gradedByName: resolved.auth.name,
        gradedAt: FieldValue.serverTimestamp(),
      })
    })

    const organisationIds = Array.isArray(resolved.submission.organisationIds) ? resolved.submission.organisationIds : []
    if (organisationIds.length) {
      const batch = adminDb.batch()
      organisationIds.forEach((organisationId: string) => {
        batch.update(adminDb.collection('organisationSubmissions').doc(`${parsedId.data}_${organisationId}`), {
          answers: publicAnswers,
          gradingStatus: 'graded',
          pendingMarks: 0,
          score: finalScore,
          gradedBy: resolved.auth.uid,
          gradedByName: resolved.auth.name,
          gradedAt: FieldValue.serverTimestamp(),
        })
      })
      await batch.commit()
    }
    return Response.json({ gradingStatus: 'graded', score: finalScore, totalMarks: resolved.submission.totalMarks })
  } catch (error) {
    return errorResponse(error, 'Unable to grade the submission.')
  }
}
