import { z } from 'zod'

export const MAX_SOURCE_FILES = 5
export const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024
export const MAX_SOURCE_TOTAL_BYTES = 50 * 1024 * 1024
export const MIN_GENERATED_QUESTIONS = 5
export const MAX_GENERATED_QUESTIONS = 50

export const ACCEPTED_SOURCE_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'rtf', 'odt', 'txt', 'md',
  'png', 'jpg', 'jpeg', 'webp', 'gif',
] as const

export const ACCEPTED_SOURCE_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'text/rtf',
  'application/vnd.oasis.opendocument.text',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

export const SourceReferenceSchema = z.object({
  sourceId: z.string().min(1).max(128),
  filename: z.string().min(1).max(240),
  locator: z.string().min(1).max(240),
  excerpt: z.string().min(1).max(800),
})

export type SourceReference = z.infer<typeof SourceReferenceSchema>

export const SourceAnalysisSchema = z.object({
  mode: z.literal('sources').default('sources'),
  sourceKind: z.enum(['notes', 'question_paper', 'mixed', 'unknown']),
  language: z.string().min(1).max(80),
  subject: z.string().min(1).max(160),
  summary: z.string().min(1).max(1600),
  topics: z.array(z.object({
    name: z.string().min(1).max(160),
    importance: z.enum(['high', 'medium', 'low']),
    rationale: z.string().min(1).max(600),
    sourceReferences: z.array(SourceReferenceSchema).min(1).max(5),
  })).min(1).max(30),
  warnings: z.array(z.string().min(1).max(500)).max(20),
})

export type SourceAnalysis = z.infer<typeof SourceAnalysisSchema>

export const TopicAnalysisSchema = z.object({
  mode: z.literal('topic'),
  examId: z.string().uuid(),
  examName: z.string().trim().min(2).max(120),
  requestedTopic: z.string().trim().min(2).max(160),
  canonicalTopic: z.string().trim().min(2).max(160),
  language: z.string().trim().min(1).max(80),
  subject: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(1600),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20),
})

export const GenerationAnalysisSchema = z.preprocess(value => {
  if (value && typeof value === 'object' && !Array.isArray(value) && !('mode' in value)) {
    return { ...value, mode: 'sources' }
  }
  return value
}, z.discriminatedUnion('mode', [SourceAnalysisSchema, TopicAnalysisSchema]))

export type TopicAnalysis = z.infer<typeof TopicAnalysisSchema>
export type GenerationAnalysis = z.infer<typeof GenerationAnalysisSchema>

export const TopicResolutionSchema = z.object({
  status: z.enum(['recognized', 'needs_clarification', 'unsupported']),
  canonicalTopic: z.string().trim().max(160),
  subject: z.string().trim().max(160),
  summary: z.string().trim().min(1).max(1600),
  message: z.string().trim().min(1).max(800),
  suggestions: z.array(z.string().trim().min(2).max(160)).max(5),
}).superRefine((value, context) => {
  if (value.status === 'recognized' && (!value.canonicalTopic || !value.subject)) {
    context.addIssue({
      code: 'custom',
      path: ['canonicalTopic'],
      message: 'A recognized topic requires a canonical topic and subject.',
    })
  }
  if (value.status === 'needs_clarification' && !value.suggestions.length) {
    context.addIssue({
      code: 'custom',
      path: ['suggestions'],
      message: 'Clarification requires at least one suggested topic.',
    })
  }
})

export type TopicResolution = z.infer<typeof TopicResolutionSchema>

const generationFormatShape = {
  subject: z.string().trim().min(1).max(160),
  language: z.string().trim().min(1).max(80),
  selectedTopics: z.array(z.string().trim().min(1).max(160)).min(1).max(30),
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']),
  mcqCount: z.number().int().min(0).max(MAX_GENERATED_QUESTIONS),
  shortAnswerCount: z.number().int().min(0).max(MAX_GENERATED_QUESTIONS),
  mcqMarks: z.number().int().min(1).max(100),
  shortAnswerMarks: z.number().int().min(1).max(100),
} as const

export const SourceGenerationConfigSchema = z.object({
  mode: z.literal('sources'),
  sourceKind: z.enum(['notes', 'question_paper', 'mixed', 'unknown']),
  ...generationFormatShape,
})

export const TopicGenerationConfigSchema = z.object({
  mode: z.literal('topic'),
  examId: z.string().uuid(),
  examName: z.string().trim().min(2).max(120),
  requestedTopic: z.string().trim().min(2).max(160),
  canonicalTopic: z.string().trim().min(2).max(160),
  ...generationFormatShape,
})

