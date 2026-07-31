import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GeneratedQuestionSchema,
  GeneratedMcqTestSchema,
  GeneratedTestSchema,
  GenerationConfigSchema,
  MAX_SOURCE_FILE_BYTES,
  SourceBundleSchema,
  SourceReferenceSchema,
  VerificationSchema,
  canTransitionGeneration,
  repairGeneratedMcqContent,
} from '../lib/test-generation/schema'

const reference = {
  sourceId: 'source-1',
  filename: 'biology.pdf',
  locator: 'page 4',
  excerpt: 'Mitochondria release usable energy from nutrients.',
}

const mcq = (id: string) => ({
  id,
  kind: 'mcq' as const,
  prompt: 'Which organelle is associated with cellular respiration?',
  options: ['Mitochondrion', 'Ribosome', 'Golgi apparatus', 'Nucleus'],
  correctAnswer: 0,
  explanation: 'The cited notes identify the mitochondrion.',
  marks: 1,
  difficulty: 'easy' as const,
  topic: 'Cell biology',
  answerOrigin: 'source_supported' as const,
  sourceReferences: [reference],
})

test('source bundles enforce type, count, per-file, and combined limits', () => {
  assert.equal(SourceBundleSchema.safeParse([{
    id: 'one',
    name: 'notes.pdf',
    path: 'test-generation-sources/org/job/notes.pdf',
    mimeType: 'application/pdf',
    size: 1_000,
  }]).success, true)
  assert.equal(SourceBundleSchema.safeParse([{
    id: 'one',
    name: 'notes.exe',
    path: 'private/source',
    mimeType: 'application/octet-stream',
    size: 1_000,
  }]).success, false)
  assert.equal(SourceBundleSchema.safeParse(Array.from({ length: 6 }, (_, index) => ({
    id: `file-${index}`,
    name: `${index}.pdf`,
    path: `private/${index}`,
    mimeType: 'application/pdf',
    size: 1_000,
  }))).success, false)
  assert.equal(SourceBundleSchema.safeParse([{
    id: 'large',
    name: 'large.pdf',
    path: 'private/large',
    mimeType: 'application/pdf',
    size: MAX_SOURCE_FILE_BYTES + 1,
  }]).success, false)
  assert.equal(SourceBundleSchema.safeParse(Array.from({ length: 3 }, (_, index) => ({
    id: `large-${index}`,
    name: `${index}.pdf`,
    path: `private/${index}`,
    mimeType: 'application/pdf',
    size: 18 * 1024 * 1024,
  }))).success, false)
})

test('generation configuration requires 5 to 50 total questions', () => {
  const base = {
    sourceKind: 'notes' as const,
    subject: 'Biology',
    language: 'English',
    selectedTopics: ['Cells'],
    difficulty: 'mixed' as const,
    mcqMarks: 1,
    shortAnswerMarks: 5,
  }
  assert.equal(GenerationConfigSchema.safeParse({ ...base, mcqCount: 4, shortAnswerCount: 0 }).success, false)
  assert.equal(GenerationConfigSchema.safeParse({ ...base, mcqCount: 20, shortAnswerCount: 0 }).success, true)
  assert.equal(GenerationConfigSchema.safeParse({ ...base, mcqCount: 15, shortAnswerCount: 5 }).success, false)
  assert.equal(GenerationConfigSchema.safeParse({ ...base, mcqCount: 50, shortAnswerCount: 1 }).success, false)
})

test('generated MCQs have four distinct options and valid inference labels', () => {
  assert.equal(GeneratedQuestionSchema.safeParse(mcq('q1')).success, true)
  assert.equal(GeneratedQuestionSchema.safeParse({ ...mcq('q1'), options: ['A', 'A', 'B', 'C'] }).success, true)
  assert.equal(GeneratedQuestionSchema.safeParse({ ...mcq('q1'), options: ['A', 'B', 'C'] }).success, false)
  assert.equal(GeneratedQuestionSchema.safeParse({ ...mcq('q1'), answerOrigin: 'guessed' }).success, false)
  assert.equal(GeneratedTestSchema.safeParse({
    titleSuggestion: 'Cells',
    descriptionSuggestion: '',
    questions: [mcq('q1'), { ...mcq('q2'), options: ['A', 'A', 'B', 'C'] }, mcq('q3'), mcq('q4'), mcq('q5')],
  }).success, false)
})

