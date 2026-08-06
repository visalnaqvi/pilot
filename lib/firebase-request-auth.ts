import 'server-only'

import { verifyFirebaseIdToken } from './firebase-id-token'

export async function authenticateFirebaseRequest(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) {
    return { ok: false, error: Response.json({ error: 'Authentication required.' }, { status: 401 }) } as const
  }

  try {
    return { ok: true, token: await verifyFirebaseIdToken(token) } as const
  } catch (error) {
    console.error(error)
    return { ok: false, error: Response.json({ error: 'Invalid or expired authentication token.' }, { status: 401 }) } as const
  }
}
