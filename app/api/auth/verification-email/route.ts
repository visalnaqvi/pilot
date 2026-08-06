import { adminAuth } from '@/lib/firebase-admin'
import { authenticateFirebaseRequest } from '@/lib/firebase-request-auth'
import { getBrandConfig } from '@/lib/branding'
import { appBaseUrl } from '@/lib/app-url'
import { sendEmail } from '@/lib/email'
import {
  EMAIL_ALREADY_VERIFIED_CODE,
  VERIFICATION_EMAIL_COOLDOWN_CODE,
  VERIFICATION_EMAIL_COOLDOWN_SECONDS,
  hasVerifiedEmail,
  verificationActionUrl,
} from '@/lib/email-verification'
import {
  releaseVerificationEmail,
  reserveVerificationEmail,
} from '@/lib/verification-email-cooldown'
import { buildVerificationEmail } from '@/lib/verification-email-content'

export async function POST(request: Request) {
  const identity = await authenticateFirebaseRequest(request)
  if (!identity.ok) return identity.error
  const account = identity.token

  if (hasVerifiedEmail(account)) {
    return Response.json({
      error: 'Your email address is already verified.',
      code: EMAIL_ALREADY_VERIFIED_CODE,
    }, { status: 409 })
  }
  if (!account.email?.trim()) {
    return Response.json({ error: 'Your Firebase account must have an email address.' }, { status: 400 })
  }

  const cooldown = await reserveVerificationEmail(account.uid, account.email).catch(error => {
    console.error(error)
    return null
  })
  if (!cooldown) {
    return Response.json({ error: 'Unable to send the verification email. Please try again.' }, { status: 500 })
  }
  if (!cooldown.allowed) {
    return Response.json({
      error: 'A verification email was sent recently.',
      code: VERIFICATION_EMAIL_COOLDOWN_CODE,
      retryAfterSeconds: cooldown.retryAfterSeconds,
    }, {
      status: 429,
      headers: { 'Retry-After': String(cooldown.retryAfterSeconds) },
    })
  }

  try {
    const brand = getBrandConfig()
    const appUrl = appBaseUrl()
    const verificationUrl = await adminAuth.generateEmailVerificationLink(account.email, {
      url: verificationActionUrl(appUrl),
      handleCodeInApp: false,
    })
    await sendEmail({
      to: account.email,
      ...buildVerificationEmail({
        brand,
        recipientName: account.name,
        verificationUrl,
        appUrl,
      }),
      metadata: { kind: 'email_verification' },
    })
    return Response.json({ sent: true, cooldownSeconds: VERIFICATION_EMAIL_COOLDOWN_SECONDS })
  } catch (error) {
    await releaseVerificationEmail(cooldown.reservation).catch(releaseError => console.error(releaseError))
    console.error(error)
    return Response.json({ error: 'Unable to send the verification email. Please try again.' }, { status: 500 })
  }
}
