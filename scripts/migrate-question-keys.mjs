/* Run with Firebase Admin credentials in the environment. Defaults to dry-run. */
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
const rawPrivateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim()
const quote = rawPrivateKey?.[0]
const unquotedPrivateKey = rawPrivateKey && (quote === '"' || quote === "'") && rawPrivateKey.at(-1) === quote
  ? rawPrivateKey.slice(1, -1)
  : rawPrivateKey
const privateKey = unquotedPrivateKey?.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n').replace(/\r\n?/g, '\n').trim()
if (!getApps().length) {
  initializeApp({ credential: projectId && clientEmail && privateKey ? cert({ projectId, clientEmail, privateKey }) : applicationDefault() })
}

const db = getFirestore()
const write = process.argv.includes('--write')
const questions = await db.collection('questions').get()
const candidates = questions.docs.filter(document => {
  const data = document.data()
  return Number.isInteger(data.correctAnswer) || typeof data.modelAnswer === 'string'
})

console.log(`Found ${candidates.length} question-bank documents with inline answer keys.`)
if (!write) {
  console.log('Dry run only. Re-run with --write to migrate.')
  process.exit(0)
}

let batch = db.batch()
let pending = 0
let migrated = 0
for (const document of candidates) {
  const data = document.data()
  const isShort = data.kind === 'short_answer' || typeof data.modelAnswer === 'string'
  const key = isShort
    ? {
        kind: 'short_answer',
        modelAnswer: data.modelAnswer || '',
        rubric: Array.isArray(data.rubric) ? data.rubric : [],
      }
    : {
        kind: 'mcq',
        correctAnswer: data.correctAnswer,
        ...(typeof data.explanation === 'string' ? { explanation: data.explanation } : {}),
      }
  Object.assign(key, {
    ...(data.answerOrigin ? { answerOrigin: data.answerOrigin } : {}),
    ...(Array.isArray(data.sourceReferences) ? { sourceReferences: data.sourceReferences } : {}),
    migratedAt: FieldValue.serverTimestamp(),
  })
  batch.set(db.collection('questionKeys').doc(document.id), key, { merge: true })
  batch.update(document.ref, {
    correctAnswer: FieldValue.delete(),
    explanation: FieldValue.delete(),
    modelAnswer: FieldValue.delete(),
    rubric: FieldValue.delete(),
    answerOrigin: FieldValue.delete(),
    sourceReferences: FieldValue.delete(),
    schemaVersion: 3,
    updatedAt: FieldValue.serverTimestamp(),
  })
  pending += 2
  migrated += 1
  if (pending >= 400) {
    await batch.commit()
    batch = db.batch()
    pending = 0
  }
}
if (pending) await batch.commit()
console.log(`Migrated ${migrated} question-bank answer keys.`)

const privateKeyFor = (data) => data.kind === 'short_answer' || typeof data.modelAnswer === 'string'
  ? {
      kind: 'short_answer',
      modelAnswer: data.modelAnswer || '',
      rubric: Array.isArray(data.rubric) ? data.rubric : [],
    }
  : {
      kind: 'mcq',
      correctAnswer: Number.isInteger(data.correctAnswer) ? data.correctAnswer : 0,
      ...(typeof data.explanation === 'string' ? { explanation: data.explanation } : {}),
    }
const publicQuestionFor = (data, owner, visibility, organisationId) => ({
  kind: data.kind === 'short_answer' ? 'short_answer' : 'mcq',
  prompt: data.prompt || '',
  ...(data.kind === 'short_answer' ? {} : { options: Array.isArray(data.options) ? data.options : [] }),
  ...(data.format ? { format: data.format } : {}),
  ...(data.promptImageUrl ? { promptImageUrl: data.promptImageUrl } : {}),
  ...(Array.isArray(data.optionImageUrls) ? { optionImageUrls: data.optionImageUrls } : {}),
  createdBy: owner,
  visibility,
  ...(visibility === 'private' && organisationId ? { organisationId } : {}),
  revision: Number(data.revision) || 1,
  archivedAt: null,
  schemaVersion: 3,
  updatedAt: FieldValue.serverTimestamp(),
})

const tests = await db.collection('tests').get()
let legacyTests = 0
let sanitizedSnapshots = 0
for (const testDocument of tests.docs) {
  const testData = testDocument.data()
  const owner = testData.createdBy || testData.organisationId || ''
  const questionVisibility = testData.visibility === 'public' ? 'public' : 'private'
  const legacyQuestions = Array.isArray(testData.questions) ? testData.questions : []
  if (legacyQuestions.length) {
    const legacyBatch = db.batch()
    legacyQuestions.forEach((question, index) => {
      const questionId = `legacy_${testDocument.id}_${index}`
      const questionRef = db.collection('questions').doc(questionId)
      legacyBatch.set(questionRef, {
        ...publicQuestionFor(question, owner, questionVisibility, testData.organisationId || owner),
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      legacyBatch.set(db.collection('questionKeys').doc(questionId), {
        ...privateKeyFor(question),
        migratedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      legacyBatch.set(testDocument.ref.collection('questions').doc(`legacy_${index}`), {
        questionId,
        position: index,
        marks: Number(question.marks) || 1,
        mode: 'linked',
      }, { merge: true })
    })
    legacyBatch.update(testDocument.ref, {
      questions: FieldValue.delete(),
      questionCount: legacyQuestions.length,
      totalMarks: legacyQuestions.reduce((sum, question) => sum + (Number(question.marks) || 1), 0),
      schemaVersion: 3,
    })
    await legacyBatch.commit()
    legacyTests += 1
  }

  const memberships = await testDocument.ref.collection('questions').get()
  for (const membership of memberships.docs) {
    const membershipData = membership.data()
    const snapshot = membershipData.snapshot
    if (!snapshot || typeof snapshot !== 'object') continue
    const questionId = typeof membershipData.questionId === 'string' && membershipData.questionId
      ? membershipData.questionId
      : `snapshot_${testDocument.id}_${membership.id}`
    const source = await db.collection('questions').doc(questionId).get()
    const cleanup = db.batch()
    if (!source.exists) {
      cleanup.set(db.collection('questions').doc(questionId), {
        ...publicQuestionFor(snapshot, owner, questionVisibility, testData.organisationId || owner),
        createdAt: FieldValue.serverTimestamp(),
      })
      cleanup.set(db.collection('questionKeys').doc(questionId), {
        ...privateKeyFor(snapshot),
        migratedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    cleanup.update(membership.ref, {
      questionId,
      snapshot: FieldValue.delete(),
      mode: 'linked',
    })
    await cleanup.commit()
    sanitizedSnapshots += 1
  }
}
console.log(`Converted ${legacyTests} inline legacy tests and sanitized ${sanitizedSnapshots} membership snapshots.`)
