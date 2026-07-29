import 'server-only'

import type { Response } from 'openai/resources/responses/responses'
import { adminDb, FieldValue, adminStorage } from '@/lib/firebase-admin'
import type { ServerRole } from '@/lib/admin-api'
import {
  cancelResponse,
  deleteOpenAIFiles,
  generationModel,
  parseAnalysisResponse,
  parseGenerationResponse,
  parseVerificationResponse,
  responseUsage,
  retrieveResponse,
  startAnalysisResponse,
  startGenerationResponse,
  startVerificationResponse,
  uploadSourcesToOpenAI,
  type OpenAIFileReference,
} from './openai'
import {
  GenerationConfigSchema,
  GeneratedQuestionSchema,
  gifFrameCount,
  PublishGeneratedTestSchema,
  SourceBundleSchema,
  type GenerationStatus,
  type SourceUpload,
} from './schema'

export type GenerationUser = {
  uid: string
  role: ServerRole
  name?: string | null
}

export type GenerationJob = {
  id: string
  ownerId: string
  createdBy: string
  status: GenerationStatus
  sources?: SourceUpload[]
  openaiFiles?: OpenAIFileReference[]
  activeResponseId?: string
  activeStage?: 'analysis' | 'generation' | 'verification'
  analysis?: unknown
  config?: unknown
  titleSuggestion?: string
  descriptionSuggestion?: string
  failedStage?: 'analysis' | 'generation' | 'verification'
  error?: string
  publishedTestId?: string
  model?: string
  retryCount?: number
}

function jobReference(jobId: string) {
  return adminDb.collection('testGenerationJobs').doc(jobId)
}

function candidateReference(jobId: string, questionId: string) {
  return jobReference(jobId).collection('questions').doc(questionId)
}

function sanitizeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'AI test generation failed.'
  return message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 1000)
}

export async function loadGenerationJob(jobId: string) {
  const snapshot = await jobReference(jobId).get()
  return snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as GenerationJob) : null
}

export function canReviewGenerationJob(job: GenerationJob, user: GenerationUser) {
  return user.role === 'admin' || (user.role === 'organisation' && job.ownerId === user.uid)
}

export async function requireGenerationJob(jobId: string, user: GenerationUser) {
  const job = await loadGenerationJob(jobId)
  if (!job) throw Object.assign(new Error('Generation draft not found.'), { status: 404 })
  if (!canReviewGenerationJob(job, user)) {
    throw Object.assign(new Error('You cannot access this generation draft.'), { status: 403 })
  }
  return job
}

