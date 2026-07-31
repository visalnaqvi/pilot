import assert from 'node:assert/strict'
import test from 'node:test'
import { questionSnapshot, scoreResponses, type CanonicalQuestion } from '../lib/submission-scoring'

const questions: CanonicalQuestion[] = [
  { id: 'one', kind: 'mcq', prompt: 'One?', options: ['A', 'B', 'C', 'D'], correctOption: 1, marks: 2 },
  { id: 'two', kind: 'short_answer', prompt: 'Explain.', modelAnswer: 'Because.', rubric: [{ criterion: 'Reason', marks: 4 }], marks: 4 },
]

test('mixed submissions expose an MCQ subtotal and pending marks', () => {
  const result = scoreResponses(questions, [
    { questionIndex: 0, answer: 1 },
    { questionIndex: 1, answer: 'A reason' },
  ])
  assert.equal(result.mcqScore, 2)
  assert.equal(result.mcqMarks, 2)
  assert.equal(result.pendingMarks, 4)
  assert.equal(result.gradingStatus, 'pending')
  assert.equal(result.score, null)
  assert.equal('correctAnswer' in result.publicAnswers[0], false)
  assert.equal(result.publicAnswers[1].kind, 'short_answer')
})

test('MCQ-only submissions receive an immediate final score', () => {
  const result = scoreResponses([questions[0]], [{ questionIndex: 0, answer: 0 }])
  assert.equal(result.score, 0)
  assert.equal(result.gradingStatus, 'not_required')
  assert.equal(result.pendingMarks, 0)
})

test('question snapshots omit optional undefined values', () => {
  const snapshot = questionSnapshot({
    id: 'without-explanation',
    kind: 'mcq',
    prompt: 'One?',
    options: ['A', 'B'],
    correctOption: 0,
    explanation: undefined,
    modelAnswer: undefined,
    rubric: undefined,
    marks: 1,
    answerOrigin: undefined,
  })

  assert.deepEqual(snapshot, {
    id: 'without-explanation',
    kind: 'mcq',
    prompt: 'One?',
    marks: 1,
    options: ['A', 'B'],
    correctOption: 0,
  })
})
