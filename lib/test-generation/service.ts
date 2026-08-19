import 'server-only'

import { and, asc, eq, inArray, lt } from 'drizzle-orm'
import OpenAI, { toFile } from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { Response as OpenAIResponse } from 'openai/resources/responses/responses'
import { z } from 'zod'
import {
  categories,
  examAliases,
  exams,
  files,
  organizationExams,
  questionKeys,
  questions,
  testGenerationJobs,
  testGenerationQuestions,
  testGenerationSources,
  testQuestions,
  tests,
} from '@/db/schema'
import type { ServerUser } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { normalizeExamKey } from '@/lib/exam-catalog'
import { adminStorage } from '@/lib/firebase-admin'
import { canManageOrganization } from '@/lib/services/access'
import {
  GeneratedMcqTestSchema,
  GeneratedMcqSchema,
  GenerationAnalysisSchema,
  GenerationConfigSchema,
  STANDALONE_QUESTION_INSTRUCTION,
  repairGeneratedMcqContent,
  shuffleMcqOptions,
  isImageSource,
} from '@/lib/test-generation/schema'
import { resolveExamTopic } from '@/lib/test-generation/topic-resolution'

const OPENAI_FILE_EXPIRY_SECONDS = 24 * 60 * 60
const UNSTARTED_GENERATION_TIMEOUT_MS = 5 * 60 * 1000

function openAIClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OpenAI is not configured.')
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

function sanitizeGenerationError(error: unknown) {
  const message = error instanceof Error ? error.message : 'AI test generation failed.'
  if (/request too large[\s\S]*tokens per min|\bTPM\b/i.test(message)) {
    return [
      'The uploaded material is too large to process in one model request under the current OpenAI token limit.',
      'Try again with a smaller PDF or split the material into fewer pages.',
    ].join(' ')
  }
  return message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 1000)
}

function generationOutputTokenBudget(questionCount: number) {
  return Math.min(40_000, Math.max(8_000, 2_000 + questionCount * 700))
}

function responseUsage(response: OpenAIResponse) {
  return response.usage
    ? {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
      }
    : null
}

export async function requireGenerationJob(id: string, user: ServerUser) {
  const job = (await database().select().from(testGenerationJobs).where(eq(testGenerationJobs.id, id)).limit(1))[0]
  if (!job) throw Object.assign(new Error('AI test draft not found.'), { status: 404 })
  if (user.globalRole !== 'admin' && !(await canManageOrganization(user, job.organizationId))) {
    throw Object.assign(new Error('AI test draft access required.'), { status: 403 })
  }
  return job
}

export async function createGenerationJob(user: ServerUser) {
  if (!user.organizationId) throw Object.assign(new Error('An organization is required.'), { status: 403 })
  if (!(await canManageOrganization(user, user.organizationId))) throw Object.assign(new Error('Organization manager access required.'), { status: 403 })
  const [job] = await database().insert(testGenerationJobs).values({
    organizationId: user.organizationId,
    createdBy: user.uid,
    model: process.env.OPENAI_TEST_GENERATION_MODEL || 'gpt-5.6-terra',
  }).returning()
  return job.id
}

export async function createTopicGenerationJob(user: ServerUser, examId: string, requestedTopic: string) {
  if (!user.organizationId) throw Object.assign(new Error('An organization is required.'), { status: 403 })
  if (!(await canManageOrganization(user, user.organizationId))) {
    throw Object.assign(new Error('Organization manager access required.'), { status: 403 })
  }
  const db = database()
  const exam = (await db.select().from(exams).where(eq(exams.id, examId)).limit(1))[0]
  if (!exam) throw Object.assign(new Error('Exam not found.'), { status: 404 })
  const aliases = await db.select().from(examAliases).where(eq(examAliases.examId, exam.id))
  const resolution = await resolveExamTopic(
    exam.name,
    aliases.map(alias => alias.alias),
    requestedTopic,
  )
  if (resolution.status !== 'recognized') return { resolution }

  const analysis = {
    mode: 'topic' as const,
    examId: exam.id,
    examName: exam.name,
    requestedTopic,
    canonicalTopic: resolution.canonicalTopic,
    language: 'English',
    subject: resolution.subject,
    summary: resolution.summary,
    warnings: [
      'This topic was identified using model knowledge, not an uploaded or current official syllabus.',
      'Generated answers are AI-inferred and require manual review before publication.',
    ],
  }
  const [job] = await db.transaction(async tx => {
    await tx.insert(organizationExams).values({
      organizationId: user.organizationId!,
      examId: exam.id,
      createdBy: user.uid,
    }).onConflictDoNothing()
    return tx.insert(testGenerationJobs).values({
      organizationId: user.organizationId!,
      createdBy: user.uid,
      status: 'analysis_ready',
      model: process.env.OPENAI_TEST_GENERATION_MODEL || 'gpt-5.6-terra',
      analysis,
    }).returning()
  })
  return { resolution, jobId: job.id, analysis }
}

