import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { files } from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { adminStorage } from '@/lib/firebase-admin'
import { canViewOrganization } from '@/lib/services/access'

const schema = z.object({
  name: z.string().trim().min(1).max(240),
  contentType: z.enum([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'application/pdf',
    'application/msword',
    'text/plain',
    'text/markdown',
    'application/rtf',
    'text/rtf',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]),
  size: z.number().int().min(1).max(25 * 1024 * 1024),
  organizationId: z.string().uuid().nullable().optional(),
})

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Unsupported file type or size.', issues: parsed.error.issues }, { status: 400 })
    if (parsed.data.organizationId && !(await canViewOrganization(auth.user, parsed.data.organizationId))) {
      return Response.json({ error: 'Organization access required.' }, { status: 403 })
    }
    const safeName = parsed.data.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 160)
    const path = `uploads/${auth.user.uid}/${randomUUID()}/${safeName}`
    const [file] = await database().insert(files).values({
      ownerUserId: auth.user.uid,
      organizationId: parsed.data.organizationId || null,
      path,
      name: parsed.data.name,
      contentType: parsed.data.contentType,
      size: parsed.data.size,
    }).returning()
    const [uploadUrl] = await adminStorage.bucket().file(path).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60_000,
      contentType: parsed.data.contentType,
    })
    return Response.json({ fileId: file.id, path, uploadUrl, expiresIn: 900 }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'Unable to initialize upload.')
  }
}
