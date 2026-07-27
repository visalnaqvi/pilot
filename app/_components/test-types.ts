export type QuestionFormat = 'plain' | 'equation' | 'image'
export type QuestionContent = {
  prompt: string
  options: string[]
  correctAnswer: number
  format?: QuestionFormat
  promptImageUrl?: string
  optionImageUrls?: string[]
}
export type Question = QuestionContent & { marks: number }
export type QuestionBankItem = QuestionContent & {
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
  createdAt?: { toDate: () => Date } | null
  visibility: 'public' | 'private' | 'assigned'
  /** Legacy field retained while old test records are read. Private tests now have unlimited attempts. */
  attemptLimit?: number
  /** Unpublished tests are visible only to their creator and admins. */
  published?: boolean
  publishedAt?: unknown | null
  organisationId?: string
  deletedAt?: unknown | null
  deletedBy?: string | null
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
  totalMarks: number
  correctAnswers: number
  questionCount: number
  /** Immutable per-question snapshot saved when the learner submits a test. */
  answers?: SubmissionAnswer[]
  /** Organisations the user belonged to when they submitted the test. */
  organisationIds: string[]
  /** True when the platform submitted the attempt instead of the learner. */
  autoSubmitted?: boolean
  autoSubmitReason?: 'time_expired' | 'fullscreen_exited'
  testVisibility?: 'public' | 'private' | 'assigned'
  attemptNumber?: number
  assignmentBatchId?: string
  submittedAt?: { toDate: () => Date }
}

export type SubmissionAnswer = {
  questionIndex: number
  prompt: string
  options: string[]
  selectedAnswer: number | null
  correctAnswer: number
  isCorrect: boolean
  marks: number
}
