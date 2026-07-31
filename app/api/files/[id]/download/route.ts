import { eq } from 'drizzle-orm'
import { files } from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { adminStorage } from '@/lib/firebase-admin'
import { canViewOrganization } from '@/lib/services/access'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const { id } = await context.params
    const item = (await database().select().from(files).where(eq(files.id, id)).limit(1))[0]
    if (!item || item.deletedAt) return Response.json({ error: 'File not found.' }, { status: 404 })
    const allowed = item.ownerUserId === auth.user.uid
      || auth.user.globalRole === 'admin'
      || Boolean(item.organizationId && await canViewOrganization(auth.user, item.organizationId))
    if (!allowed) return Response.json({ error: 'File access required.' }, { status: 403 })
    const [url] = await adminStorage.bucket().file(item.path).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 10 * 60_000,
      responseDisposition: `attachment; filename="${item.name.replace(/"/g, '')}"`,
    })
    return Response.json({ url, expiresIn: 600 })
  } catch (error) {
    return errorResponse(error, 'Unable to authorize download.')
  }
}