export async function attachGenerationSources(id: string, user: ServerUser, fileIds: string[]) {
  const job = await requireGenerationJob(id, user)
  const sourceFiles = await database().select().from(files).where(inArray(files.id, fileIds))
  if (sourceFiles.length !== fileIds.length || sourceFiles.some(file => file.ownerUserId !== user.uid || file.deletedAt)) {
    throw Object.assign(new Error('One or more source files are unavailable.'), { status: 400 })
  }
  const orderedFiles = fileIds.map(fileId => sourceFiles.find(file => file.id === fileId)!)
  const sourceReferences = orderedFiles.map(file => ({
    sourceId: file.id,
    filename: file.name,
    locator: 'Uploaded file',
    excerpt: 'Source material used for this generated draft.',
  }))
  const analysis = {
    mode: 'sources' as const,
    sourceKind: 'notes' as const,
    language: 'English',
    subject: 'Study material',
    summary: 'The uploaded material is ready for question generation.',
    topics: [{
      name: 'All uploaded material',
      importance: 'high' as const,
      rationale: 'Generate questions across the uploaded study material.',
      sourceReferences,
    }],
    warnings: [] as string[],
  }
  await database().transaction(async tx => {
    await tx.delete(testGenerationSources).where(eq(testGenerationSources.jobId, id))
    await tx.insert(testGenerationSources).values(fileIds.map((fileId, position) => ({ jobId: id, fileId, position })))
    await tx.update(testGenerationJobs).set({ status: 'analysis_ready', analysis, updatedAt: new Date() }).where(eq(testGenerationJobs.id, job.id))
  })
}

export async function listGeneratedQuestions(id: string) {
  return database().select().from(testGenerationQuestions).where(eq(testGenerationQuestions.jobId, id)).orderBy(asc(testGenerationQuestions.position))
}

async function generatedMcqRepairDefaults(job: typeof testGenerationJobs.$inferSelect) {
  const config = GenerationConfigSchema.safeParse(job.config)
  const sourceFiles = await database().select({
    id: files.id,
    name: files.name,
  }).from(testGenerationSources)
    .innerJoin(files, eq(files.id, testGenerationSources.fileId))
    .where(eq(testGenerationSources.jobId, job.id))
    .orderBy(testGenerationSources.position)
  return {
    topic: config.success ? config.data.subject : 'Study material',
    difficulty: config.success && config.data.difficulty !== 'mixed'
      ? config.data.difficulty
      : 'medium' as const,
    sourceReferences: config.success && config.data.mode === 'topic' ? [] : sourceFiles.map(file => ({
      sourceId: file.id,
      filename: file.name,
      locator: 'Uploaded file',
      excerpt: 'Source material used to generate this question.',
    })),
  }
}

