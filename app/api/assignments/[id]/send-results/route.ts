import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { after } from 'next/server'
import { z } from 'zod'
import { assignmentBatches, emailJobs, testSubmissions } from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { appBaseUrl } from '@/lib/app-url'
import { getBrandConfig } from '@/lib/branding'
import { database } from '@/lib/db'
import { isEmailConfigured } from '@/lib/email'
import { processEmailJob } from '@/lib/email-worker'
import { canManageOrganization } from '@/lib/services/access'

export const runtime = 'nodejs'
export const maxDuration = 60

const idSchema = z.string().uuid()

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error

  try {
    const parsedId = idSchema.safeParse((await context.params).id)
    if (!parsedId.success) return Response.json({ error: 'Invalid assignment.' }, { status: 400 })

    const db = database()
    const assignment = (await db.select().from(assignmentBatches)
      .where(eq(assignmentBatches.id, parsedId.data)).limit(1))[0]
    if (!assignment) return Response.json({ error: 'Assignment not found.' }, { status: 404 })
    if (!(await canManageOrganization(auth.user, assignment.organizationId))) {
      return Response.json({ error: 'Organization manager access required.' }, { status: 403 })
    }

    const submissions = await db.select({ userId: testSubmissions.userId }).from(testSubmissions)
      .where(eq(testSubmissions.assignmentBatchId, assignment.id))
    const recipientIds = [...new Set(submissions.map(submission => submission.userId))]
    if (!recipientIds.length) {
      return Response.json({ error: 'No students have taken this assignment yet.' }, { status: 409 })
    }

    const now = new Date()
    const [job] = await db.insert(emailJobs).values({
      kind: 'assignment_results',
      organizationId: assignment.organizationId,
      entityType: 'assignment',
      entityId: assignment.id,
      payload: { recipientIds },
      scheduledFor: now,
      nextAttemptAt: now,
      dedupeKey: `assignment:${assignment.id}:results:${randomUUID()}`,
    }).returning({ id: emailJobs.id })

    const baseUrl = appBaseUrl()
    const brand = getBrandConfig(new URL(baseUrl).hostname)
    if (isEmailConfigured(brand)) {
      after(() => processEmailJob(job.id)
        .catch(error => console.error('Immediate assignment result email processing failed.', error)))
    }

    return Response.json({ queuedCount: recipientIds.length }, { status: 202 })
  } catch (error) {
    return errorResponse(error, 'Unable to send assignment results.')
  }
}