const GenerationConfigUnionSchema = z.discriminatedUnion('mode', [
  SourceGenerationConfigSchema,
  TopicGenerationConfigSchema,
]).superRefine((value, context) => {
  if (value.shortAnswerCount !== 0) {
    context.addIssue({
      code: 'custom',
      path: ['shortAnswerCount'],
      message: 'Short-answer generation is temporarily disabled. Generate MCQs only.',
    })
  }
  const total = value.mcqCount + value.shortAnswerCount
  if (total < MIN_GENERATED_QUESTIONS || total > MAX_GENERATED_QUESTIONS) {
    context.addIssue({
      code: 'custom',
      path: ['mcqCount'],
      message: `Generate between ${MIN_GENERATED_QUESTIONS} and ${MAX_GENERATED_QUESTIONS} questions.`,
    })
  }
  if (value.mode === 'topic'
    && (value.selectedTopics.length !== 1 || value.selectedTopics[0] !== value.canonicalTopic)) {
    context.addIssue({
      code: 'custom',
      path: ['selectedTopics'],
      message: 'Topic generation must use the validated canonical topic.',
    })
  }
})

export const GenerationConfigSchema = z.preprocess(value => {
  if (value && typeof value === 'object' && !Array.isArray(value) && !('mode' in value)) {
    return { ...value, mode: 'sources' }
  }
  return value
}, GenerationConfigUnionSchema)

export type GenerationConfig = z.infer<typeof GenerationConfigSchema>

