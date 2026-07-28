import { randomUUID } from 'node:crypto'
import type { DocumentData, QueryDocumentSnapshot, Timestamp as FirestoreTimestamp } from 'firebase-admin/firestore'
import {
  EXAM_SECTIONS,
  ExamCycleDetailsSchema,
  emptyExamCycle,
  sectionValue,
  sectionsEqual,
  type EvidenceRef,
  type ExamCatalogSummary,
  type ExamCycleDetails,
  type ExamSection,
} from '@/lib/exam-information'
import {
  adminDbCore,
  adminFieldValueCore as FieldValue,
  adminTimestampCore as Timestamp,
} from '@/lib/firebase-admin-core'
import { requestExamWebRefresh } from './openai-refresh'
import { evidenceFromClaims, validateRefreshEvidence, type ExamWebRefresh } from './schema'

export type RefreshOptions = { examId?: string; all?: boolean; write: boolean }
export type RefreshResult = {
  examined: number
  changed: number
  unchanged: number
  skipped: number
  proposedRevisions: number
  errors: string[]
}

const LEASE_MS = 12 * 60 * 1000
const FLOW_VERSION = 'gpt_web_v1' as const

function asExam(document: QueryDocumentSnapshot<DocumentData>): ExamCatalogSummary {
  return { id: document.id, ...(document.data() as Omit<ExamCatalogSummary, 'id'>) }
}

async function selectedExams(options: RefreshOptions) {
  if (options.examId) {
    const document = await adminDbCore.collection('examCatalog').doc(options.examId).get()
    if (!document.exists) throw new Error(`Catalog exam ${options.examId} was not found.`)
    return [{ id: document.id, ...(document.data() as Omit<ExamCatalogSummary, 'id'>) }]
  }
  if (!options.all) throw new Error('Pass either --exam <catalog-id> or --all.')
  return (await adminDbCore.collection('examCatalog').orderBy('name').get()).docs.map(asExam)
}

async function loadCycle(examId: string, cycleId?: string | null): Promise<ExamCycleDetails | null> {
  if (!cycleId) return null
  const snapshot = await adminDbCore.collection('examCatalog').doc(examId).collection('cycles').doc(cycleId).get()
  if (!snapshot.exists) return null
  return ExamCycleDetailsSchema.parse({ id: snapshot.id, ...snapshot.data() })
}

