import { z } from 'zod'
import { RubricCriterionSchema, SourceReferenceSchema } from './test-generation/schema'

const QuestionVisualsSchema = z.object({
  format: z.enum(['plain', 'equation', 'image']).optional(),
  promptImageUrl: z.string().optional(),
  optionImageUrls: z.array(z.string()).optional(),
})

export const McqQuestionContentSchema = QuestionVisualsSchema.extend({
  kind: z.literal('mcq').default('mcq'),
  prompt: z.string().min(1),
  options: z.array(z.string().min(1)).length(4),
  correctAnswer: z.number().int().min(0).max(3),
  explanation: z.string().optional(),
  answerOrigin: z.enum(['source_supported', 'model_inferred']).optional(),
  sourceReferences: z.array(SourceReferenceSchema).optional(),
})

export const ShortAnswerQuestionContentSchema = QuestionVisualsSchema.extend({
  kind: z.literal('short_answer'),
  prompt: z.string().min(1),
  modelAnswer: z.string().min(1),
  rubric: z.array(RubricCriterionSchema).min(1),
  answerOrigin: z.enum(['source_supported', 'model_inferred']).optional(),
  sourceReferences: z.array(SourceReferenceSchema).optional(),
})

export const QuestionContentSchema = z.union([
  McqQuestionContentSchema,
  ShortAnswerQuestionContentSchema,
])

export type McqQuestionContent = z.infer<typeof McqQuestionContentSchema>
export type ShortAnswerQuestionContent = z.infer<typeof ShortAnswerQuestionContentSchema>
export type QuestionContentV3 = z.infer<typeof QuestionContentSchema>

export type LearnerQuestionContent =
  | Omit<McqQuestionContent, 'correctAnswer' | 'explanation' | 'answerOrigin' | 'sourceReferences'>
  | Omit<ShortAnswerQuestionContent, 'modelAnswer' | 'rubric' | 'answerOrigin' | 'sourceReferences'>

export function isShortAnswerQuestion(
  question: { kind?: string },
): question is ShortAnswerQuestionContent {
  return question.kind === 'short_answer'
}

export function publicQuestionFields(question: QuestionContentV3) {
  if (isShortAnswerQuestion(question)) {
    return {
      kind: 'short_answer' as const,
      prompt: question.prompt,
      format: question.format || 'plain',
      promptImageUrl: question.promptImageUrl || '',
    }
  }
  return {
    kind: 'mcq' as const,
    prompt: question.prompt,
    options: question.options,
    format: question.format || 'plain',
    promptImageUrl: question.promptImageUrl || '',
    optionImageUrls: question.optionImageUrls || ['', '', '', ''],
  }
}

export function privateQuestionFields(question: QuestionContentV3) {
  if (isShortAnswerQuestion(question)) {
    return {
      kind: 'short_answer' as const,
      modelAnswer: question.modelAnswer,
      rubric: question.rubric,
      answerOrigin: question.answerOrigin || 'source_supported',
      sourceReferences: question.sourceReferences || [],
    }
  }
  return {
    kind: 'mcq' as const,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation || '',
    answerOrigin: question.answerOrigin || 'source_supported',
    sourceReferences: question.sourceReferences || [],
  }
}

export function mergeQuestionFields(
  publicData: Record<string, unknown>,
  privateData?: Record<string, unknown> | null,
): QuestionContentV3 | null {
  const legacyKind = publicData.kind === 'short_answer' ? 'short_answer' : 'mcq'
  const candidate = {
    ...publicData,
    ...(privateData || {}),
    kind: privateData?.kind || legacyKind,
  }
  const parsed = QuestionContentSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}
