import { authenticateRequest, errorResponse, profileDto } from '@/lib/admin-api'
import { clearVerificationEmailCooldown } from '@/lib/verification-email-cooldown'

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    await clearVerificationEmailCooldown(auth.actor.uid)
    return Response.json({
      profile: await profileDto(auth.user.uid),
      actor: auth.actor.uid === auth.user.uid ? null : await profileDto(auth.actor.uid),
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load your profile.')
  }
}
