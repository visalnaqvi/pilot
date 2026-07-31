'use client'

import type { User } from 'firebase/auth'
import { authenticatedFetch } from '@/lib/authenticated-fetch'

export async function uploadAuthorizedFile(user: User, file: File, organizationId?: string | null) {
  const initialized = await authenticatedFetch(user, '/api/files/upload', {
    method: 'POST',
    body: JSON.stringify({ name: file.name, contentType: file.type, size: file.size, organizationId: organizationId || null }),
  })
  const authorization = await initialized.json()
  if (!initialized.ok) throw new Error(authorization.error || 'Unable to authorize upload.')
  let upload: Response
  try {
    upload = await fetch(authorization.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    })
  } catch {
    throw new Error('Storage blocked the browser upload. Apply the bucket CORS configuration with npm run storage:cors, then try again.')
  }
  if (!upload.ok) throw new Error('File upload failed.')
  const completed = await authenticatedFetch(user, `/api/files/${authorization.fileId}/complete`, { method: 'POST' })
  if (!completed.ok) throw new Error((await completed.json()).error || 'Unable to complete upload.')
  return { fileId: authorization.fileId as string, path: authorization.path as string }
}
