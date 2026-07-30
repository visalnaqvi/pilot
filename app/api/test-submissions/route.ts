import { errorResponse, requireRole } from '@/lib/admin-api'
import { adminDb, FieldValue } from '@/lib/firebase-admin'
import { type CanonicalQuestion, questionSnapshot, scoreResponses, SubmitTestSchema } from '@/lib/submission-scoring'
import { isTeacherForOrganisation } from '@/lib/teacher-access'

export const runtime = 'nodejs'

function submissionSummary(snapshot: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    userId: data.userId,
    userEmail: data.userEmail,
    userName: data.userName,
    testId: data.testId,
    testTitle: data.testTitle,
    testExam: data.testExam,
    testExamId: data.testExamId,
    testCategory: data.testCategory,
    score: data.score,
    gradingStatus: data.gradingStatus,
    mcqScore: data.mcqScore,
    mcqMarks: data.mcqMarks,
    pendingMarks: data.pendingMarks,
    totalMarks: data.totalMarks,
    correctAnswers: data.correctAnswers,
    questionCount: data.questionCount,
    organisationIds: data.organisationIds,
    autoSubmitted: data.autoSubmitted,
    autoSubmitReason: data.autoSubmitReason,
    testVisibility: data.testVisibility,
    attemptNumber: data.attemptNumber,
    assignmentBatchId: data.assignmentBatchId,
    submittedAt: data.submittedAt?.toDate?.()?.toISOString?.() || null,
  }
}

export async function GET(request: Request) {
  const auth = await requireRole(request, ['user', 'organisation', 'admin'])
  if ('error' in auth) return auth.error
  try {
    const testId = new URL(request.url).searchParams.get('testId')?.trim() || ''
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(testId)) {
      return Response.json({ error: 'A valid test is required.' }, { status: 400 })
    }
    const testSnapshot = await adminDb.collection('tests').doc(testId).get()
    const test = testSnapshot.data()
    if (!testSnapshot.exists || !test || test.deletedAt != null) {
      return Response.json({ error: 'Test not found.' }, { status: 404 })
    }
    const organisationId = String(test.organisationId || '')
    let scope: 'all' | 'institute' | 'self' = 'self'
    if (auth.user.role === 'admin') {
      scope = 'all'
    } else if (auth.user.role === 'organisation' && organisationId === auth.user.uid) {
      scope = 'institute'
    } else if (auth.user.role === 'user' && organisationId
      && await isTeacherForOrganisation(auth.user.uid, organisationId)) {
      scope = 'institute'
    }
    const snapshot = await adminDb.collection('submissions').where('testId', '==', testId).get()
    const submissions = snapshot.docs
      .filter(document => document.data().gradingStatus !== 'pending')
      .filter(document => {
        if (scope === 'all') return true
        if (scope === 'self') return document.data().userId === auth.user.uid
        return Array.isArray(document.data().organisationIds)
          && document.data().organisationIds.includes(organisationId)
      })
      .map(submissionSummary)
    return Response.json({ submissions, scope })
  } catch (error) {
    return errorResponse(error, 'Unable to load test submissions.')
  }
}

async function loadCanonicalQuestions(testId: string, test: FirebaseFirestore.DocumentData) {
  if (Array.isArray(test.questions)) {
    return test.questions.map((question: FirebaseFirestore.DocumentData, index: number): CanonicalQuestion => ({
      id: `legacy-${index}`,
      kind: question.kind === 'short_answer' ? 'short_answer' : 'mcq',
      prompt: String(question.prompt || ''),
      options: Array.isArray(question.options) ? question.options.map(String) : undefined,
      correctOption: Number.isInteger(question.correctAnswer) ? question.correctAnswer : undefined,
      explanation: typeof question.explanation === 'string' ? question.explanation : undefined,
      modelAnswer: typeof question.modelAnswer === 'string' ? question.modelAnswer : undefined,
      rubric: Array.isArray(question.rubric) ? question.rubric : undefined,
      marks: Number(question.marks) || 1,
      answerOrigin: question.answerOrigin,
    }))
  }

  const memberships = await adminDb.collection('tests').doc(testId).collection('questions').orderBy('position').get()
  const questionIds = memberships.docs.map(item => String(item.data().questionId || '')).filter(Boolean)
  const [questions, keys] = await Promise.all([
    questionIds.length ? adminDb.getAll(...questionIds.map(id => adminDb.collection('questions').doc(id))) : [],
    questionIds.length ? adminDb.getAll(...questionIds.map(id => adminDb.collection('questionKeys').doc(id))) : [],
  ])
  return memberships.docs.flatMap((membership, index) => {
    const membershipData = membership.data()
    const source = questions[index]?.data() || membershipData.snapshot
    if (!source) return []
    const key = keys[index]?.data() || source
    const isShort = source.kind === 'short_answer' || key.kind === 'short_answer'
    return [{
      id: questionIds[index] || membership.id,
      kind: isShort ? 'short_answer' as const : 'mcq' as const,
      prompt: String(source.prompt || ''),
      options: isShort ? undefined : Array.isArray(source.options) ? source.options.map(String) : [],
      correctOption: isShort ? undefined : Number.isInteger(key.correctAnswer) ? key.correctAnswer : undefined,
      explanation: typeof key.explanation === 'string' ? key.explanation : undefined,
      modelAnswer: typeof key.modelAnswer === 'string' ? key.modelAnswer : undefined,
      rubric: Array.isArray(key.rubric) ? key.rubric : undefined,
      marks: Number(membershipData.marks) || Number(source.marks) || 1,
      answerOrigin: key.answerOrigin,
    }]
  })
}

