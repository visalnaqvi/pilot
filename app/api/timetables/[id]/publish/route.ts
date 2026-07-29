import { createHash } from 'node:crypto'
import { errorResponse, requireRole } from '@/lib/admin-api'
import { adminDb, Timestamp } from '@/lib/firebase-admin'
import { resolveOrganisationTaskAudience } from '@/lib/task-api'
import { ensureTimetableAgendaJobs } from '@/lib/timetable-email-jobs'
import { localDateKey, type TimetableInput } from '@/lib/timetable'
import { timetableInputSchema } from '@/lib/timetable-schema'

export const runtime = 'nodejs'
export const maxDuration = 60

function inputFromDraft(data: FirebaseFirestore.DocumentData): TimetableInput {
  return {
    name: data.name,
    effectiveFrom: data.effectiveFrom,
    effectiveTo: data.effectiveTo,
    selectedUserIds: data.selectedUserIds || [],
    selectedGroupIds: data.selectedGroupIds || [],
    entries: data.entries || [],
  }
}

function contentHash(input: TimetableInput) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ['organisation'])
  if ('error' in auth) return auth.error
  try {
    const { id } = await context.params
    const draftReference = adminDb.collection('timetableDrafts').doc(id)
    const publishedReference = adminDb.collection('timetables').doc(id)
    const initialDraft = await draftReference.get()
    if (!initialDraft.exists) return Response.json({ error: 'Timetable draft not found.' }, { status: 404 })
    if (initialDraft.data()?.organisationId !== auth.user.uid) {
      return Response.json({ error: 'You cannot publish this timetable.' }, { status: 403 })
    }
    const input = inputFromDraft(initialDraft.data()!)
    const parsed = timetableInputSchema.safeParse(input)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message || 'Invalid timetable details.', issues: parsed.error.issues }, { status: 400 })
    }
    const timeZone = process.env.APP_TIME_ZONE || 'Asia/Kolkata'
    if (parsed.data.effectiveTo < localDateKey(new Date(), timeZone)) {
      return Response.json({ error: 'The timetable end date must not be in the past.' }, { status: 400 })
    }
    const audience = await resolveOrganisationTaskAudience({
      organisationId: auth.user.uid,
      selectedUserIds: parsed.data.selectedUserIds,
      selectedGroupIds: parsed.data.selectedGroupIds,
    })
    const expectedHash = contentHash(parsed.data)
    const result = await adminDb.runTransaction(async transaction => {
      const draft = await transaction.get(draftReference)
      const published = await transaction.get(publishedReference)
      if (!draft.exists || draft.data()?.organisationId !== auth.user.uid) {
        throw new Error('The timetable draft changed or is no longer available.')
      }
      const currentInput = timetableInputSchema.parse(inputFromDraft(draft.data()!))
      if (contentHash(currentInput) !== expectedHash) {
        throw new Error('The timetable changed while it was being published. Try again.')
      }
      const publishedData = published.data()
      if (published.exists && publishedData?.status === 'active' && publishedData?.contentHash === expectedHash) {
        return {
          changed: false,
          revision: Number(publishedData.revision || 1),
        }
      }
      const revision = Number(publishedData?.revision || 0) + 1
      const now = Timestamp.now()
      transaction.set(publishedReference, {
        ...currentInput,
        organisationId: auth.user.uid,
        organisationName: auth.user.name,
        timeZone,
        assignedUserIds: audience.assignees.map(assignee => assignee.userId),
        assignedGroupIds: audience.groupIds,
        audienceNames: audience.audienceNames,
        revision,
        status: 'active',
        contentHash: expectedHash,
        publishedAt: now,
        archivedAt: null,
        createdAt: publishedData?.createdAt || now,
        updatedAt: now,
      })
      transaction.update(draftReference, {
        publishedRevision: revision,
        updatedAt: now,
      })
      return { changed: true, revision }
    })
    await ensureTimetableAgendaJobs({
      organisationId: auth.user.uid,
      effectiveFrom: parsed.data.effectiveFrom,
      effectiveTo: parsed.data.effectiveTo,
      entries: parsed.data.entries,
      timeZone,
    })
    return Response.json({
      timetableId: id,
      revision: result.revision,
      changed: result.changed,
    })
  } catch (error) {
    return errorResponse(error, 'Unable to publish the timetable.')
  }
}
