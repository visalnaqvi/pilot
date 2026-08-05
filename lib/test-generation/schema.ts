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

export const GenerationConfigSchema = z.object({
  sourceKind: z.enum(['notes', 'question_paper', 'mixed', 'unknown']),
  subject: z.string().trim().min(1).max(160),
  language: z.string().trim().min(1).max(80),
  selectedTopics: z.array(z.string().trim().min(1).max(160)).min(1).max(30),
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']),
  mcqCount: z.number().int().min(0).max(MAX_GENERATED_QUESTIONS),
  shortAnswerCount: z.number().int().min(0).max(MAX_GENERATED_QUESTIONS),
  mcqMarks: z.number().int().min(1).max(100),
  shortAnswerMarks: z.number().int().min(1).max(100),
}).superRefine((value, context) => {
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
})

export type GenerationConfig = z.infer<typeof GenerationConfigSchema>

const GeneratedQuestionBaseSchema = z.object({
  id: z.string().min(1).max(128),
  prompt: z.string().min(1).max(8000),
  topic: z.string().min(1).max(160),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  marks: z.number().int().min(1).max(100),
  answerOrigin: z.enum(['source_supported', 'model_inferred']),
  sourceReferences: z.array(SourceReferenceSchema).min(1).max(8),
})

export const GeneratedMcqSchema = GeneratedQuestionBaseSchema.extend({
  kind: z.literal('mcq'),
  options: z.array(z.string().min(1).max(2000)).length(4),
  correctAnswer: z.number().int().min(0).max(3),
  explanation: z.string().min(1).max(4000),
})

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
