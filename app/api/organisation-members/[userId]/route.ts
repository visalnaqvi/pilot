import { errorResponse, requireRole } from '@/lib/admin-api'
import { adminDb, Timestamp } from '@/lib/firebase-admin'
import { memberRoleUpdateSchema } from '@/lib/attendance-schema'

export const runtime = 'nodejs'

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  const auth = await requireRole(request, ['organisation'])
  if ('error' in auth) return auth.error
  try {
    const { userId } = await context.params
    const parsed = memberRoleUpdateSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Choose a valid institute role.' }, { status: 400 })
    const membershipReference = adminDb.collection('organisationInvites').doc(`${auth.user.uid}_${userId}`)
    const membership = await membershipReference.get()
    if (!membership.exists || membership.data()?.organisationId !== auth.user.uid || membership.data()?.status !== 'accepted') {
      return Response.json({ error: 'Accepted institute member not found.' }, { status: 404 })
    }
    const now = Timestamp.now()
    await membershipReference.update({
      memberRole: parsed.data.memberRole,
      memberRoleUpdatedAt: now,
      memberRoleUpdatedBy: auth.user.uid,
    })

    if (parsed.data.memberRole === 'teacher') {
      const [groups, drafts] = await Promise.all([
        adminDb.collection('organisationGroups').where('organisationId', '==', auth.user.uid).get(),
        adminDb.collection('timetableDrafts').where('organisationId', '==', auth.user.uid).get(),
      ])
      const writer = adminDb.bulkWriter()
      groups.docs.forEach(group => writer.delete(group.ref.collection('members').doc(userId)))
      drafts.docs.forEach(draft => {
        const selected = Array.isArray(draft.data().selectedUserIds) ? draft.data().selectedUserIds as string[] : []
        if (selected.includes(userId)) writer.update(draft.ref, {
          selectedUserIds: selected.filter(id => id !== userId),
          updatedAt: now,
        })
      })
      await writer.close()
    }
    return Response.json({ userId, memberRole: parsed.data.memberRole })
  } catch (error) {
    return errorResponse(error, 'Unable to update the institute role.')
  }
}
