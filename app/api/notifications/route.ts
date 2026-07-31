import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { notificationReads, notifications } from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const now = new Date()
    const rows = await database().select({
      notification: notifications,
      readAt: notificationReads.readAt,
    }).from(notifications)
      .leftJoin(notificationReads, and(
        eq(notificationReads.notificationId, notifications.id),
        eq(notificationReads.userId, auth.user.uid),
      ))
      .where(and(
        or(
          eq(notifications.recipientUserId, auth.user.uid),
          auth.user.organizationId ? eq(notifications.recipientOrganizationId, auth.user.organizationId) : eq(notifications.recipientUserId, auth.user.uid),
          eq(notifications.global, true),
        ),
        sql`${notifications.visibleAt} <= ${now}`,
        or(isNull(notifications.expiresAt), gt(notifications.expiresAt, now)),
      ))
      .orderBy(desc(notifications.visibleAt))
      .limit(100)
    return Response.json({
      items: rows.map(({ notification, readAt }) => ({
        ...notification,
        read: Boolean(readAt),
        visibleAt: notification.visibleAt.toISOString(),
        expiresAt: notification.expiresAt?.toISOString() || null,
        createdAt: notification.createdAt.toISOString(),
      })),
      nextCursor: null,
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load notifications.')
  }
}

const readSchema = z.object({
  ids: z.array(z.string().uuid()).max(200),
})

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const parsed = readSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid notification IDs.' }, { status: 400 })
    if (parsed.data.ids.length) {
      await database().insert(notificationReads).values(parsed.data.ids.map(notificationId => ({
        notificationId,
        userId: auth.user.uid,
      }))).onConflictDoUpdate({
        target: [notificationReads.notificationId, notificationReads.userId],
        set: { readAt: new Date() },
      })
    }
    return Response.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'Unable to mark notifications as read.')
  }
}
