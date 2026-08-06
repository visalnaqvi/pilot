import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EMAIL_ALREADY_VERIFIED_CODE,
  EMAIL_NOT_VERIFIED_CODE,
  VERIFICATION_EMAIL_COOLDOWN_CODE,
  hasVerifiedEmail,
  pendingDisplayNameKey,
  verificationActionUrl,
  verificationErrorMessage,
  verificationRetryAfterSeconds,
} from '../lib/email-verification'
import { resolveBrandConfig } from '../lib/branding'
import { resolveEmailSender } from '../lib/email-sender'
import { buildVerificationEmail } from '../lib/verification-email-content'

test('email verification requires an explicitly verified claim', () => {
  assert.equal(hasVerifiedEmail({ emailVerified: true }), true)
  assert.equal(hasVerifiedEmail({ emailVerified: false }), false)
  assert.equal(hasVerifiedEmail({}), false)
  assert.equal(EMAIL_NOT_VERIFIED_CODE, 'EMAIL_NOT_VERIFIED')
  assert.equal(EMAIL_ALREADY_VERIFIED_CODE, 'EMAIL_ALREADY_VERIFIED')
  assert.equal(VERIFICATION_EMAIL_COOLDOWN_CODE, 'VERIFICATION_EMAIL_COOLDOWN')
  assert.equal(pendingDisplayNameKey('user-123'), 'mockpilot-pending-display-name:user-123')
})

test('email sender settings prefer branch config and fall back independently', () => {
  const configured = resolveBrandConfig({
    name: 'Example Academy',
    email: { fromAddress: 'client@example.edu', fromName: 'Client Accounts' },
  })
  assert.deepEqual(resolveEmailSender(configured, {
    EMAIL_FROM_ADDRESS: 'fallback@example.com',
    EMAIL_FROM_NAME: 'Fallback Name',
  }), {
    address: 'client@example.edu',
    name: 'Client Accounts',
  })

  const addressFallback = resolveBrandConfig({ name: 'Example Academy', email: { fromName: 'Client Accounts' } })
  assert.deepEqual(resolveEmailSender(addressFallback, {
    EMAIL_FROM_ADDRESS: ' fallback@example.com ',
    EMAIL_FROM_NAME: 'Fallback Name',
  }), {
    address: 'fallback@example.com',
    name: 'Client Accounts',
  })

  const environmentFallback = resolveBrandConfig({ name: 'Example Academy' })
  assert.deepEqual(resolveEmailSender(environmentFallback, { EMAIL_FROM_NAME: ' Environment Name ' }), {
    address: '',
    name: 'Environment Name',
  })
  assert.deepEqual(resolveEmailSender(environmentFallback, {}), {
    address: '',
    name: 'Example Academy',
  })
})

test('verification action URLs return to the verification screen', () => {
  assert.equal(
    verificationActionUrl('https://mockpilot.example/path'),
    'https://mockpilot.example/verify-email?verified=1',
  )
})

test('verification errors provide actionable throttling and expiry messages', () => {
  assert.match(verificationErrorMessage({ code: 'auth/too-many-requests' }, 'Fallback'), /wait a few minutes/i)
  assert.match(verificationErrorMessage({ code: 'auth/expired-action-code' }, 'Fallback'), /expired/i)
  assert.equal(verificationErrorMessage(new Error('Unknown'), 'Fallback'), 'Fallback')
  assert.equal(
    verificationRetryAfterSeconds(
      new Date('2026-01-01T00:01:00.100Z'),
      new Date('2026-01-01T00:00:30.000Z'),
    ),
    31,
  )
})

test('verification email content includes full client branding and safe fallbacks', () => {
  const brand = resolveBrandConfig({
    name: 'Example & Academy',
    shortName: 'E&A',
    logoUrl: '/example/logo.svg',
    logoAlt: 'Example <Logo>',
    primaryColor: '#086',
  })
  const verificationUrl = 'https://auth.example/action?mode=verifyEmail&oobCode=a&continueUrl=b'
  const content = buildVerificationEmail({
    brand,
    recipientName: '<Student>',
    verificationUrl,
    appUrl: 'https://app.example/base',
  })

  assert.equal(content.subject, 'Verify your email for Example & Academy')
  assert.match(content.text, new RegExp(verificationUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(content.html, /https:\/\/app\.example\/example\/logo\.svg/)
  assert.match(content.html, /background:#008866/)
  assert.match(content.html, /Example &amp; Academy/)
  assert.match(content.html, /&lt;Student&gt;/)
  assert.match(content.html, /&amp;continueUrl=b/)
  assert.doesNotMatch(content.html, /<Student>/)

  const noLogo = buildVerificationEmail({
    brand: resolveBrandConfig({ name: 'No Logo', shortName: 'NL' }),
    verificationUrl: 'https://auth.example/verify',
    appUrl: 'https://app.example',
  })
  assert.match(noLogo.html, />NL<\/p>/)
  assert.doesNotMatch(noLogo.html, /<img/)
})
