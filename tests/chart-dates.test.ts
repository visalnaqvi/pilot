import assert from 'node:assert/strict'
import test from 'node:test'
import { chartDateKey, sortedChartDateKeys } from '../lib/chart-dates'

test('chart dates use sortable local calendar keys', () => {
  assert.equal(chartDateKey(new Date(2026, 7, 5, 23, 30)), '2026-08-05')
  assert.equal(chartDateKey(new Date(2025, 0, 2)), '2025-01-02')
})

test('chart date axes are chronological regardless of insertion order', () => {
  const keys = new Map([
    ['2026-08-05', 1],
    ['2025-12-31', 2],
    ['2026-01-02', 3],
  ]).keys()

  assert.deepEqual(sortedChartDateKeys(keys), ['2025-12-31', '2026-01-02', '2026-08-05'])
})

test('invalid chart dates are omitted', () => {
  assert.equal(chartDateKey(new Date('not-a-date')), '')
  assert.deepEqual(sortedChartDateKeys(['2026-01-02', '', '2026-01-01']), ['2026-01-01', '2026-01-02'])
})
