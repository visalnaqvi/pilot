import { z } from 'zod'
import { authenticateRequest, errorResponse, profileDto } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { clearVerificationEmailCooldown } from '@/lib/verification-email-cooldown'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
})

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return Response.json({ error: 'Invalid profile details.', issues: parsed.error.issues }, { status: 400 })
    }
    if (parsed.data.name) {
      await database()
        .update(users)
        .set({ name: parsed.data.name, updatedAt: new Date() })
        .where(eq(users.id, auth.actor.uid))
    }
    await clearVerificationEmailCooldown(auth.actor.uid)
    return Response.json({ profile: await profileDto(auth.actor.uid) })
  } catch (error) {
    return errorResponse(error, 'Unable to create your database profile.')
  }
}