const SOURCE_DEPENDENT_PROMPT_PATTERNS = [
  /\baccording to\s+(?:the|this|that|a|an|given|provided|uploaded)\s+(?:source\s+|study\s+)?(?:material|passage|text|document|notes?|file|content)\b/i,
  /\b(?:in|from|within|based (?:on|upon))\s+(?:the|this|that|a|an|given|provided|uploaded)\s+(?:source\s+|study\s+)?(?:material|passage|text|document|notes?|file|content)\b/i,
  /\b(?:as\s+)?(?:stated|described|explained|mentioned|discussed|shown|outlined|defined)\s+(?:in|by)\s+(?:the|this|that|given|provided|uploaded)\s+(?:source\s+|study\s+)?(?:material|passage|text|document|notes?|file|content)\b/i,
  /\b(?:the|this|that|given|provided|uploaded|above|following)\s+(?:source\s+|study\s+)?(?:material|passage|text|document|notes?|file|content|diagram|figure|table|image)(?:['’]s)?\b/i,
] as const

export const STANDALONE_QUESTION_INSTRUCTION = [
  'Write every question as a direct, self-contained exam question for a learner who cannot see or identify the uploaded sources.',
  'Use the sources only as the factual basis: never refer to the material, passage, text, document, notes, file, diagram, or source in a question or option, and never use phrases such as "according to the material" or "as explained in the text".',
  'Ask about the underlying fact or concept directly and include any question-specific context needed to answer in the question itself.',
  'Keep source citations only in sourceReferences metadata; never expose filenames or source provenance in learner-facing question text or options.',
].join(' ')

export function isStandaloneQuestionPrompt(prompt: string) {
  return !SOURCE_DEPENDENT_PROMPT_PATTERNS.some(pattern => pattern.test(prompt))
}

const GeneratedQuestionBaseSchema = z.object({
  id: z.string().min(1).max(128),
  prompt: z.string().min(1).max(8000).refine(isStandaloneQuestionPrompt, {
    message: 'Question must be self-contained and must not refer to source material the learner cannot access.',
  }),
  topic: z.string().min(1).max(160),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  marks: z.number().int().min(1).max(100),
  answerOrigin: z.enum(['source_supported', 'model_inferred']),
  sourceReferences: z.array(SourceReferenceSchema).max(8),
})

function validateQuestionProvenance(
  value: { answerOrigin: 'source_supported' | 'model_inferred'; sourceReferences: SourceReference[] },
  context: z.RefinementCtx,
) {
  if (value.answerOrigin === 'source_supported' && !value.sourceReferences.length) {
    context.addIssue({
      code: 'custom',
      path: ['sourceReferences'],
      message: 'Source-supported answers require at least one source reference.',
    })
  }
}

export const GeneratedMcqSchema = GeneratedQuestionBaseSchema.extend({
  kind: z.literal('mcq'),
  options: z.array(z.string().min(1).max(2000)).length(4),
  correctAnswer: z.number().int().min(0).max(3),
  explanation: z.string().min(1).max(4000),
}).superRefine(validateQuestionProvenance)

export function shuffleMcqOptions<T extends { options: string[]; correctAnswer: number }>(
  content: T,
  random: () => number = Math.random,
): T {
  const options = content.options.map((option, originalIndex) => ({ option, originalIndex }))
  for (let index = options.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[options[index], options[target]] = [options[target], options[index]]
  }
  return {
    ...content,
    options: options.map(item => item.option),
    correctAnswer: options.findIndex(item => item.originalIndex === content.correctAnswer),
  }
}

export function repairGeneratedMcqContent(
  content: unknown,
  defaults: {
    id: string
    topic: string
    difficulty: 'easy' | 'medium' | 'hard'
    sourceReferences: SourceReference[]
  },
) {
  const raw = content && typeof content === 'object' && !Array.isArray(content)
    ? content as Record<string, unknown>
    : {}
  const sourceReferences = GeneratedQuestionBaseSchema.shape.sourceReferences.safeParse(raw.sourceReferences)
  return GeneratedMcqSchema.parse({
    ...raw,
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : defaults.id,
    topic: typeof raw.topic === 'string' && raw.topic.trim() ? raw.topic : defaults.topic,
    difficulty: raw.difficulty === 'easy' || raw.difficulty === 'medium' || raw.difficulty === 'hard'
      ? raw.difficulty
      : defaults.difficulty,
    answerOrigin: raw.answerOrigin === 'source_supported' || raw.answerOrigin === 'model_inferred'
      ? raw.answerOrigin
      : 'model_inferred',
    sourceReferences: sourceReferences.success ? sourceReferences.data : defaults.sourceReferences,
  })
}

export const RubricCriterionSchema = z.object({
  criterion: z.string().min(1).max(800),
  marks: z.number().int().min(1).max(100),
})

export const GeneratedShortAnswerSchema = GeneratedQuestionBaseSchema.extend({
  kind: z.literal('short_answer'),
  modelAnswer: z.string().min(1).max(8000),
  rubric: z.array(RubricCriterionSchema).min(1).max(12),
}).superRefine((value, context) => {
  validateQuestionProvenance(value, context)
  const rubricMarks = value.rubric.reduce((sum, item) => sum + item.marks, 0)
  if (rubricMarks !== value.marks) {
    context.addIssue({
      code: 'custom',
      path: ['rubric'],
      message: `Rubric marks (${rubricMarks}) must equal question marks (${value.marks}).`,
    })
  }
})

export const GeneratedQuestionSchema = z.discriminatedUnion('kind', [
  GeneratedMcqSchema,
  GeneratedShortAnswerSchema,
])

export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>

export const GeneratedTestSchema = z.object({
  titleSuggestion: z.string().min(1).max(180),
  descriptionSuggestion: z.string().max(1200),
  questions: z.array(GeneratedQuestionSchema).min(MIN_GENERATED_QUESTIONS).max(MAX_GENERATED_QUESTIONS),
}).superRefine((value, context) => {
  const ids = new Set<string>()
  for (const [index, question] of value.questions.entries()) {
    if (ids.has(question.id)) {
      context.addIssue({
        code: 'custom',
        path: ['questions', index, 'id'],
        message: 'Question IDs must be unique.',
      })
    }
    ids.add(question.id)
    if (question.kind === 'mcq' && new Set(question.options.map(option => option.trim().toLowerCase())).size !== 4) {
      context.addIssue({
        code: 'custom',
        path: ['questions', index, 'options'],
        message: 'MCQ options must be distinct.',
      })
    }
  }
})

export type GeneratedTest = z.infer<typeof GeneratedTestSchema>

export const GeneratedMcqTestSchema = z.object({
  titleSuggestion: z.string().min(1).max(180),
  descriptionSuggestion: z.string().max(1200),
  questions: z.array(GeneratedMcqSchema).min(MIN_GENERATED_QUESTIONS).max(MAX_GENERATED_QUESTIONS),
}).superRefine((value, context) => {
  const ids = new Set<string>()
  for (const [index, question] of value.questions.entries()) {
    if (ids.has(question.id)) {
      context.addIssue({
        code: 'custom',
        path: ['questions', index, 'id'],
        message: 'Question IDs must be unique.',
      })
    }
    ids.add(question.id)
    if (new Set(question.options.map(option => option.trim().toLowerCase())).size !== 4) {
      context.addIssue({
        code: 'custom',
        path: ['questions', index, 'options'],
        message: 'MCQ options must be distinct.',
      })
    }
  }
})

export const VerificationSchema = z.object({
  questions: z.array(z.object({
    questionId: z.string().min(1).max(128),
    status: z.enum(['supported', 'answer_inferred', 'unsupported']),
    confidence: z.number().min(0).max(1),
    issues: z.array(z.string().min(1).max(600)).max(12),
    suggestedFix: z.string().max(3000),
  })).min(1).max(MAX_GENERATED_QUESTIONS),
})

export type Verification = z.infer<typeof VerificationSchema>

export const SourceUploadSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  name: z.string().min(1).max(240),
  path: z.string().min(1).max(1200),
  mimeType: z.string().min(1).max(160),
  size: z.number().int().min(1).max(MAX_SOURCE_FILE_BYTES),
})