test('damaged edited MCQs recover required generated metadata before publication', () => {
  assert.deepEqual(
    repairGeneratedMcqContent({
      kind: 'mcq',
      prompt: 'Which organelle is associated with cellular respiration?',
      options: ['Mitochondrion', 'Ribosome', 'Golgi apparatus', 'Nucleus'],
      correctAnswer: 0,
      explanation: 'The mitochondrion releases usable energy.',
      marks: 1,
    }, {
      id: 'q1',
      topic: 'Cell biology',
      difficulty: 'medium',
      sourceReferences: [reference],
    }),
    {
      id: 'q1',
      kind: 'mcq',
      prompt: 'Which organelle is associated with cellular respiration?',
      options: ['Mitochondrion', 'Ribosome', 'Golgi apparatus', 'Nucleus'],
      correctAnswer: 0,
      explanation: 'The mitochondrion releases usable energy.',
      marks: 1,
      topic: 'Cell biology',
      difficulty: 'medium',
      answerOrigin: 'model_inferred',
      sourceReferences: [reference],
    },
  )
})

test('the active generation response accepts MCQs only', () => {
  assert.equal(GeneratedMcqTestSchema.safeParse({
    titleSuggestion: 'Cells',
    descriptionSuggestion: '',
    questions: Array.from({ length: 5 }, (_, index) => mcq(`q${index + 1}`)),
  }).success, true)
  assert.equal(GeneratedMcqTestSchema.safeParse({
    titleSuggestion: 'Cells',
    descriptionSuggestion: '',
    questions: [
      ...Array.from({ length: 4 }, (_, index) => mcq(`q${index + 1}`)),
      {
        kind: 'short_answer',
        id: 'q5',
        prompt: 'Explain cells.',
        topic: 'Cells',
        difficulty: 'medium',
        marks: 2,
        answerOrigin: 'source_supported',
        sourceReferences: [{ sourceId: 'source-1', filename: 'notes.pdf', locator: 'page 1' }],
        modelAnswer: 'Cells are the basic unit of life.',
        rubric: [{ criterion: 'Definition', marks: 2 }],
      },
    ],
  }).success, false)
})

test('short-answer rubric marks must equal the question marks', () => {
  const short = {
    id: 'short-1',
    kind: 'short_answer' as const,
    prompt: 'Explain cellular respiration.',
    modelAnswer: 'Cells convert nutrient energy into ATP.',
    rubric: [{ criterion: 'Mentions ATP', marks: 2 }],
    marks: 3,
    difficulty: 'medium' as const,
    topic: 'Cells',
    answerOrigin: 'model_inferred' as const,
    sourceReferences: [reference],
  }
  assert.equal(GeneratedQuestionSchema.safeParse(short).success, false)
  assert.equal(GeneratedQuestionSchema.safeParse({ ...short, rubric: [{ criterion: 'Mentions ATP', marks: 3 }] }).success, true)
})

test('source references and verifier blocking states are structured', () => {
  assert.equal(SourceReferenceSchema.safeParse(reference).success, true)
  assert.equal(SourceReferenceSchema.safeParse({ ...reference, locator: '' }).success, false)
  assert.equal(VerificationSchema.safeParse({
    questions: [{ questionId: 'q1', status: 'unsupported', confidence: 0.2, issues: ['No cited support'], suggestedFix: 'Remove it.' }],
  }).success, true)
})

test('generation state transitions reject skipped or terminal-stage moves', () => {
  assert.equal(canTransitionGeneration('uploading', 'analyzing'), true)
  assert.equal(canTransitionGeneration('analyzing', 'review'), false)
  assert.equal(canTransitionGeneration('failed', 'verifying'), true)
  assert.equal(canTransitionGeneration('published', 'review'), false)
  assert.equal(canTransitionGeneration('cancelled', 'analyzing'), false)
})
