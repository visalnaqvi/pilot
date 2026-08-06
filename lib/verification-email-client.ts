'use client'

import type { User } from 'firebase/auth'
import { authenticatedFetch } from './authenticated-fetch'

export class VerificationEmailDeliveryError extends Error {
  code?: string
  retryAfterSeconds?: number

  constructor(message: string, options: { code?: string; retryAfterSeconds?: number } = {}) {
    super(message)
    this.name = 'VerificationEmailDeliveryError'
    this.code = options.code
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

export async function requestVerificationEmail(user: User) {
  const response = await authenticatedFetch(user, '/api/auth/verification-email', { method: 'POST' })
  const body = await response.json().catch(() => ({})) as {
    sent?: boolean
    cooldownSeconds?: number
    error?: string
    code?: string
    retryAfterSeconds?: number
  }
  if (!response.ok || !body.sent) {
    throw new VerificationEmailDeliveryError(body.error || 'Unable to send the verification email.', {
      code: body.code,
      retryAfterSeconds: body.retryAfterSeconds,
    })
  }
  return { cooldownSeconds: Math.max(1, body.cooldownSeconds || 60) }
}