export async function createGenerationJob(user: GenerationUser) {
  if (user.role !== 'organisation') {
    throw Object.assign(new Error('Only organisation accounts can create AI test drafts.'), { status: 403 })
  }
  const reference = jobReference(adminDb.collection('testGenerationJobs').doc().id)
  await reference.set({
    ownerId: user.uid,
    createdBy: user.uid,
    createdByName: user.name || '',
    status: 'uploading',
    model: generationModel(),
    retryCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return reference.id
}

async function validateStoredSources(job: GenerationJob, rawSources: unknown) {
  const sources = SourceBundleSchema.parse(rawSources)
  const expectedPrefix = `test-generation-sources/${job.ownerId}/${job.id}/`
  if (sources.some(source => !source.path.startsWith(expectedPrefix))) throw new Error('An uploaded source path is invalid.')

  await Promise.all(sources.map(async source => {
    const storedFile = adminStorage.bucket().file(source.path)
    const [metadata] = await storedFile.getMetadata()
    const storedSize = Number(metadata.size)
    const contentType = String(metadata.contentType || '')
    if (storedSize !== source.size || contentType !== source.mimeType) {
      throw new Error(`Uploaded source metadata does not match ${source.name}.`)
    }
    if (source.mimeType.toLowerCase() === 'image/gif') {
      const [contents] = await storedFile.download()
      if (gifFrameCount(contents) !== 1) throw new Error(`${source.name} must be a valid, non-animated GIF.`)
    }
  }))
  return sources
}

export async function finalizeGenerationUpload(jobId: string, user: GenerationUser, rawSources: unknown) {
  const job = await requireGenerationJob(jobId, user)
  if (job.status !== 'uploading' && !(job.status === 'failed' && job.failedStage === 'analysis')) {
    throw new Error('This generation draft is not waiting for uploads.')
  }
  const sources = await validateStoredSources(job, rawSources)
  const openaiFiles = await uploadSourcesToOpenAI(sources)
  try {
    const response = await startAnalysisResponse(job.id, openaiFiles)
    await jobReference(job.id).update({
      sources,
      openaiFiles,
      status: 'analyzing',
      activeStage: 'analysis',
      activeResponseId: response.id,
      'responseIds.analysis': response.id,
      stageStartedAt: FieldValue.serverTimestamp(),
      failedStage: FieldValue.delete(),
      error: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await deleteOpenAIFiles(openaiFiles)
    throw error
  }
}

export async function startGeneration(jobId: string, user: GenerationUser, rawConfig: unknown) {
  const job = await requireGenerationJob(jobId, user)
  if (job.status !== 'analysis_ready' && !(job.status === 'failed' && job.failedStage === 'generation')) {
    throw new Error('Complete source analysis before generating questions.')
  }
  if (!job.openaiFiles?.length) throw new Error('The uploaded files are no longer available for generation.')
  const config = GenerationConfigSchema.parse(rawConfig)
  const response = await startGenerationResponse({ jobId, files: job.openaiFiles, config })
  await jobReference(jobId).update({
    config,
    status: 'generating',
    activeStage: 'generation',
    activeResponseId: response.id,
    'responseIds.generation': response.id,
    stageStartedAt: FieldValue.serverTimestamp(),
    failedStage: FieldValue.delete(),
    error: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  })
}

async function recordFailure(job: GenerationJob, error: unknown) {
  await jobReference(job.id).update({
    status: 'failed',
    failedStage: job.activeStage || 'analysis',
    error: sanitizeError(error),
    activeResponseId: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  })
}

async function completeAnalysis(job: GenerationJob, response: Response) {
  const analysis = parseAnalysisResponse(response)
  await jobReference(job.id).update({
    analysis,
    status: 'analysis_ready',
    usage: { analysis: responseUsage(response) },
    'latencyMs.analysis': Math.max(0, Date.now() - response.created_at * 1000),
    activeResponseId: FieldValue.delete(),
    activeStage: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  })
}

async function completeGeneration(job: GenerationJob, response: Response) {
  const generated = parseGenerationResponse(response)
  const config = GenerationConfigSchema.parse(job.config)
  if (generated.questions.length !== config.mcqCount || generated.questions.some(question => question.kind !== 'mcq')) {
    throw new Error(`The model must return exactly ${config.mcqCount} MCQs. Short-answer questions are temporarily disabled.`)
  }
  const batch = adminDb.batch()
  generated.questions.forEach((question, position) => {
    batch.set(candidateReference(job.id, question.id), {
      ...question,
      position,
      reviewStatus: 'pending',
      verificationStatus: 'pending',
      editedAfterVerification: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  })
  batch.update(jobReference(job.id), {
    titleSuggestion: generated.titleSuggestion,
    descriptionSuggestion: generated.descriptionSuggestion,
    status: 'verification_starting',
    'usage.generation': responseUsage(response),
    'latencyMs.generation': Math.max(0, Date.now() - response.created_at * 1000),
    activeResponseId: FieldValue.delete(),
    activeStage: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  await batch.commit()
  const verificationResponse = await startVerificationResponse({
    jobId: job.id,
    files: job.openaiFiles || [],
    questions: generated.questions,
  })
  await jobReference(job.id).update({
    status: 'verifying',
    activeStage: 'verification',
    activeResponseId: verificationResponse.id,
    'responseIds.verification': verificationResponse.id,
    stageStartedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
}

async function completeVerification(job: GenerationJob, response: Response) {
  const verification = parseVerificationResponse(response)
  const candidateSnapshots = await jobReference(job.id).collection('questions').get()
  const candidates = new Map(candidateSnapshots.docs.map(item => [item.id, item]))
  const batch = adminDb.batch()
  for (const result of verification.questions) {
    const candidate = candidates.get(result.questionId)
    if (!candidate) continue
    batch.update(candidate.ref, {
      verificationStatus: result.status,
      verificationConfidence: result.confidence,
      verificationIssues: result.issues,
      suggestedFix: result.suggestedFix,
      reviewStatus: result.status === 'unsupported' ? 'needs_changes' : 'pending',
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
  batch.update(jobReference(job.id), {
    status: 'review',
    'usage.verification': responseUsage(response),
    'latencyMs.verification': Math.max(0, Date.now() - response.created_at * 1000),
    activeResponseId: FieldValue.delete(),
    activeStage: FieldValue.delete(),
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  await batch.commit()
  await deleteOpenAIFiles(job.openaiFiles || [])
  await jobReference(job.id).update({ openaiFiles: FieldValue.delete() })
}

export async function processGenerationResponse(responseId: string) {
  const matches = await adminDb.collection('testGenerationJobs')
    .where('activeResponseId', '==', responseId)
    .limit(1)
    .get()
  const snapshot = matches.docs[0]
  if (!snapshot) return
  const job = { id: snapshot.id, ...snapshot.data() } as GenerationJob
  const response = await retrieveResponse(responseId)
  if (response.status === 'queued' || response.status === 'in_progress') return
  if (response.status !== 'completed') {
    await recordFailure(job, new Error(`OpenAI response ended with status ${response.status}.`))
    return
  }
  try {
    if (job.activeStage === 'analysis') await completeAnalysis(job, response)
    else if (job.activeStage === 'generation') await completeGeneration(job, response)
    else if (job.activeStage === 'verification') await completeVerification(job, response)
  } catch (error) {
    const latest = await loadGenerationJob(job.id)
    await recordFailure(latest || job, error)
  }
}

export async function reconcileGenerationJob(jobId: string, user: GenerationUser) {
  const job = await requireGenerationJob(jobId, user)
  if (job.activeResponseId) await processGenerationResponse(job.activeResponseId)
  return loadGenerationJob(jobId)
}

export async function retryGenerationJob(jobId: string, user: GenerationUser) {
  const job = await requireGenerationJob(jobId, user)
  if (job.status !== 'failed') throw new Error('Only a failed generation stage can be retried.')
  if (Number(job.retryCount || 0) >= 3) throw new Error('This draft has reached the automatic retry limit.')
  const failedStage = job.failedStage || 'analysis'
  if (failedStage === 'analysis') {
    if (!job.sources?.length) throw new Error('The uploaded source metadata is missing.')
    const files = job.openaiFiles?.length ? job.openaiFiles : await uploadSourcesToOpenAI(job.sources)
    const response = await startAnalysisResponse(job.id, files)
    await jobReference(job.id).update({
      openaiFiles: files,
      status: 'analyzing',
      activeStage: 'analysis',
      activeResponseId: response.id,
      'responseIds.analysis': response.id,
      stageStartedAt: FieldValue.serverTimestamp(),
      retryCount: FieldValue.increment(1),
      failedStage: FieldValue.delete(),
      error: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return
  }
  if (failedStage === 'generation') {
    if (!job.config) throw new Error('The approved generation configuration is missing.')
    await startGeneration(job.id, user, job.config)
    await jobReference(job.id).update({ retryCount: FieldValue.increment(1) })
    return
  }
  if (failedStage === 'verification') {
    if (!job.openaiFiles?.length) throw new Error('The temporary source files have expired. Regenerate the draft.')
    const questions = (await listGeneratedQuestions(job.id)).map(item => GeneratedQuestionSchema.parse(item))
    const response = await startVerificationResponse({ jobId: job.id, files: job.openaiFiles, questions })
    await jobReference(job.id).update({
      status: 'verifying',
      activeStage: 'verification',
      activeResponseId: response.id,
      'responseIds.verification': response.id,
      stageStartedAt: FieldValue.serverTimestamp(),
      retryCount: FieldValue.increment(1),
      failedStage: FieldValue.delete(),
      error: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return
  }
  throw new Error('This failed stage cannot be retried.')
}

export async function updateGeneratedQuestion(
  jobId: string,
  questionId: string,
  user: GenerationUser,
  input: unknown,
) {
  const job = await requireGenerationJob(jobId, user)
  if (job.status !== 'review') throw new Error('Questions can only be edited during review.')
  const body = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const reviewStatus = body.reviewStatus
  if (!['approved', 'rejected', 'needs_changes', 'pending'].includes(String(reviewStatus))) {
    throw new Error('Choose a valid review status.')
  }
  const question = GeneratedQuestionSchema.parse(body.question)
  if (question.id !== questionId) throw new Error('Question identifier mismatch.')
  const existing = await candidateReference(jobId, questionId).get()
  if (!existing.exists) throw Object.assign(new Error('Generated question not found.'), { status: 404 })
  const previous = existing.data() || {}
  const edited = JSON.stringify(GeneratedQuestionSchema.parse(previous)) !== JSON.stringify(question)
  const overridesUnsupported = reviewStatus === 'approved'
    && previous.verificationStatus === 'unsupported'
    && !edited
  await existing.ref.update({
    ...question,
    reviewStatus,
    editedAfterVerification: edited || previous.editedAfterVerification === true,
    ...(edited && previous.verificationStatus === 'unsupported'
      ? { verificationStatus: 'edited', verificationIssues: [] }
      : {}),
    ...(overridesUnsupported
      ? {
          unsupportedOverrideApproved: true,
          unsupportedOverrideApprovedBy: user.uid,
          unsupportedOverrideApprovedAt: FieldValue.serverTimestamp(),
        }
      : reviewStatus !== 'approved'
        ? {
            unsupportedOverrideApproved: FieldValue.delete(),
            unsupportedOverrideApprovedBy: FieldValue.delete(),
            unsupportedOverrideApprovedAt: FieldValue.delete(),
          }
        : {}),
    reviewedBy: user.uid,
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
}

export async function listGeneratedQuestions(jobId: string) {
  const snapshot = await jobReference(jobId).collection('questions').orderBy('position').get()
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
}

export async function reorderGeneratedQuestions(jobId: string, user: GenerationUser, rawQuestionIds: unknown) {
  const job = await requireGenerationJob(jobId, user)
  if (job.status !== 'review') throw new Error('Questions can only be reordered during review.')
  if (!Array.isArray(rawQuestionIds) || rawQuestionIds.some(id => typeof id !== 'string')) {
    throw new Error('Provide a valid ordered question list.')
  }
  const existing = await jobReference(jobId).collection('questions').get()
  const ids = rawQuestionIds as string[]
  if (ids.length !== existing.size || new Set(ids).size !== ids.length || ids.some(id => !existing.docs.some(item => item.id === id))) {
    throw new Error('The ordered list must include every generated question exactly once.')
  }
  const batch = adminDb.batch()
  ids.forEach((id, position) => batch.update(candidateReference(jobId, id), {
    position,
    updatedAt: FieldValue.serverTimestamp(),
  }))
  await batch.commit()
}

export async function cancelGenerationJob(jobId: string, user: GenerationUser) {
  const job = await requireGenerationJob(jobId, user)
  if (job.publishedTestId) throw new Error('Published generation records cannot be discarded.')
  if (job.activeResponseId) await cancelResponse(job.activeResponseId)
  await deleteOpenAIFiles(job.openaiFiles || [])
  await Promise.allSettled((job.sources || []).map(source => adminStorage.bucket().file(source.path).delete()))
  const questions = await jobReference(jobId).collection('questions').get()
  const batch = adminDb.batch()
  questions.docs.forEach(item => batch.delete(item.ref))
  batch.update(jobReference(jobId), {
    status: 'cancelled',
    sources: FieldValue.delete(),
    openaiFiles: FieldValue.delete(),
    activeResponseId: FieldValue.delete(),
    activeStage: FieldValue.delete(),
    cancelledAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  await batch.commit()
}

export async function publishGenerationJob(
  jobId: string,
  user: GenerationUser,
  rawInput: unknown,
) {
  const input = PublishGeneratedTestSchema.parse(rawInput)
  let job = await requireGenerationJob(jobId, user)
  if (job.publishedTestId) return job.publishedTestId
  if (job.status !== 'review' && job.status !== 'publishing') {
    throw new Error('Complete question review before publishing this test.')
  }

  const [exam, category, candidateSnapshots] = await Promise.all([
    adminDb.collection('examCatalog').doc(input.examId).get(),
    adminDb.collection('categories').doc(input.categoryId).get(),
    jobReference(jobId).collection('questions').orderBy('position').get(),
  ])
  if (!exam.exists) throw new Error('Select a valid exam.')
  if (!category.exists || category.data()?.examId !== input.examId) {
    throw new Error('Select a category belonging to the chosen exam.')
  }
  if (category.data()?.createdBy !== job.ownerId) {
    throw new Error('Select a category owned by this organisation.')
  }

  const candidates = candidateSnapshots.docs.map(item => ({
    reference: item.ref,
    data: GeneratedQuestionSchema.parse(item.data()),
    reviewStatus: item.data().reviewStatus,
    verificationStatus: item.data().verificationStatus,
    unsupportedOverrideApproved: item.data().unsupportedOverrideApproved === true,
    reviewedBy: item.data().reviewedBy,
  }))
  const approved = candidates.filter(item => item.reviewStatus === 'approved' && item.data.kind === 'mcq')
  if (!approved.length) throw new Error('Approve at least one MCQ before publishing.')

  const reservedTestId = String((await jobReference(jobId).get()).data()?.publishingTestId || '')
    || adminDb.collection('tests').doc().id
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(jobReference(jobId))
    const current = snapshot.data()
    if (current?.publishedTestId) return
    if (current?.status !== 'review' && current?.status !== 'publishing') {
      throw new Error('This draft is no longer ready to publish.')
    }
    transaction.update(snapshot.ref, {
      status: 'publishing',
      publishingTestId: current?.publishingTestId || reservedTestId,
      updatedAt: FieldValue.serverTimestamp(),
    })
  })

  job = (await loadGenerationJob(jobId)) || job
  const testId = String((job as GenerationJob & { publishingTestId?: string }).publishingTestId || reservedTestId)
  const testRef = adminDb.collection('tests').doc(testId)
  const batch = adminDb.batch()
  let totalMarks = 0

  approved.forEach((item, position) => {
    const questionRef = adminDb.collection('questions').doc()
    const keyRef = adminDb.collection('questionKeys').doc(questionRef.id)
    const question = item.data
    totalMarks += question.marks
    const common = {
      prompt: question.prompt,
      kind: question.kind,
      createdBy: job.ownerId,
      visibility: input.visibility === 'public' ? 'public' : 'private',
      ...(input.visibility === 'public' ? {} : { organisationId: job.ownerId }),
      generationJobId: job.id,
      topic: question.topic,
      difficulty: question.difficulty,
      revision: 1,
      archivedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      schemaVersion: 3,
    }
    batch.set(questionRef, question.kind === 'mcq'
      ? { ...common, options: question.options, format: 'plain' }
      : { ...common, format: 'plain' })
    batch.set(keyRef, question.kind === 'mcq'
      ? {
          kind: 'mcq',
          correctAnswer: question.correctAnswer,
          explanation: question.explanation,
          answerOrigin: question.answerOrigin,
          sourceReferences: question.sourceReferences,
          generationJobId: job.id,
          updatedAt: FieldValue.serverTimestamp(),
        }
      : {
          kind: 'short_answer',
          modelAnswer: question.modelAnswer,
          rubric: question.rubric,
          answerOrigin: question.answerOrigin,
          sourceReferences: question.sourceReferences,
          generationJobId: job.id,
          updatedAt: FieldValue.serverTimestamp(),
        })
    batch.set(testRef.collection('questions').doc(), {
      questionId: questionRef.id,
      position,
      marks: question.marks,
      mode: 'linked',
    })
    if (item.verificationStatus === 'unsupported') {
      batch.update(item.reference, {
        unsupportedOverrideApproved: true,
        unsupportedOverrideApprovedBy: item.reviewedBy || user.uid,
        unsupportedOverridePublishedBy: user.uid,
        unsupportedOverridePublishedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
  })

  const examData = exam.data()!
  const categoryData = category.data()!
  batch.set(testRef, {
    title: input.title,
    description: input.description,
    exam: examData.name,
    examAlias: examData.primaryAlias || examData.name,
    examId: exam.id,
    category: categoryData.name,
    categoryId: category.id,
    durationMinutes: input.durationMinutes,
    visibility: input.visibility,
    ...(input.visibility === 'public' ? {} : { organisationId: job.ownerId }),
    questionCount: approved.length,
    totalMarks,
    createdBy: job.ownerId,
    createdAt: FieldValue.serverTimestamp(),
    published: true,
    publishedAt: FieldValue.serverTimestamp(),
    deletedAt: null,
    schemaVersion: 3,
    origin: 'ai_generated',
    generationJobId: job.id,
    publishedBy: user.uid,
  })
  batch.update(jobReference(jobId), {
    status: 'published',
    publishedTestId: testId,
    publishedBy: user.uid,
    publishedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  await batch.commit()
  return testId
}
