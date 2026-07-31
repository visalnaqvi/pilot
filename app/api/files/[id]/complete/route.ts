import { eq } from 'drizzle-orm'
import { files } from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { adminStorage } from '@/lib/firebase-admin'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const { id } = await context.params
    const item = (await database().select().from(files).where(eq(files.id, id)).limit(1))[0]
    if (!item || item.ownerUserId !== auth.user.uid || item.deletedAt) return Response.json({ error: 'File not found.' }, { status: 404 })
    const [exists] = await adminStorage.bucket().file(item.path).exists()
    if (!exists) return Response.json({ error: 'Upload has not completed.' }, { status: 409 })
    const [metadata] = await adminStorage.bucket().file(item.path).getMetadata()
    if (Number(metadata.size) !== item.size || metadata.contentType !== item.contentType) {
      await adminStorage.bucket().file(item.path).delete({ ignoreNotFound: true })
      await database().update(files).set({ status: 'deleted', deletedAt: new Date() }).where(eq(files.id, id))
      return Response.json({ error: 'Uploaded file metadata does not match the authorization.' }, { status: 400 })
    }
    return Response.json({ item: { id: item.id, name: item.name, contentType: item.contentType, size: item.size } })
  } catch (error) {
    return errorResponse(error, 'Unable to complete upload.')
  }
}