export async function generateTestDraft(id: string, user: ServerUser, config: unknown) {
  const job = await requireGenerationJob(id, user)
  const parsedConfig = GenerationConfigSchema.parse(config)
  const canStart = job.status === 'analysis_ready'
    || (job.status === 'failed' && job.failedStage === 'generation')
  if (!canStart) {
    if (job.status === 'generating' && job.activeResponseId) return job.activeResponseId
    throw Object.assign(new Error('Complete the analysis step before generating questions.'), { status: 409 })
  }

  const db = database()
  const sources = await db.select({
    source: testGenerationSources,
    file: files,
  }).from(testGenerationSources)
    .innerJoin(files, eq(files.id, testGenerationSources.fileId))
    .where(eq(testGenerationSources.jobId, id))
    .orderBy(testGenerationSources.position)
  if (parsedConfig.mode === 'sources' && !sources.length) {
    throw Object.assign(new Error('Upload at least one source file.'), { status: 409 })
  }
  const parsedAnalysis = GenerationAnalysisSchema.safeParse(job.analysis)
  if (parsedAnalysis.success && parsedConfig.mode !== parsedAnalysis.data.mode) {
    throw Object.assign(new Error('The generation mode does not match this draft.'), { status: 409 })
  }
  if (parsedConfig.mode === 'topic' && (!parsedAnalysis.success || parsedAnalysis.data.mode !== 'topic')) {
    throw Object.assign(new Error('This draft does not contain a validated exam and topic.'), { status: 409 })
  }
  if (parsedConfig.mode === 'topic' && parsedAnalysis.success && parsedAnalysis.data.mode === 'topic' && (
    parsedConfig.examId !== parsedAnalysis.data.examId
    || parsedConfig.examName !== parsedAnalysis.data.examName
    || parsedConfig.requestedTopic !== parsedAnalysis.data.requestedTopic
    || parsedConfig.canonicalTopic !== parsedAnalysis.data.canonicalTopic
  )) {
    throw Object.assign(new Error('The validated exam and topic cannot be changed for this draft.'), { status: 409 })
  }

  const now = new Date()
  const claimed = await db.update(testGenerationJobs).set({
    status: 'generating',
    config: parsedConfig,
    activeStage: 'generation',
    activeResponseId: null,
    stageStartedAt: now,
    failedStage: null,
    error: null,
    updatedAt: now,
  }).where(and(
    eq(testGenerationJobs.id, id),
    eq(testGenerationJobs.status, job.status),
  )).returning({ id: testGenerationJobs.id })
  if (!claimed.length) throw Object.assign(new Error('This generation draft changed. Refresh and try again.'), { status: 409 })

  let responseId: string | null = null
  try {
    const client = openAIClient()
    const uploaded: Array<{
      sourceId: string
      filename: string
      mimeType: string
      fileId: string
    }> = []
    for (const source of parsedConfig.mode === 'sources' ? sources : []) {
      const [buffer] = await adminStorage.bucket().file(source.file.path).download()
      const openaiFile = await client.files.create({
        file: await toFile(buffer, source.file.name, { type: source.file.contentType }),
        purpose: isImageSource(source.file.contentType) ? 'vision' : 'user_data',
        expires_after: { anchor: 'created_at', seconds: OPENAI_FILE_EXPIRY_SECONDS },
      })
      uploaded.push({
        sourceId: source.file.id,
        filename: source.file.name,
        mimeType: source.file.contentType,
        fileId: openaiFile.id,
      })
      await db.update(testGenerationSources).set({ openaiFileId: openaiFile.id }).where(eq(testGenerationSources.id, source.source.id))
    }
    const sourceMode = parsedConfig.mode === 'sources'
    const response = await client.responses.create({
      model: job.model,
      background: true,
      max_output_tokens: generationOutputTokenBudget(parsedConfig.mcqCount),
      reasoning: { effort: 'low' },
      metadata: {
        test_generation_job_id: id,
        test_generation_stage: 'generation',
      },
      instructions: [
        sourceMode
          ? 'Create a rigorous mock test grounded only in the uploaded educational material.'
          : `Create a rigorous mock test for ${parsedConfig.examName} covering only ${parsedConfig.canonicalTopic}.`,
        sourceMode
          ? 'Do not use web search or outside sources.'
          : 'Use only your existing model knowledge. Do not use web search, invent citations, or claim alignment with a current official syllabus.',
        'Use the requested language and difficulty, avoid trivia and duplicate questions.',
        sourceMode
          ? STANDALONE_QUESTION_INSTRUCTION
          : 'Write every question as a direct, self-contained exam question. Do not refer to source material, documents, files, diagrams, or passages that the learner cannot access.',
        `Return exactly ${parsedConfig.mcqCount} questions and make every question an MCQ.`,
        `Assign exactly ${parsedConfig.mcqMarks} marks to every question.`,
        'Each MCQ must have four distinct plausible options and exactly one correct answer.',
        'Distribute correct answers across option positions 0, 1, 2, and 3; do not place most correct answers in the same position or use a predictable pattern.',
        sourceMode
          ? 'Every question must use answerOrigin source_supported and cite one or more uploaded sources using the supplied source ID and exact filename.'
          : 'Every question must use answerOrigin model_inferred and an empty sourceReferences array.',
        'Use stable question IDs q-001, q-002, and so on.',
      ].join(' '),
      input: [{
        role: 'user',
        content: [
          {
            type: 'input_text' as const,
            text: [
              `Configuration: ${JSON.stringify(parsedConfig)}`,
              ...(sourceMode ? [
                'Available source identifiers:',
                ...uploaded.map(file => `- ${file.sourceId}: ${file.filename}`),
              ] : [
                `Validated exam: ${parsedConfig.examName}`,
                `Validated topic: ${parsedConfig.canonicalTopic}`,
              ]),
            ].join('\n'),
          },
          ...uploaded.map(file => isImageSource(file.mimeType)
            ? {
                type: 'input_image' as const,
                file_id: file.fileId,
                detail: 'original' as const,
              }
            : {
                type: 'input_file' as const,
                file_id: file.fileId,
                // GPT-5.6 resolves PDF "auto" to high detail. Low detail keeps
                // extracted PDF text while substantially reducing page-image tokens.
                detail: file.mimeType === 'application/pdf' ? 'low' as const : 'auto' as const,
              }),
        ],
      }],
      text: { format: zodTextFormat(GeneratedMcqTestSchema, 'generated_mock_test') },
    })
    responseId = response.id
    await db.update(testGenerationJobs).set({
      activeResponseId: response.id,
      responseIds: { ...(job.responseIds || {}), generation: response.id },
      updatedAt: new Date(),
    }).where(and(
      eq(testGenerationJobs.id, id),
      eq(testGenerationJobs.status, 'generating'),
    ))
    return response.id
  } catch (error) {
    if (responseId) await openAIClient().responses.cancel(responseId).catch(() => null)
    await db.update(testGenerationJobs).set({
      status: 'failed',
      failedStage: 'generation',
      activeResponseId: null,
      error: sanitizeGenerationError(error),
      updatedAt: new Date(),
    }).where(and(
      eq(testGenerationJobs.id, id),
      eq(testGenerationJobs.status, 'generating'),
    ))
    throw error
  }
}

