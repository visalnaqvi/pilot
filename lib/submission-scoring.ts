import { z } from 'zod'

export const SubmissionResponseSchema = z.object({
  questionIndex: z.number().int().min(0),
  answer: z.union([z.number().int().min(0).max(3), z.string().trim().max(10_000), z.null()]),
})

export const SubmitTestSchema = z.object({
  testId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  assignmentBatchId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/).optional(),
  responses: z.array(SubmissionResponseSchema).max(50),
  autoSubmitReason: z.enum(['time_expired', 'fullscreen_exited']).optional(),
})

export type CanonicalQuestion = {
  id: string
  kind: 'mcq' | 'short_answer'
  prompt: string
  options?: string[]
  correctOption?: number
  explanation?: string
  modelAnswer?: string
  rubric?: Array<{ criterion: string; marks: number }>
  marks: number
  answerOrigin?: 'source_supported' | 'model_inferred'
}

export function scoreResponses(
  questions: CanonicalQuestion[],
  responses: Array<z.infer<typeof SubmissionResponseSchema>>,
) {
  const byIndex = new Map(responses.map(response => [response.questionIndex, response.answer]))
  let mcqScore = 0
  let mcqMarks = 0
  let correctAnswers = 0
  let pendingMarks = 0

  const publicAnswers = questions.map((question, questionIndex) => {
    const answer = byIndex.get(questionIndex) ?? null
    if (question.kind === 'short_answer') {
      pendingMarks += question.marks
      return {
        kind: 'short_answer' as const,
        questionIndex,
        prompt: question.prompt,
        response: typeof answer === 'string' ? answer : '',
        marks: question.marks,
        gradingStatus: 'pending' as const,
      }
    }
    mcqMarks += question.marks
    const selectedAnswer = typeof answer === 'number' ? answer : null
    const isCorrect = selectedAnswer === question.correctOption
    if (isCorrect) {
      mcqScore += question.marks
      correctAnswers += 1
    }
    return {
      kind: 'mcq' as const,
      questionIndex,
      prompt: question.prompt,
      options: question.options || [],
      selectedAnswer,
      marks: question.marks,
    }
  })

  return {
    publicAnswers,
    mcqScore,
    mcqMarks,
    pendingMarks,
    correctAnswers,
    gradingStatus: pendingMarks > 0 ? 'pending' as const : 'not_required' as const,
    score: pendingMarks > 0 ? null : mcqScore,
  }
}
