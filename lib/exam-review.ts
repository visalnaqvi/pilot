import 'server-only'

import { adminDb, FieldValue, Timestamp } from '@/lib/firebase-admin'
import {
  ExamCycleDetailsSchema,
  emptyExamCycle,
  type EvidenceRef,
  type ExamCycleDetails,
  type ExamRevision,
  type ExamSection,
} from '@/lib/exam-information'

type Reviewer = { uid: string; name: string; email: string | null }
type StoredRevision = ExamRevision & { cycleYear?: number | null }

function replaceSectionEvidence(
  evidence: Record<string, EvidenceRef[]>,
  section: ExamSection,
  replacement: Record<string, EvidenceRef[]>,
) {
  const prefix = `/${section}`
  return {
    ...Object.fromEntries(Object.entries(evidence).filter(([path]) => path !== prefix && !path.startsWith(`${prefix}/`))),
    ...replacement,
  }
}

function applySection(cycle: ExamCycleDetails, section: ExamSection, value: unknown) {
  if (section === 'resources') cycle.links = value as ExamCycleDetails['links']
  else Object.assign(cycle, { [section]: value })
}

async function refreshPublicationMetadata(examId: string) {
  const examRef = adminDb.collection('examCatalog').doc(examId)
  const [pending, latest] = await Promise.all([
    examRef.collection('revisions').where('status', '==', 'pending').count().get(),
    examRef.collection('updates').orderBy('publishedAt', 'desc').limit(1).get(),
  ])
  const latestUpdate = latest.docs[0]
  await examRef.set({
    pendingRevisionCount: pending.data().count,
    publishedRevisionId: latestUpdate?.data().publishedRevisionId || FieldValue.delete(),
    lastPublishedAt: latestUpdate?.data().publishedAt || FieldValue.delete(),
    latestUpdateSummary: latestUpdate?.data().summary || FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

export async function applyRevisionDecisions(input: {
  examId: string
  revisionIds: string[]
  decision: 'approved' | 'rejected'
  reviewer: Reviewer
}) {
  const examRef = adminDb.collection('examCatalog').doc(input.examId)
  await adminDb.runTransaction(async (transaction) => {
    const examSnapshot = await transaction.get(examRef)
    if (!examSnapshot.exists) throw new Error('Catalog exam was not found.')

    const revisionRefs = input.revisionIds.map((id) => examRef.collection('revisions').doc(id))
    const revisionSnapshots = await Promise.all(revisionRefs.map((ref) => transaction.get(ref)))
    const revisions = revisionSnapshots.map((snapshot) => {
      if (!snapshot.exists) throw new Error(`Revision ${snapshot.id} was not found.`)
      const revision = { id: snapshot.id, ...snapshot.data() } as StoredRevision
      if (revision.status !== 'pending') throw new Error(`Revision ${revision.id} is already ${revision.status}.`)
      return revision
    })

    const activeCycleId = (examSnapshot.data()?.activeCycleId as string | null | undefined) || null
    const cycleIds = [...new Set([
      ...revisions.map((revision) => revision.cycleId),
      ...(activeCycleId ? [activeCycleId] : []),
    ])]
    const cycleRefs = new Map(cycleIds.map((id) => [id, examRef.collection('cycles').doc(id)]))
    const cycleSnapshots = await Promise.all(cycleIds.map((id) => transaction.get(cycleRefs.get(id)!)))
    const cycles = new Map<string, { cycle: ExamCycleDetails; exists: boolean; dirty: boolean; deleted: boolean }>()
    cycleSnapshots.forEach((snapshot) => {
      cycles.set(snapshot.id, {
        cycle: snapshot.exists
          ? ExamCycleDetailsSchema.parse({ id: snapshot.id, ...snapshot.data() })
          : emptyExamCycle(snapshot.id, revisions.find((revision) => revision.cycleId === snapshot.id)?.cycleLabel || snapshot.id),
        exists: snapshot.exists,
        dirty: false,
        deleted: false,
      })
    })

    let nextActiveCycleId = activeCycleId
    for (const revision of revisions) {
      const revisionRef = examRef.collection('revisions').doc(revision.id)
      const cycleState = cycles.get(revision.cycleId)!
      const isWebRefresh = revision.flowVersion === 'gpt_web_v1' && Boolean(revision.provisionallyPublishedAt)

      if (input.decision === 'approved') {
        if (isWebRefresh) {
          transaction.set(examRef.collection('updates').doc(revision.id), {
            verificationStatus: 'verified',
            verifiedAt: FieldValue.serverTimestamp(),
            verifiedBy: input.reviewer.uid,
            verifiedByName: input.reviewer.name,
          }, { merge: true })
        } else {
          applySection(cycleState.cycle, revision.section, revision.after)
          cycleState.cycle.evidence = replaceSectionEvidence(
            cycleState.cycle.evidence,
            revision.section,
            revision.evidence,
          )
          cycleState.cycle.sectionRevisionIds[revision.section] = revision.id
          cycleState.cycle.label = revision.cycleLabel
          cycleState.cycle.year = revision.cycleYear ?? cycleState.cycle.year
          cycleState.cycle.publishedRevisionId = revision.id
          cycleState.dirty = true

          const activeCycle = activeCycleId ? cycles.get(activeCycleId)?.cycle : null
          const makeActive = !activeCycleId
            || activeCycleId === revision.cycleId
            || Number(revision.cycleYear || 0) >= Number(activeCycle?.year || 0)
          if (makeActive) {
            if (activeCycleId && activeCycleId !== revision.cycleId) {
              const previous = cycles.get(activeCycleId)
              if (previous) {
                previous.cycle.isActive = false
                previous.dirty = true
              }
            }
            cycleState.cycle.isActive = true
            nextActiveCycleId = revision.cycleId
          }
          transaction.set(examRef.collection('updates').doc(revision.id), {
            examId: input.examId,
            cycleId: revision.cycleId,
            cycleLabel: revision.cycleLabel,
            section: revision.section,
            summary: revision.summary,
            sourceTitle: revision.sourceTitle,
            sourceUrl: revision.sourceUrl,
            publishedAt: FieldValue.serverTimestamp(),
            publishedRevisionId: revision.id,
            verificationStatus: 'verified',
            verifiedAt: FieldValue.serverTimestamp(),
            verifiedBy: input.reviewer.uid,
            verifiedByName: input.reviewer.name,
          })
        }
      } else if (isWebRefresh) {
        const currentRevisionId = cycleState.cycle.sectionRevisionIds[revision.section]
        if (currentRevisionId === revision.id) {
          applySection(cycleState.cycle, revision.section, revision.before)
          cycleState.cycle.evidence = replaceSectionEvidence(
            cycleState.cycle.evidence,
            revision.section,
            revision.beforeEvidence || {},
          )
          if (revision.previousSectionRevisionId) {
            cycleState.cycle.sectionRevisionIds[revision.section] = revision.previousSectionRevisionId
          } else {
            delete cycleState.cycle.sectionRevisionIds[revision.section]
          }
          cycleState.dirty = true
        }
        transaction.delete(examRef.collection('updates').doc(revision.id))
      }

      transaction.update(revisionRef, {
        status: input.decision,
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedBy: input.reviewer.uid,
        reviewedByName: input.reviewer.name,
        reviewedByEmail: input.reviewer.email,
        ...(input.decision === 'rejected' && isWebRefresh ? {
          revertedAt: FieldValue.serverTimestamp(),
          reviewReason: 'admin_rejected',
        } : {}),
      })
    }

    for (const revision of revisions) {
      if (input.decision !== 'rejected' || revision.flowVersion !== 'gpt_web_v1' || !revision.createdCycle) continue
      const state = cycles.get(revision.cycleId)!
      if (Object.keys(state.cycle.sectionRevisionIds).length === 0) {
        state.deleted = true
        state.dirty = false
        if (nextActiveCycleId === revision.cycleId) {
          nextActiveCycleId = revision.previousActiveCycleId || null
          if (nextActiveCycleId) {
            const previous = cycles.get(nextActiveCycleId)
            if (previous) {
              previous.cycle.isActive = true
              previous.dirty = true
            }
          }
        }
      }
    }

    for (const [cycleId, state] of cycles) {
      const cycleRef = cycleRefs.get(cycleId)!
      if (state.deleted) {
        transaction.delete(cycleRef)
      } else if (state.dirty) {
        transaction.set(cycleRef, {
          ...state.cycle,
          publishedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
    }
    transaction.set(examRef, {
      activeCycleId: nextActiveCycleId || FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  })

  await refreshPublicationMetadata(input.examId)
}

export function serializeAdminData(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(serializeAdminData)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, serializeAdminData(item)]))
  }
  return value
}