export async function processGenerationResponse(responseId: string) {
  const db = database()
  const job = (await db.select().from(testGenerationJobs)
    .where(eq(testGenerationJobs.activeResponseId, responseId))
    .limit(1))[0]
  if (!job || job.status !== 'generating' || job.activeStage !== 'generation') return

  let response: OpenAIResponse
  try {
    response = await openAIClient().responses.retrieve(responseId)
  } catch (error) {
    // A transient retrieval error must not turn a running response into a failed job.
    console.error(`Unable to retrieve OpenAI response ${responseId}:`, error)
    return
  }
  if (response.status === 'queued' || response.status === 'in_progress') return
  if (response.status !== 'completed') {
    const reason = response.error?.message
      || response.incomplete_details?.reason
      || `OpenAI response ended with status ${response.status}.`
    await db.update(testGenerationJobs).set({
      status: 'failed',
      failedStage: 'generation',
      activeResponseId: null,
      error: sanitizeGenerationError(new Error(reason)),
      updatedAt: new Date(),
    }).where(and(
      eq(testGenerationJobs.id, job.id),
      eq(testGenerationJobs.activeResponseId, responseId),
    ))
    return
  }

  try {
    const config = GenerationConfigSchema.parse(job.config)
    const rawGenerated = JSON.parse(response.output_text) as Record<string, unknown>
    const generated = GeneratedMcqTestSchema.parse(config.mode === 'topic' && Array.isArray(rawGenerated.questions)
      ? {
          ...rawGenerated,
          questions: rawGenerated.questions.map(question => question && typeof question === 'object' && !Array.isArray(question)
            ? { ...question, answerOrigin: 'model_inferred' as const, sourceReferences: [] }
            : question),
        }
      : rawGenerated)
    if (generated.questions.length !== config.mcqCount) {
      throw new Error(`The model returned ${generated.questions.length} questions instead of ${config.mcqCount}. Retry generation.`)
    }
    await db.transaction(async tx => {
      const completed = await tx.update(testGenerationJobs).set({
        status: 'review',
        titleSuggestion: generated.titleSuggestion,
        descriptionSuggestion: generated.descriptionSuggestion,
        activeResponseId: null,
        activeStage: null,
        usage: { ...(job.usage || {}), generation: responseUsage(response) },
        latencyMs: {
          ...(job.latencyMs || {}),
          generation: Math.max(0, Date.now() - response.created_at * 1000),
        },
        updatedAt: new Date(),
      }).where(and(
        eq(testGenerationJobs.id, job.id),
        eq(testGenerationJobs.status, 'generating'),
        eq(testGenerationJobs.activeResponseId, responseId),
      )).returning({ id: testGenerationJobs.id })
      if (!completed.length) return

      await tx.delete(testGenerationQuestions).where(eq(testGenerationQuestions.jobId, job.id))
      await tx.insert(testGenerationQuestions).values(generated.questions.map((content, position) => ({
        jobId: job.id,
        candidateKey: content.id,
        position,
        content,
        reviewStatus: 'pending',
        verificationStatus: config.mode === 'topic' ? 'answer_inferred' : 'verified',
        verification: { mode: config.mode === 'topic' ? 'model_knowledge' : 'source_grounded_generation' },
      })))
    })
  } catch (error) {
    await db.update(testGenerationJobs).set({
      status: 'failed',
      failedStage: 'generation',
      activeResponseId: null,
      error: sanitizeGenerationError(error),
      updatedAt: new Date(),
    }).where(and(
      eq(testGenerationJobs.id, job.id),
      eq(testGenerationJobs.activeResponseId, responseId),
    ))
  }
}

