import assert from 'node:assert/strict'
import test from 'node:test'
import { appBaseUrl } from '../lib/app-url'

test('Vercel production custom domain takes precedence in email links', () => {
  assert.equal(appBaseUrl({
    APP_BASE_URL: 'https://pilot-o319cupjf-visalnaqvis-projects.vercel.app',
    VERCEL_PROJECT_PRODUCTION_URL: 'pilotdesk.in',
    VERCEL_URL: 'pilot-preview.vercel.app',
  }), 'https://pilotdesk.in')
})

test('configured app URL remains available outside Vercel', () => {
  assert.equal(appBaseUrl({
    APP_BASE_URL: 'https://example.com/app/',
  }), 'https://example.com/app')
})

test('app URL falls back to localhost for local development', () => {
  assert.equal(appBaseUrl({}), 'http://localhost:3000')
})
