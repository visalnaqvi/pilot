import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldUseStandardTestEditor } from '../lib/test-editing'

test('published AI-generated tests use the standard test editor', () => {
  assert.equal(shouldUseStandardTestEditor({ origin: 'ai_generated', published: true }), true)
})

test('unpublished AI-generated drafts stay in the review workflow', () => {
  assert.equal(shouldUseStandardTestEditor({ origin: 'ai_generated', published: false }), false)
})

test('regular tests use the standard editor regardless of publication state', () => {
  assert.equal(shouldUseStandardTestEditor({ published: true }), true)
  assert.equal(shouldUseStandardTestEditor({ published: false }), true)
})
