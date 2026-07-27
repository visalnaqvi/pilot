import { z } from 'zod'
import { assignmentInstanceId, selectAssignmentInstance } from '@/lib/assignment-instance'
import { errorResponse, requireRole } from '@/lib/admin-api'
import { adminDb } from '@/lib/firebase-admin'

export const runtime = 'nodejs'

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)

type Candidate = {
  assignmentBatchId: string
  assignmentName: string
  linkedTaskId?: string
  testId: string
  testTitle: string
  userId: string
  userEmail: string
  assignedBy: string
  startAt: Date
  deadline: Date
  attemptsUsed: number
  maxAttempts: number
  createdAt?: FirebaseFirestore.Timestamp
}

function windowStatus(candidate: Candidate, now = Date.now()) {
  if (candidate.startAt.getTime() > now) return 'not_started' as const
  if (candidate.deadline.getTime() < now) return 'ended' as const
  if (candidate.attemptsUsed >= candidate.maxAttempts) return 'attempts_exhausted' as const
  return 'open' as const
}

async function submissionCount(testId: string, userId: string, assignmentBatchId: string, maxAttempts: number) {
  const references = Array.from({ length: maxAttempts }, (_, index) => (
    adminDb.collection('submissions').doc(`${testId}_${userId}_${assignmentBatchId}_${index + 1}`)
  ))
  if (!references.length) return 0
  return (await adminDb.getAll(...references)).filter(snapshot => snapshot.exists).length
}

async function loadCandidate(
  snapshot: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot,
  user: { uid: string; email: string | null },
) {
  if (!snapshot.exists) return null
  const data = snapshot.data()
  if (!data
    || data.testId == null
    || !Array.isArray(data.assignedUserIds)
    || !data.assignedUserIds.includes(user.uid)
    || !data.startAt?.toDate
    || !(data.deadline?.toDate || data.endAt?.toDate)) return null

  const assignmentBatchId = snapshot.id
  const reference = adminDb.collection('testAssignments').doc(assignmentInstanceId(assignmentBatchId, user.uid))
  const existing = await reference.get()
  const maxAttempts = Number(data.maxAttempts) > 0 ? Number(data.maxAttempts) : 1
  const attemptsUsed = existing.exists
    ? Number(existing.data()?.attemptsUsed) || 0
    : await submissionCount(String(data.testId), user.uid, assignmentBatchId, maxAttempts)
  const deadline = (data.deadline || data.endAt).toDate()
  const candidate: Candidate = {
    assignmentBatchId,
    assignmentName: String(data.name || data.testTitle || 'Assignment'),
    linkedTaskId: typeof data.linkedTaskId === 'string' ? data.linkedTaskId : undefined,
    testId: String(data.testId),
    testTitle: String(data.testTitle || 'Assigned test'),
    userId: user.uid,
    userEmail: user.email || '',
    assignedBy: String(data.assignedBy || ''),
    startAt: data.startAt.toDate(),
    deadline,
    attemptsUsed,
    maxAttempts,
    createdAt: data.createdAt,
  }

  if (!existing.exists) {
    await reference.set({
      testId: candidate.testId,
      testTitle: candidate.testTitle,
      userId: candidate.userId,
      userEmail: candidate.userEmail,
      assignedBy: candidate.assignedBy,
      assignmentBatchId,
      assignmentName: candidate.assignmentName,
      ...(candidate.linkedTaskId ? { linkedTaskId: candidate.linkedTaskId } : {}),
      maxAttempts,
      attemptsUsed,
      startAt: data.startAt,
      deadline: data.deadline || data.endAt,
      endAt: data.deadline || data.endAt,
      ...(data.createdAt ? { createdAt: data.createdAt } : {}),
    })
  }
  return candidate
}

async function resolveAssignment(
  testId: string,
  requestedBatchId: string | null,
  user: { uid: string; email: string | null },
) {
  if (requestedBatchId) {
    const requested = await adminDb.collection('assignmentBatches').doc(requestedBatchId).get()
    const candidate = await loadCandidate(requested, user)
    return candidate?.testId === testId ? candidate : null
  }

  const batches = await adminDb.collection('assignmentBatches').where('testId', '==', testId).get()
  const candidates = (await Promise.all(batches.docs.map(batch => loadCandidate(batch, user))))
    .filter((candidate): candidate is Candidate => candidate !== null)
  return selectAssignmentInstance(candidates)
}

async function loadQuestions(testId: string, testData: FirebaseFirestore.DocumentData) {
  if (Array.isArray(testData.questions)) return testData.questions
  const memberships = await adminDb.collection('tests').doc(testId).collection('questions').orderBy('position').get()
  const sources = await Promise.all(memberships.docs.map(membership => {
    const questionId = membership.data().questionId
    return typeof questionId === 'string'
      ? adminDb.collection('questions').doc(questionId).get()
      : Promise.resolve(null)
  }))
  return memberships.docs.flatMap((membership, index) => {
    const membershipData = membership.data()
    const content = sources[index]?.data() || membershipData.snapshot
    if (!content) return []
    return [{
      prompt: content.prompt,
      options: content.options,
      correctAnswer: content.correctAnswer,
      promptImageUrl: content.promptImageUrl,
      optionImageUrls: content.optionImageUrls,
      format: content.format,
      marks: membershipData.marks,
    }]
  })
}

