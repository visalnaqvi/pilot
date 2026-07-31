'use client'

import type { User } from 'firebase/auth'

const impersonationKey = 'mockpilot-admin-impersonation'

export async function authenticatedFetch(
  user: User,
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${await user.getIdToken()}`)
  const impersonatedUid = window.sessionStorage.getItem(impersonationKey)
  if (impersonatedUid) headers.set('X-Impersonate-User', impersonatedUid)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(input, { ...init, headers })
}