export type SourceUpload = z.infer<typeof SourceUploadSchema>

export const SourceBundleSchema = z.array(SourceUploadSchema).min(1).max(MAX_SOURCE_FILES).superRefine((sources, context) => {
  if (sources.reduce((sum, source) => sum + source.size, 0) > MAX_SOURCE_TOTAL_BYTES) {
    context.addIssue({ code: 'custom', message: 'Uploaded files exceed the 50 MB combined limit.' })
  }
  sources.forEach((source, index) => {
    if (!isAcceptedSource(source)) {
      context.addIssue({ code: 'custom', path: [index, 'name'], message: 'Unsupported file format.' })
    }
  })
})

export const PublishGeneratedTestSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(1200),
  examId: z.string().trim().min(1).max(160),
  categoryId: z.string().trim().min(1).max(240),
  durationMinutes: z.number().int().min(0).max(1440),
  visibility: z.enum(['public', 'private', 'assigned']),
})

export type PublishGeneratedTest = z.infer<typeof PublishGeneratedTestSchema>

export const generationStatuses = [
  'uploading',
  'analyzing',
  'analysis_ready',
  'generating',
  'verification_starting',
  'verifying',
  'review',
  'publishing',
  'published',
  'failed',
  'cancelled',
] as const

export type GenerationStatus = typeof generationStatuses[number]

const generationTransitions: Record<GenerationStatus, readonly GenerationStatus[]> = {
  uploading: ['analyzing', 'cancelled'],
  analyzing: ['analysis_ready', 'failed', 'cancelled'],
  analysis_ready: ['generating', 'cancelled'],
  generating: ['verification_starting', 'failed', 'cancelled'],
  verification_starting: ['verifying', 'failed', 'cancelled'],
  verifying: ['review', 'failed', 'cancelled'],
  review: ['publishing', 'cancelled'],
  publishing: ['published', 'failed'],
  failed: ['analyzing', 'generating', 'verifying', 'cancelled'],
  published: [],
  cancelled: [],
}

export function canTransitionGeneration(from: GenerationStatus, to: GenerationStatus) {
  return generationTransitions[from].includes(to)
}

export function extensionOf(filename: string) {
  return filename.split('.').pop()?.trim().toLowerCase() || ''
}

export function isAcceptedSource(upload: Pick<SourceUpload, 'name' | 'mimeType'>) {
  return (ACCEPTED_SOURCE_EXTENSIONS as readonly string[]).includes(extensionOf(upload.name))
    && ACCEPTED_SOURCE_MIME_TYPES.has(upload.mimeType.toLowerCase())
}

export function isImageSource(mimeType: string) {
  return mimeType.toLowerCase().startsWith('image/')
}

export function gifFrameCount(bytes: Uint8Array) {
  if (bytes.length < 13 || String.fromCharCode(...bytes.slice(0, 3)) !== 'GIF') return 0
  let offset = 13
  const globalTable = (bytes[10] & 0x80) !== 0
  if (globalTable) offset += 3 * 2 ** ((bytes[10] & 0x07) + 1)
  let frames = 0
  const skipBlocks = () => {
    while (offset < bytes.length) {
      const length = bytes[offset++]
      if (length === 0) break
      offset += length
    }
  }
  while (offset < bytes.length) {
    const marker = bytes[offset++]
    if (marker === 0x3b) break
    if (marker === 0x21) {
      offset += 1
      skipBlocks()
      continue
    }
    if (marker !== 0x2c || offset + 9 > bytes.length) return 0
    frames += 1
    const packed = bytes[offset + 8]
    offset += 9
    if ((packed & 0x80) !== 0) offset += 3 * 2 ** ((packed & 0x07) + 1)
    offset += 1
    skipBlocks()
  }
  return frames
}
