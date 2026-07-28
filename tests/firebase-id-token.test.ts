import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'
import { verifyFirebaseIdTokenWithCertificates } from '../lib/firebase-id-token'

const projectId = 'test-project'
const keyId = 'test-key'
const now = 2_000_000_000
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

function token(overrides: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: keyId })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: 'user-123',
    exp: now + 3_600,
    iat: now - 60,
    auth_time: now - 120,
    email: 'user@example.com',
    name: 'Test User',
    ...overrides,
  })).toString('base64url')
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')
  return `${header}.${payload}.${signature}`
}

test('Firebase token verification accepts a valid signed token', () => {
  assert.deepEqual(
    verifyFirebaseIdTokenWithCertificates(token(), projectId, { [keyId]: publicKeyPem }, now),
    { uid: 'user-123', email: 'user@example.com', name: 'Test User' },
  )
})

test('Firebase token verification rejects another project', () => {
  assert.throws(
    () => verifyFirebaseIdTokenWithCertificates(token({ aud: 'other-project' }), projectId, { [keyId]: publicKeyPem }, now),
    /another Firebase project/,
  )
})

test('Firebase token verification rejects expired tokens', () => {
  assert.throws(
    () => verifyFirebaseIdTokenWithCertificates(token({ exp: now }), projectId, { [keyId]: publicKeyPem }, now),
    /expired/,
  )
})

test('Firebase token verification rejects a modified signature', () => {
  const value = token()
  const modified = `${value.slice(0, -1)}${value.endsWith('A') ? 'B' : 'A'}`
  assert.throws(
    () => verifyFirebaseIdTokenWithCertificates(modified, projectId, { [keyId]: publicKeyPem }, now),
    /signature/,
  )
})
