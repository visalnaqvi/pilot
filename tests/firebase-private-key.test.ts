import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeFirebasePrivateKey } from '../lib/firebase-private-key'

const privateKey = [
  '-----BEGIN PRIVATE KEY-----',
  'example-key-material',
  '-----END PRIVATE KEY-----',
].join('\n')

test('private-key normalization supports escaped newlines', () => {
  assert.equal(normalizeFirebasePrivateKey(privateKey.replace(/\n/g, '\\n')), privateKey)
})

test('private-key normalization supports escaped CRLF and wrapping quotes', () => {
  assert.equal(normalizeFirebasePrivateKey(`"${privateKey.replace(/\n/g, '\\r\\n')}"`), privateKey)
})

test('private-key normalization preserves real multiline values', () => {
  assert.equal(normalizeFirebasePrivateKey(`\r\n${privateKey.replace(/\n/g, '\r\n')}\r\n`), privateKey)
})

test('private-key normalization treats blank values as missing', () => {
  assert.equal(normalizeFirebasePrivateKey('   '), undefined)
  assert.equal(normalizeFirebasePrivateKey(undefined), undefined)
})
