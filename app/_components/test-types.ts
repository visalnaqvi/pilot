export type QuestionFormat = 'plain' | 'equation' | 'image'
export type QuestionContent = {
  prompt: string
  options: string[]
  correctAnswer: number
  format?: QuestionFormat
  promptImageUrl?: string
  optionImageUrls?: string[]
  promptImagePath?: string
  optionImagePaths?: string[]
}
export type Question = QuestionContent & { marks: number }
export type LearnerQuestion =
  | {
      kind: 'mcq'
      prompt: string
      options: string[]
      marks: number
      format?: QuestionFormat
      promptImageUrl?: string
      optionImageUrls?: string[]
    }
  | {
      kind: 'short_answer'
      prompt: string
      marks: number
      format?: QuestionFormat
      promptImageUrl?: string
    }
export type QuestionBankItem = QuestionContent & {
  kind?: 'mcq' | 'short_answer'
  id: string
  createdBy: string
  visibility: 'public' | 'private'
  organisationId?: string
  archivedAt?: unknown | null
  revision: number
}

export type TestQuestion = {
  id: string
  questionId: string
  position: number
  marks: number
  /** Old memberships may retain a fallback snapshot while they are migrated. */
  snapshot?: QuestionContent & { revision: number }
}

export type MockTest = {
  id: string
  title: string
  /** Optional only for tests created before exams and categories were introduced. */
  exam?: string
  examId?: string
  examAlias?: string
  category?: string
  categoryId?: string
  description: string
  durationMinutes: number
  /** Present only on records created before the question-bank migration. */
  questions?: Question[]
  questionCount?: number
  totalMarks?: number
  createdBy: string
  createdAt?: { toDate: () => Date } | string | null
  visibility: 'public' | 'private' | 'assigned'
  /** Legacy field retained while old test records are read. Private tests now have unlimited attempts. */
  attemptLimit?: number
  /** Unpublished tests are visible only to their creator and admins. */
  published?: boolean
  publishedAt?: unknown | null
  organisationId?: string
  deletedAt?: unknown | null
  deletedBy?: string | null
  origin?: 'ai_generated'
  generationJobId?: string
}

export type Submission = {
  id: string
  userId: string
  userEmail: string
  userName?: string
  testId: string
  testTitle: string
  testExam?: string
  testExamId?: string
  testCategory: string
  score: number
  gradingStatus?: 'not_required' | 'pending' | 'graded'
  mcqScore?: number
  mcqMarks?: number
  pendingMarks?: number
  totalMarks: number
  correctAnswers: number
  questionCount: number
  /** Immutable per-question snapshot saved when the learner submits a test. */
  answers?: SubmissionAnswer[]
  /** True when the platform submitted the attempt instead of the learner. */
  autoSubmitted?: boolean
  autoSubmitReason?: 'time_expired' | 'fullscreen_exited'
  testVisibility?: 'public' | 'private' | 'assigned'
  attemptNumber?: number
  assignmentBatchId?: string
  /** Derived from relational access rows for filtering; it is not persisted as an array. */
  organizationIds?: string[]
  submittedAt?: { toDate: () => Date } | string
}

export type SubmissionAnswer = {
  id?: string
  kind?: 'mcq' | 'short_answer'
  questionIndex: number
  prompt: string
  options?: string[]
  selectedAnswer?: number | null
  correctAnswer?: number
  isCorrect?: boolean
  response?: string
  modelAnswer?: string
  rubric?: Array<{ criterion: string; marks: number }>
  awardedMarks?: number
  feedback?: string
  gradingStatus?: 'pending' | 'graded'
  explanation?: string
  answerOrigin?: 'source_supported' | 'model_inferred'
  marks: number
}