function runId() {
  return `refresh-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
}

async function createRun(id: string, options: RefreshOptions) {
  if (!options.write) return
  await adminDbCore.collection('examRefreshRuns').doc(id).set({
    kind: 'gpt_web_refresh',
    flowVersion: FLOW_VERSION,
    status: 'running',
    examId: options.examId || null,
    all: Boolean(options.all),
    dryRun: false,
    startedAt: FieldValue.serverTimestamp(),
  })
}

async function finishRun(id: string, options: RefreshOptions, result: RefreshResult) {
  if (!options.write) return
  await adminDbCore.collection('examRefreshRuns').doc(id).set({
    status: result.errors.length ? 'completed_with_errors' : 'completed',
    completedAt: FieldValue.serverTimestamp(),
    ...result,
  }, { merge: true })
}

async function acquireLease(examId: string, id: string) {
  const ref = adminDbCore.collection('examRefreshLocks').doc(examId)
  return adminDbCore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const leaseUntil = snapshot.data()?.leaseUntil as FirestoreTimestamp | undefined
    if (leaseUntil && leaseUntil.toMillis() > Date.now() && snapshot.data()?.runId !== id) return false
    transaction.set(ref, {
      examId,
      runId: id,
      leaseUntil: Timestamp.fromMillis(Date.now() + LEASE_MS),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return true
  })
}

async function releaseLease(examId: string, id: string) {
  const ref = adminDbCore.collection('examRefreshLocks').doc(examId)
  await adminDbCore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (snapshot.data()?.runId === id) transaction.delete(ref)
  })
}

function sectionDocumentValue(document: ExamWebRefresh, section: ExamSection) {
  return document[section].data
}

function evidenceForSection(evidence: Record<string, EvidenceRef[]>, section: ExamSection) {
  const prefix = `/${section}`
  return Object.fromEntries(Object.entries(evidence).filter(([path]) => path === prefix || path.startsWith(`${prefix}/`)))
}

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

async function pendingRevisions(examId: string) {
  return adminDbCore.collection('examCatalog').doc(examId).collection('revisions')
    .where('status', '==', 'pending').get()
}

async function markChecked(examId: string, status: ExamCatalogSummary['lastRefreshStatus'], error: string | null = null) {
  await adminDbCore.collection('examCatalog').doc(examId).set({
    lastCheckedAt: FieldValue.serverTimestamp(),
    lastRefreshStatus: status,
    lastRefreshError: error,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

async function refreshOneExam(exam: ExamCatalogSummary, options: RefreshOptions, id: string) {
  const existingPending = await pendingRevisions(exam.id)
  const provisionalPending = existingPending.docs.some((document) =>
    document.data().flowVersion === FLOW_VERSION && document.data().provisionallyPublishedAt)
  if (provisionalPending) {
    if (options.write) await markChecked(exam.id, 'skipped', 'An earlier provisional refresh is still awaiting admin review.')
    return { changed: 0, unchanged: 0, skipped: 1, proposedRevisions: 0 }
  }

  const activeCycle = await loadCycle(exam.id, exam.activeCycleId)
  const result = await requestExamWebRefresh({
    examId: exam.id,
    examName: exam.name,
    aliases: exam.aliases || [],
    currentCycle: activeCycle,
  })
  if (!result.document.identityMatch) throw new Error('Web search results did not match the catalog exam identity.')
  if (result.document.status === 'insufficient_evidence') {
    if (options.write) await markChecked(exam.id, 'insufficient_evidence')
    return { changed: 0, unchanged: 1, skipped: 0, proposedRevisions: 0 }
  }

  const targetCycle = await loadCycle(exam.id, result.document.cycleId)
    || emptyExamCycle(result.document.cycleId, result.document.cycleLabel)
  const capturedAt = new Date().toISOString()
  const changes = EXAM_SECTIONS.flatMap((section) => {
    const extracted = result.document[section]
    if (!extracted.present) return []
    const before = sectionValue(targetCycle, section)
    const after = sectionDocumentValue(result.document, section)
    if (sectionsEqual(before, after)) return []
    validateRefreshEvidence({
      section,
      before,
      after,
      claims: extracted.claims,
      consultedUrls: result.consultedUrls,
    })
    return [{
      section,
      before,
      after,
      evidence: evidenceFromClaims(extracted.claims, capturedAt),
    }]
  })

  if (!changes.length) {
    if (options.write) await markChecked(exam.id, 'unchanged')
    else console.log(`[dry-run] ${exam.name}: no supported changes found.`)
    return { changed: 0, unchanged: 1, skipped: 0, proposedRevisions: 0 }
  }

  if (!options.write) {
    for (const change of changes) {
      console.log(`[dry-run] ${exam.name} ${result.document.cycleId}: ${change.section} would be published provisionally.`)
    }
    return { changed: 1, unchanged: 0, skipped: 0, proposedRevisions: changes.length }
  }

  const examRef = adminDbCore.collection('examCatalog').doc(exam.id)
  const cycleRef = examRef.collection('cycles').doc(result.document.cycleId)
  await adminDbCore.runTransaction(async (transaction) => {
    const [freshExam, freshCycle] = await Promise.all([
      transaction.get(examRef),
      transaction.get(cycleRef),
    ])
    if (!freshExam.exists) throw new Error('Catalog exam disappeared during refresh.')
    const freshActiveCycleId = (freshExam.data()?.activeCycleId as string | null | undefined) || null
    const baselineActiveCycleId = exam.activeCycleId || null
    if (freshActiveCycleId !== baselineActiveCycleId) {
      throw new Error('The active exam cycle changed during refresh; run the refresh again.')
    }

    const cycle = freshCycle.exists
      ? ExamCycleDetailsSchema.parse({ id: freshCycle.id, ...freshCycle.data() })
      : emptyExamCycle(result.document.cycleId, result.document.cycleLabel)
    const createdCycle = !freshCycle.exists
    const sectionRevisionIds = { ...cycle.sectionRevisionIds }
    let evidence = { ...cycle.evidence }
    const revisionIds: string[] = []

    for (const change of changes) {
      const revisionId = `${id}-${change.section}`
      const firstEvidence = Object.values(change.evidence).flat()[0]
      revisionIds.push(revisionId)
      transaction.create(examRef.collection('revisions').doc(revisionId), {
        examId: exam.id,
        examName: exam.name,
        cycleId: result.document.cycleId,
        cycleLabel: result.document.cycleLabel,
        cycleYear: result.document.year,
        section: change.section,
        status: 'pending',
        before: change.before,
        after: change.after,
        beforeEvidence: evidenceForSection(cycle.evidence, change.section),
        evidence: change.evidence,
        summary: result.document.summary,
        confidence: result.document.confidence,
        sourceId: firstEvidence?.sourceId || '',
        sourceTitle: firstEvidence?.sourceTitle || 'OpenAI web search',
        sourceUrl: firstEvidence?.url || 'https://openai.com/',
        runId: id,
        flowVersion: FLOW_VERSION,
        provisionallyPublishedAt: FieldValue.serverTimestamp(),
        previousActiveCycleId: freshActiveCycleId,
        previousSectionRevisionId: sectionRevisionIds[change.section] || null,
        createdCycle,
        createdAt: FieldValue.serverTimestamp(),
      })
      transaction.create(examRef.collection('updates').doc(revisionId), {
        examId: exam.id,
        cycleId: result.document.cycleId,
        cycleLabel: result.document.cycleLabel,
        section: change.section,
        summary: result.document.summary,
        sourceTitle: firstEvidence?.sourceTitle || 'OpenAI web search',
        sourceUrl: firstEvidence?.url || 'https://openai.com/',
        publishedAt: FieldValue.serverTimestamp(),
        publishedRevisionId: revisionId,
        verificationStatus: 'pending',
      })
      sectionRevisionIds[change.section] = revisionId
      evidence = replaceSectionEvidence(evidence, change.section, change.evidence)
    }

    const activeYear = activeCycle?.year || 0
    const makeActive = !freshActiveCycleId
      || freshActiveCycleId === result.document.cycleId
      || Number(result.document.year || 0) >= activeYear
    const cycleUpdate: Record<string, unknown> = {
      ...cycle,
      id: result.document.cycleId,
      label: result.document.cycleLabel,
      year: result.document.year ?? cycle.year,
      isActive: makeActive,
      evidence,
      sectionRevisionIds,
      publishedAt: FieldValue.serverTimestamp(),
      publishedRevisionId: revisionIds.at(-1) || null,
      updatedAt: FieldValue.serverTimestamp(),
    }
    for (const change of changes) {
      if (change.section === 'resources') cycleUpdate.links = change.after
      else cycleUpdate[change.section] = change.after
    }
    transaction.set(cycleRef, cycleUpdate, { merge: true })
    if (makeActive && freshActiveCycleId && freshActiveCycleId !== result.document.cycleId) {
      transaction.set(examRef.collection('cycles').doc(freshActiveCycleId), {
        isActive: false,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    transaction.set(examRef, {
      ...(makeActive ? { activeCycleId: result.document.cycleId } : {}),
      publishedRevisionId: revisionIds.at(-1) || null,
      lastPublishedAt: FieldValue.serverTimestamp(),
      latestUpdateSummary: result.document.summary,
      lastCheckedAt: FieldValue.serverTimestamp(),
      lastRefreshStatus: 'changed',
      lastRefreshError: null,
      pendingRevisionCount: existingPending.size + changes.length,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  })

  return { changed: 1, unchanged: 0, skipped: 0, proposedRevisions: changes.length }
}

export async function refreshExams(options: RefreshOptions): Promise<RefreshResult> {
  const id = runId()
  const result: RefreshResult = {
    examined: 0,
    changed: 0,
    unchanged: 0,
    skipped: 0,
    proposedRevisions: 0,
    errors: [],
  }
  await createRun(id, options)
  for (const exam of await selectedExams(options)) {
    result.examined += 1
    let leased = false
    try {
      if (options.write) {
        leased = await acquireLease(exam.id, id)
        if (!leased) throw new Error('Another refresh currently holds this exam lease.')
      }
      const outcome = await refreshOneExam(exam, options, id)
      result.changed += outcome.changed
      result.unchanged += outcome.unchanged
      result.skipped += outcome.skipped
      result.proposedRevisions += outcome.proposedRevisions
    } catch (error) {
      const message = `${exam.name}: ${error instanceof Error ? error.message : String(error)}`
      result.errors.push(message)
      console.error(message)
      if (options.write) await markChecked(exam.id, 'error', message)
    } finally {
      if (options.write && leased) await releaseLease(exam.id, id)
    }
  }
  await finishRun(id, options, result)
  return result
}
