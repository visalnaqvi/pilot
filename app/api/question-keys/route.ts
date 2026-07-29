import { z } from 'zod'
import { errorResponse, requireRole } from '@/lib/admin-api'
import { adminDb, FieldValue } from '@/lib/firebase-admin'

export const runtime = 'nodejs'

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const ReadSchema = z.object({ questionIds: z.array(identifier).min(1).max(50) })
const WriteSchema = z.object({
  keys: z.array(z.object({
    questionId: identifier,
    kind: z.literal('mcq'),
    correctAnswer: z.number().int().min(0).max(3),
    explanation: z.string().trim().max(10_000).optional(),
  })).min(1).max(50),
})

async function authorizedQuestions(questionIds: string[], user: { uid: string; role: string }) {
  const snapshots = await adminDb.getAll(...questionIds.map(id => adminDb.collection('questions').doc(id)))
  const allowed = snapshots.every(snapshot => {
    const data = snapshot.data()
    return snapshot.exists && data && (user.role === 'admin' || data.createdBy === user.uid || data.organisationId === user.uid)
  })
  return { snapshots, allowed }
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ['organisation', 'admin'])
  if ('error' in auth) return auth.error
  try {
    const parsed = ReadSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid question list.' }, { status: 400 })
    const authorized = await authorizedQuestions(parsed.data.questionIds, auth.user)
    if (!authorized.allowed) return Response.json({ error: 'You cannot read one or more answer keys.' }, { status: 403 })
    const keys = await adminDb.getAll(...parsed.data.questionIds.map(id => adminDb.collection('questionKeys').doc(id)))
    return Response.json({
      keys: Object.fromEntries(keys.flatMap((key, index) => key.exists ? [[parsed.data.questionIds[index], key.data()]] : [])),
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load answer keys.')
  }
}

export async function PUT(request: Request) {
  const auth = await requireRole(request, ['organisation', 'admin'])
  if ('error' in auth) return auth.error
  try {
    const parsed = WriteSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid answer-key payload.', issues: parsed.error.issues }, { status: 400 })
    const ids = parsed.data.keys.map(key => key.questionId)
    if (new Set(ids).size !== ids.length) return Response.json({ error: 'Duplicate question keys are not allowed.' }, { status: 400 })
    const authorized = await authorizedQuestions(ids, auth.user)
    if (!authorized.allowed) return Response.json({ error: 'You cannot update one or more answer keys.' }, { status: 403 })
    const batch = adminDb.batch()
    parsed.data.keys.forEach(key => {
      batch.set(adminDb.collection('questionKeys').doc(key.questionId), {
        kind: 'mcq',
        correctAnswer: key.correctAnswer,
        ...(key.explanation ? { explanation: key.explanation } : {}),
        updatedBy: auth.user.uid,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })
    await batch.commit()
    return Response.json({ updated: parsed.data.keys.length })
  } catch (error) {
    return errorResponse(error, 'Unable to save answer keys.')
  }
}