export async function reconcileGenerationJob(id: string, user: ServerUser) {
  let job = await requireGenerationJob(id, user)
  if (job.status === 'generating' && job.activeResponseId) {
    await processGenerationResponse(job.activeResponseId)
    job = await requireGenerationJob(id, user)
  } else if (
    job.status === 'generating'
    && !job.activeResponseId
    && job.stageStartedAt
    && job.stageStartedAt.getTime() < Date.now() - UNSTARTED_GENERATION_TIMEOUT_MS
  ) {
    await database().update(testGenerationJobs).set({
      status: 'failed',
      failedStage: 'generation',
      error: 'The generation request did not start. Retry this stage.',
      updatedAt: new Date(),
    }).where(and(
      eq(testGenerationJobs.id, id),
      eq(testGenerationJobs.status, 'generating'),
      lt(testGenerationJobs.stageStartedAt, new Date(Date.now() - UNSTARTED_GENERATION_TIMEOUT_MS)),
    ))
    job = await requireGenerationJob(id, user)
  }
  return job
}

export async function updateGeneratedQuestion(id: string, questionId: string, user: ServerUser, input: unknown) {
  const job = await requireGenerationJob(id, user)
  if (job.status !== 'review') throw Object.assign(new Error('Questions can only be edited during review.'), { status: 409 })
  const body = z.object({
    content: z.record(z.string(), z.unknown()).optional(),
    reviewStatus: z.enum(['pending', 'accepted', 'rejected']).optional(),
  }).parse(input)
  const current = (await database().select().from(testGenerationQuestions).where(and(
    eq(testGenerationQuestions.id, questionId),
    eq(testGenerationQuestions.jobId, id),
  )).limit(1))[0]
  if (!current) throw Object.assign(new Error('Generated question not found.'), { status: 404 })
  const defaults = await generatedMcqRepairDefaults(job)
  const repaired = repairGeneratedMcqContent(current.content, {
    ...defaults,
    id: current.candidateKey,
  })
  const content = body.content
    ? GeneratedMcqSchema.parse({ ...repaired, ...body.content })
    : repaired
  await database().update(testGenerationQuestions).set({
    content,
    ...(body.content ? { editedAfterVerification: true } : {}),
    ...(body.reviewStatus ? { reviewStatus: body.reviewStatus } : {}),
    updatedAt: new Date(),
  }).where(and(eq(testGenerationQuestions.id, questionId), eq(testGenerationQuestions.jobId, id)))
}