async function organisationIdsFor(userId: string) {
  const invites = await adminDb.collection('organisationInvites')
    .where('userId', '==', userId)
    .where('status', '==', 'accepted')
    .get()
  return [...new Set(invites.docs.map(item => String(item.data().organisationId || '')).filter(Boolean))]
}

async function canOpenPrivate(test: FirebaseFirestore.DocumentData, user: { uid: string; role: string }) {
  if (user.role === 'admin' || test.createdBy === user.uid) return true
  const organisationId = String(test.organisationId || '')
  if (!organisationId) return false
  const invite = await adminDb.collection('organisationInvites').doc(`${organisationId}_${user.uid}`).get()
  return invite.data()?.status === 'accepted'
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ['user', 'organisation', 'admin'])
  if ('error' in auth) return auth.error
  try {
    const parsed = SubmitTestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: 'The submission payload is invalid.', issues: parsed.error.issues }, { status: 400 })
    }
    const input = parsed.data
    const testSnapshot = await adminDb.collection('tests').doc(input.testId).get()
    const test = testSnapshot.data()
    if (!testSnapshot.exists || !test || test.deletedAt != null || test.published === false) {
      return Response.json({ error: 'This test is unavailable.' }, { status: 404 })
    }
    if (test.visibility === 'private' && !await canOpenPrivate(test, auth.user)) {
      return Response.json({ error: 'You do not have access to this test.' }, { status: 403 })
    }

    const questions = await loadCanonicalQuestions(input.testId, test)
    if (!questions.length || questions.some(question => question.kind === 'mcq' && question.correctOption == null)) {
      return Response.json({ error: 'This test does not have a complete server-side answer key.' }, { status: 409 })
    }
    const duplicateIndexes = new Set<number>()
    for (const response of input.responses) {
      if (response.questionIndex >= questions.length || duplicateIndexes.has(response.questionIndex)) {
        return Response.json({ error: 'The response list contains an invalid or duplicate question.' }, { status: 400 })
      }
      duplicateIndexes.add(response.questionIndex)
    }

    const memberOrganisationIds = await organisationIdsFor(auth.user.uid)
    const gradingOwnerId = String(test.organisationId || test.createdBy || '')
    const organisationIds = [...new Set([...memberOrganisationIds, gradingOwnerId].filter(Boolean))]
    const scored = scoreResponses(questions, input.responses)
    const totalMarks = questions.reduce((sum, question) => sum + question.marks, 0)
    const now = new Date()
    let assignmentRef: FirebaseFirestore.DocumentReference | null = null
    let assignmentData: FirebaseFirestore.DocumentData | null = null
    if (test.visibility === 'assigned') {
      if (!input.assignmentBatchId) return Response.json({ error: 'Assignment information is required.' }, { status: 400 })
      assignmentRef = adminDb.collection('testAssignments').doc(`${input.assignmentBatchId}_${auth.user.uid}`)
      const assignmentSnapshot = await assignmentRef.get()
      assignmentData = assignmentSnapshot.data() || null
      if (!assignmentSnapshot.exists || assignmentData?.testId !== input.testId || assignmentData?.userId !== auth.user.uid) {
        return Response.json({ error: 'This test is not assigned to you.' }, { status: 403 })
      }
    }

    const submissionRef = adminDb.collection('submissions').doc()
    const gradingRef = adminDb.collection('submissionGrading').doc(submissionRef.id)
    let finalAttemptNumber = 1

    await adminDb.runTransaction(async transaction => {
      if (assignmentRef) {
        const current = await transaction.get(assignmentRef)
        const data = current.data()
        if (!current.exists || !data) throw new Error('This assignment is no longer available.')
        const start = data.startAt?.toDate?.()
        const end = (data.deadline || data.endAt)?.toDate?.()
        const grace = input.autoSubmitReason ? 60_000 : 0
        if (start && now < start) throw new Error(`This assignment opens on ${start.toLocaleString()}.`)
        if (end && now.getTime() > end.getTime() + grace) throw new Error('The assignment ended before your submission could be saved.')
        const attemptsUsed = Number(data.attemptsUsed) || 0
        const maxAttempts = Number(data.maxAttempts) || 1
        if (attemptsUsed >= maxAttempts) throw new Error(`You have used all ${maxAttempts} attempts allowed for this assignment.`)
        finalAttemptNumber = attemptsUsed + 1

        if (data.linkedTaskId && (!end || now <= end)) {
          const taskRef = adminDb.collection('tasks').doc(String(data.linkedTaskId))
          const assigneeRef = taskRef.collection('assignees').doc(auth.user.uid)
          const task = await transaction.get(taskRef)
          const taskData = task.data()
          if (task.exists && taskData && !taskData.isClosed && taskData.sourceType === 'assignment'
            && taskData.linkedAssignmentBatchId === input.assignmentBatchId
            && Array.isArray(taskData.assignedUserIds) && taskData.assignedUserIds.includes(auth.user.uid)) {
            transaction.set(assigneeRef, {
              userId: auth.user.uid,
              userName: auth.user.name,
              userEmail: auth.user.email || '',
              status: 'done',
              updatedAt: FieldValue.serverTimestamp(),
              updatedBy: auth.user.uid,
              updatedByName: auth.user.name,
            }, { merge: true })
            transaction.update(taskRef, {
              updatedAt: FieldValue.serverTimestamp(),
              lastStatusAt: FieldValue.serverTimestamp(),
              lastStatus: 'done',
              lastStatusUserId: auth.user.uid,
              lastStatusUserName: auth.user.name,
              lastStatusUpdatedBy: auth.user.uid,
              lastStatusUpdatedByName: auth.user.name,
            })
          }
        }
        transaction.update(assignmentRef, { attemptsUsed: finalAttemptNumber })
      } else {
        const counterRef = adminDb.collection('testAttemptCounters').doc(`${input.testId}_${auth.user.uid}_${test.visibility}`)
        const counter = await transaction.get(counterRef)
        finalAttemptNumber = Number(counter.data()?.count || 0) + 1
        transaction.set(counterRef, {
          testId: input.testId,
          userId: auth.user.uid,
          visibility: test.visibility,
          count: finalAttemptNumber,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }

      const submission = {
        userId: auth.user.uid,
        userName: auth.user.name,
        userEmail: auth.user.email || '',
        testId: input.testId,
        testTitle: String(test.title || 'Mock test'),
        ...(test.exam ? { testExam: test.exam } : {}),
        ...(test.examId ? { testExamId: test.examId } : {}),
        testCategory: String(test.category || 'Uncategorised'),
        testVisibility: test.visibility,
        score: scored.score ?? scored.mcqScore,
        mcqScore: scored.mcqScore,
        mcqMarks: scored.mcqMarks,
        pendingMarks: scored.pendingMarks,
        gradingStatus: scored.gradingStatus,
        totalMarks,
        correctAnswers: scored.correctAnswers,
        questionCount: questions.length,
        answers: scored.publicAnswers,
        organisationIds,
        gradingOwnerId,
        attemptNumber: finalAttemptNumber,
        ...(input.assignmentBatchId ? { assignmentBatchId: input.assignmentBatchId } : {}),
        autoSubmitted: Boolean(input.autoSubmitReason),
        ...(input.autoSubmitReason ? { autoSubmitReason: input.autoSubmitReason } : {}),
        submittedAt: FieldValue.serverTimestamp(),
      }
      transaction.create(submissionRef, submission)
      transaction.create(gradingRef, {
        submissionId: submissionRef.id,
        testId: input.testId,
        testOwnerId: gradingOwnerId,
        learnerId: auth.user.uid,
        questions: questions.map(questionSnapshot),
        responses: input.responses,
        grades: {},
        createdAt: FieldValue.serverTimestamp(),
      })
      organisationIds.forEach(organisationId => {
        transaction.set(adminDb.collection('organisationSubmissions').doc(`${submissionRef.id}_${organisationId}`), {
          ...submission,
          organisationId,
        })
      })
    })

    return Response.json({
      submissionId: submissionRef.id,
      gradingStatus: scored.gradingStatus,
      mcqScore: scored.mcqScore,
      mcqMarks: scored.mcqMarks,
      pendingMarks: scored.pendingMarks,
      score: scored.score,
      totalMarks,
    }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'Unable to save the test submission.')
  }
}