function serializeTest(id: string, data: FirebaseFirestore.DocumentData) {
  return {
    id,
    title: data.title,
    exam: data.exam,
    examId: data.examId,
    examAlias: data.examAlias,
    category: data.category,
    categoryId: data.categoryId,
    description: data.description,
    durationMinutes: data.durationMinutes,
    questionCount: data.questionCount,
    totalMarks: data.totalMarks,
    createdBy: data.createdBy,
    visibility: data.visibility,
    attemptLimit: data.attemptLimit,
    published: data.published,
    organisationId: data.organisationId,
  }
}

export async function GET(request: Request) {
  const auth = await requireRole(request, ['user', 'organisation', 'admin'])
  if ('error' in auth) return auth.error
  try {
    const url = new URL(request.url)
    if (url.searchParams.get('list') === 'assignments') {
      if (auth.user.role !== 'user') return Response.json({ assignments: [] })
      const batches = await adminDb.collection('assignmentBatches')
        .where('assignedUserIds', 'array-contains', auth.user.uid)
        .get()
      const assignments = (await Promise.all(batches.docs.map(batch => loadCandidate(batch, auth.user))))
        .filter((candidate): candidate is Candidate => candidate !== null)
        .map(candidate => ({
          id: assignmentInstanceId(candidate.assignmentBatchId, auth.user.uid),
          assignmentBatchId: candidate.assignmentBatchId,
          assignmentName: candidate.assignmentName,
          linkedTaskId: candidate.linkedTaskId,
          testId: candidate.testId,
          testTitle: candidate.testTitle,
          startAt: candidate.startAt.toISOString(),
          deadline: candidate.deadline.toISOString(),
          endAt: candidate.deadline.toISOString(),
          attemptsUsed: candidate.attemptsUsed,
          maxAttempts: candidate.maxAttempts,
          status: windowStatus(candidate),
        }))
      return Response.json({ assignments })
    }
    const parsedTestId = identifier.safeParse(url.searchParams.get('testId'))
    const requestedAssignment = url.searchParams.get('assignment')
    const parsedAssignment = requestedAssignment ? identifier.safeParse(requestedAssignment) : null
    if (!parsedTestId.success || (parsedAssignment && !parsedAssignment.success)) {
      return Response.json({ error: 'Invalid test or assignment identifier.' }, { status: 400 })
    }

    const testId = parsedTestId.data
    const testSnapshot = await adminDb.collection('tests').doc(testId).get()
    const testData = testSnapshot.data()
    if (!testSnapshot.exists || !testData || testData.deletedAt != null || testData.published === false) {
      return Response.json({ error: 'This test is unavailable.' }, { status: 404 })
    }

    let assignment: Candidate | null = null
    if (testData.visibility === 'assigned') {
      if (auth.user.role === 'user') {
        assignment = await resolveAssignment(testId, parsedAssignment?.data || null, auth.user)
        if (!assignment) {
          return Response.json({ error: 'This test is not assigned to you.' }, { status: 403 })
        }
        const status = windowStatus(assignment)
        const serializedAssignment = {
          id: assignmentInstanceId(assignment.assignmentBatchId, auth.user.uid),
          assignmentBatchId: assignment.assignmentBatchId,
          assignmentName: assignment.assignmentName,
          linkedTaskId: assignment.linkedTaskId,
          startAt: assignment.startAt.toISOString(),
          deadline: assignment.deadline.toISOString(),
          endAt: assignment.deadline.toISOString(),
          attemptsUsed: assignment.attemptsUsed,
          maxAttempts: assignment.maxAttempts,
        }
        if (status !== 'open') {
          return Response.json({ status, assignment: serializedAssignment })
        }
        const questions = await loadQuestions(testId, testData)
        return Response.json({
          status,
          assignment: serializedAssignment,
          test: serializeTest(testId, testData),
          questions,
        })
      }
      if (auth.user.role !== 'admin' && testData.createdBy !== auth.user.uid) {
        return Response.json({ error: 'You do not have access to this test.' }, { status: 403 })
      }
    } else if (testData.visibility === 'private') {
      const managesTest = auth.user.role === 'admin' || testData.createdBy === auth.user.uid
      const organisationId = String(testData.organisationId || '')
      const membership = organisationId
        ? await adminDb.collection('organisationInvites').doc(`${organisationId}_${auth.user.uid}`).get()
        : null
      if (!managesTest && membership?.data()?.status !== 'accepted') {
        return Response.json({ error: 'You do not have access to this test.' }, { status: 403 })
      }
    }

    return Response.json({
      status: 'open',
      assignment,
      test: serializeTest(testId, testData),
      questions: await loadQuestions(testId, testData),
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load the test session.')
  }
}
