import test from 'node:test'
import assert from 'node:assert/strict'
import { zodTextFormat } from 'openai/helpers/zod'
import {
  emptyExamCycle,
  HttpUrlSchema,
  isStale,
  sectionsEqual,
  sortSchedule,
  stableJson,
} from '../lib/exam-information'
import {
  canonicalSourceUrl,
  ExamWebRefreshSchema,
  validateRefreshEvidence,
} from '../lib/exam-refresh/schema'

test('stableJson and sectionsEqual ignore object key insertion order', () => {
  assert.equal(stableJson({ b: 2, a: 1 }), '{"a":1,"b":2}')
  assert.equal(sectionsEqual({ b: [2, 3], a: 1 }, { a: 1, b: [2, 3] }), true)
})

test('emptyExamCycle derives the year and safe empty values', () => {
  const cycle = emptyExamCycle('2026', 'Exam 2026')
  assert.equal(cycle.year, 2026)
  assert.equal(cycle.overview.status, 'not_announced')
  assert.deepEqual(cycle.schedule.events, [])
  assert.deepEqual(cycle.syllabus.groups, [])
})

test('schedule sorting places exact dates before unannounced events', () => {
  const events = sortSchedule([
    { id: 'later', type: 'exam', label: 'Main', stage: null, startDate: '2026-09-10', endDate: null, dateText: null, precision: 'exact', status: 'confirmed' },
    { id: 'tba', type: 'result', label: 'Result', stage: null, startDate: null, endDate: null, dateText: null, precision: 'tba', status: 'tentative' },
    { id: 'first', type: 'application_open', label: 'Applications', stage: null, startDate: '2026-02-01', endDate: null, dateText: null, precision: 'exact', status: 'confirmed' },
  ])
  assert.deepEqual(events.map((event) => event.id), ['first', 'later', 'tba'])
})

test('staleness treats missing and old checks as stale', () => {
  assert.equal(isStale(null), true)
  assert.equal(isStale(new Date()), false)
  assert.equal(isStale(new Date(Date.now() - 4 * 86_400_000)), true)
})

test('HTTP URL validation remains compatible with exam web refresh structured outputs', () => {
  assert.equal(HttpUrlSchema.safeParse('https://example.com/notice.pdf').success, true)
  assert.equal(HttpUrlSchema.safeParse('not a URL').success, false)
  assert.equal(HttpUrlSchema.safeParse('file:///private/notice.pdf').success, false)

  const schema = zodTextFormat(ExamWebRefreshSchema, 'exam_web_refresh').schema
  assert.equal(JSON.stringify(schema).includes('"format":"uri"'), false)
})

test('refresh evidence validation requires consulted citations for changed facts', () => {
  const before = { officialName: 'Existing name', conductingBody: null, summary: null, status: 'announced', applicationMethod: null, vacanciesLabel: null }
  const after = { ...before, summary: 'Applications open on 1 February 2026.' }
  const url = 'https://exams.gov.in/notice'
  assert.doesNotThrow(() => validateRefreshEvidence({
    section: 'overview',
    before,
    after,
    claims: [{
      fieldPath: '/overview/summary',
      sourceUrl: url,
      sourceTitle: 'Official notice',
      sourceKind: 'official',
      claim: 'Applications open on 1 February 2026.',
    }],
    consultedUrls: new Set([canonicalSourceUrl(url)]),
  }))
})

test('refresh evidence validation rejects URLs not returned by web search', () => {
  assert.throws(() => validateRefreshEvidence({
    section: 'schedule',
    before: { events: [] },
    after: { events: [{ id: 'exam', label: 'Exam', startDate: '2026-06-01' }] },
    claims: [{
      fieldPath: '/schedule/events',
      sourceUrl: 'https://unconsulted.example/exam',
      sourceTitle: 'Unconsulted page',
      sourceKind: 'secondary',
      claim: 'The examination is scheduled for 1 June 2026.',
    }],
    consultedUrls: new Set([canonicalSourceUrl('https://official.example/notice')]),
  }), /not returned by web search/)
})

test('one cited field covers structural values in the same array item', () => {
  const url = 'https://official.example/schedule'
  assert.doesNotThrow(() => validateRefreshEvidence({
    section: 'schedule',
    before: { events: [] },
    after: { events: [{ id: 'exam', type: 'exam', label: 'Main exam', startDate: '2026-06-01', precision: 'exact', status: 'confirmed' }] },
    claims: [{
      fieldPath: '/schedule/events/0/startDate',
      sourceUrl: url,
      sourceTitle: 'Official schedule',
      sourceKind: 'official',
      claim: 'The main examination will be held on 1 June 2026.',
    }],
    consultedUrls: new Set([canonicalSourceUrl(url)]),
  }))
})

test('stable IDs prevent inserted schedule events from making later events look changed', () => {
  const url = 'https://official.example/schedule'
  const existing = { id: 'result', type: 'result', label: 'Result', startDate: null, dateText: 'July 2026', precision: 'month', status: 'tentative' }
  const added = { id: 'answer-key', type: 'answer_key', label: 'Answer key', startDate: '2026-06-20', dateText: null, precision: 'exact', status: 'confirmed' }
  assert.doesNotThrow(() => validateRefreshEvidence({
    section: 'schedule',
    before: { events: [existing] },
    after: { events: [added, existing] },
    claims: [{
      fieldPath: '/schedule/events/0/startDate',
      sourceUrl: url,
      sourceTitle: 'Official schedule',
      sourceKind: 'official',
      claim: 'The answer key was released on 20 June 2026.',
    }],
    consultedUrls: new Set([canonicalSourceUrl(url)]),
  }))
})
