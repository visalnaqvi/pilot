import assert from 'node:assert/strict'
import test from 'node:test'
import { paginate } from '../app/_components/pagination'

test('paginate returns the requested slice and range metadata', () => {
  const result = paginate(Array.from({ length: 23 }, (_, index) => index + 1), 2, 10)

  assert.deepEqual(result.items, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  assert.equal(result.page, 2)
  assert.equal(result.totalPages, 3)
  assert.equal(result.startIndex, 10)
  assert.equal(result.endIndex, 20)
})

test('paginate clamps stale pages after a collection shrinks', () => {
  const result = paginate(['a', 'b', 'c'], 8, 2)

  assert.deepEqual(result.items, ['c'])
  assert.equal(result.page, 2)
  assert.equal(result.totalPages, 2)
})

test('paginate handles empty collections and invalid page sizes safely', () => {
  const result = paginate([], -4, 0)

  assert.deepEqual(result.items, [])
  assert.equal(result.page, 1)
  assert.equal(result.pageSize, 1)
  assert.equal(result.totalPages, 1)
})
