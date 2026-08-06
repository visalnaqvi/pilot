export const EMAIL_NOT_VERIFIED_CODE = 'EMAIL_NOT_VERIFIED'
export const EMAIL_ALREADY_VERIFIED_CODE = 'EMAIL_ALREADY_VERIFIED'
export const VERIFICATION_EMAIL_COOLDOWN_CODE = 'VERIFICATION_EMAIL_COOLDOWN'
export const VERIFICATION_EMAIL_COOLDOWN_SECONDS = 60

export function hasVerifiedEmail(value: { emailVerified?: boolean }) {
  return value.emailVerified === true
}

export function verificationActionUrl(origin: string) {
  const url = new URL('/verify-email', origin)
  url.searchParams.set('verified', '1')
  return url.toString()
}

export function pendingDisplayNameKey(uid: string) {
  return `mockpilot-pending-display-name:${uid}`
}

export function verificationRetryAfterSeconds(nextAllowedAt: Date, now = new Date()) {
  return Math.max(1, Math.ceil((nextAllowedAt.getTime() - now.getTime()) / 1_000))
}

export function verificationErrorMessage(error: unknown, fallback: string) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : ''

  switch (code) {
    case EMAIL_ALREADY_VERIFIED_CODE:
      return 'Your email is already verified. Check again to continue.'
    case VERIFICATION_EMAIL_COOLDOWN_CODE:
      return 'A verification email was sent recently. Wait for the countdown before requesting another.'
    case 'auth/too-many-requests':
      return 'Too many verification attempts were made. Please wait a few minutes and try again.'
    case 'auth/network-request-failed':
      return 'The verification service could not be reached. Check your connection and try again.'
    case 'auth/user-token-expired':
    case 'auth/user-disabled':
      return 'Your session is no longer available. Sign in again to continue verification.'
    case 'auth/invalid-action-code':
    case 'auth/expired-action-code':
      return 'This verification link is invalid or has expired. Request a new email and try again.'
    default:
      return fallback
  }
}
