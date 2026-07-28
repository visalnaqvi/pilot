import 'server-only'

import { adminDb } from '@/lib/firebase-admin'
import { verifyFirebaseIdToken } from '@/lib/firebase-id-token'

export type ServerRole = 'user' | 'organisation' | 'admin'

export async function requireRole(request: Request, allowedRoles: ServerRole[]) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return { error: Response.json({ error: 'Authentication required.' }, { status: 401 }) } as const
  try {
    const decoded = await verifyFirebaseIdToken(token)
    const profile = await adminDb.collection('users').doc(decoded.uid).get()
    const role = profile.data()?.role as ServerRole | undefined
    if (!profile.exists || !role || !allowedRoles.includes(role)) {
      return { error: Response.json({ error: 'You do not have permission to perform this action.' }, { status: 403 }) } as const
    }
    return {
      user: {
        uid: decoded.uid,
        email: decoded.email || profile.data()?.email || null,
        name: profile.data()?.name || decoded.name || decoded.email || decoded.uid,
        role,
      },
    } as const
  } catch {
    return { error: Response.json({ error: 'Invalid or expired authentication token.' }, { status: 401 }) } as const
  }
}

export async function requireAdmin(request: Request) {
  const auth = await requireRole(request, ['admin'])
  if (auth.error) {
    if (auth.error.status === 403) {
      return { error: Response.json({ error: 'Administrator access required.' }, { status: 403 }) } as const
    }
    return auth
  }
  return auth
}

export function errorResponse(error: unknown, fallback = 'Unable to complete the request.') {
  console.error(error)
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 })
}