export async function reorderGeneratedQuestions(id: string, user: ServerUser, questionIds: unknown) {
  await requireGenerationJob(id, user)
  const ids = z.array(z.string().uuid()).parse(questionIds)
  await database().transaction(async tx => {
    for (const [position, questionId] of ids.entries()) {
      await tx.update(testGenerationQuestions).set({ position, updatedAt: new Date() }).where(and(eq(testGenerationQuestions.id, questionId), eq(testGenerationQuestions.jobId, id)))
    }
  })
}

export async function publishGenerationJob(id: string, user: ServerUser, input: unknown) {
  const job = await requireGenerationJob(id, user)
  if (job.status !== 'review') throw Object.assign(new Error('This draft is not ready to publish.'), { status: 409 })
  const body = z.object({
    examId: z.string().uuid(),
    categoryName: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(240),
    description: z.string().max(10_000).default(''),
    durationMinutes: z.number().int().min(1).max(1_440).default(30),
    visibility: z.enum(['public', 'private', 'assigned']).default('private'),
  }).parse(input)
  const generationConfig = GenerationConfigSchema.parse(job.config)
  if (generationConfig.mode === 'topic' && body.examId !== generationConfig.examId) {
    throw Object.assign(new Error('This test must be published under the exam used for topic generation.'), { status: 409 })
  }
  const generated = await listGeneratedQuestions(id)
  const accepted = generated.filter(item => item.reviewStatus === 'accepted')
  if (!accepted.length) throw Object.assign(new Error('Accept at least one generated question.'), { status: 409 })
  const repairDefaults = await generatedMcqRepairDefaults(job)
  const testId = await database().transaction(async tx => {
    const normalizedName = normalizeExamKey(body.categoryName)
    let category = (await tx.select().from(categories).where(and(
      eq(categories.organizationId, job.organizationId),
      eq(categories.examId, body.examId),
      eq(categories.normalizedName, normalizedName),
    )).limit(1))[0]
    if (!category) [category] = await tx.insert(categories).values({ organizationId: job.organizationId, examId: body.examId, name: body.categoryName, normalizedName, createdBy: user.uid }).returning()
    const contents = accepted.map(item => shuffleMcqOptions(
      repairGeneratedMcqContent(item.content, {
        ...repairDefaults,
        id: item.candidateKey,
      }),
    ))
    for (const [index, item] of accepted.entries()) {
      await tx.update(testGenerationQuestions).set({
        content: contents[index],
        updatedAt: new Date(),
      }).where(eq(testGenerationQuestions.id, item.id))
    }
    const [test] = await tx.insert(tests).values({
      organizationId: job.organizationId,
      examId: body.examId,
      categoryId: category.id,
      createdBy: user.uid,
      title: body.title,
      description: body.description,
      durationMinutes: body.durationMinutes,
      visibility: body.visibility,
      published: true,
      publishedAt: new Date(),
      origin: 'ai_generated',
      generationJobId: id,
      questionCount: contents.length,
      totalMarks: contents.reduce((sum, item) => sum + item.marks, 0),
    }).returning()
    for (const [position, content] of contents.entries()) {
      const [question] = await tx.insert(questions).values({
        organizationId: job.organizationId,
        createdBy: user.uid,
        kind: content.kind,
        visibility: body.visibility,
        prompt: content.prompt,
        options: content.options,
      }).returning()
      await tx.insert(questionKeys).values({
        questionId: question.id,
        correctAnswer: content.correctAnswer,
        explanation: content.explanation,
        answerOrigin: content.answerOrigin,
        sourceReferences: content.sourceReferences,
      })
      await tx.insert(testQuestions).values({ testId: test.id, questionId: question.id, position, marks: content.marks, snapshot: content })
    }
    await tx.update(testGenerationJobs).set({ status: 'published', publishedTestId: test.id, updatedAt: new Date() }).where(eq(testGenerationJobs.id, id))
    return test.id
  })
  return testId
}

export async function cancelGenerationJob(id: string, user: ServerUser) {
  await requireGenerationJob(id, user)
  await database().update(testGenerationJobs).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(testGenerationJobs.id, id))
}
