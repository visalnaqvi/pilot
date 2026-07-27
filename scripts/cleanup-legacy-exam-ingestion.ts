import 'dotenv/config'
import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore'
import { adminDbCore, adminStorageCore } from '../lib/firebase-admin-core'

const write = process.argv.slice(2).includes('--write')
const now = Date.now()

type CleanupCounts = {
  exams: number
  sourceDocuments: number
  legacyPendingRevisions: number
  ingestionRuns: number
  expiredIngestionLocks: number
  storageObjects: number
}

async function commitDeletes(references: DocumentReference[]) {
  for (let offset = 0; offset < references.length; offset += 400) {
    const batch = adminDbCore.batch()
    for (const reference of references.slice(offset, offset + 400)) batch.delete(reference)
    await batch.commit()
  }
}

async function main() {
  const counts: CleanupCounts = {
    exams: 0,
    sourceDocuments: 0,
    legacyPendingRevisions: 0,
    ingestionRuns: 0,
    expiredIngestionLocks: 0,
    storageObjects: 0,
  }

  const exams = await adminDbCore.collection('examCatalog').get()
  counts.exams = exams.size
  for (const exam of exams.docs) {
    const [sources, pendingRevisions] = await Promise.all([
      exam.ref.collection('sources').get(),
      exam.ref.collection('revisions').where('status', '==', 'pending').get(),
    ])
    counts.sourceDocuments += sources.size
    const legacyPending = pendingRevisions.docs.filter((revision) => revision.data().flowVersion !== 'gpt_web_v1')
    counts.legacyPendingRevisions += legacyPending.length

    if (write) {
      await commitDeletes(sources.docs.map((document) => document.ref))
      const batch = adminDbCore.batch()
      for (const revision of legacyPending) {
        batch.update(revision.ref, {
          status: 'rejected',
          reviewReason: 'legacy_flow_replaced',
          reviewedAt: FieldValue.serverTimestamp(),
          reviewedBy: 'system:migration',
          reviewedByName: 'Legacy ingestion cleanup',
        })
      }
      batch.set(exam.ref, {
        sourceStatus: FieldValue.delete(),
        pendingRevisionCount: pendingRevisions.size - legacyPending.length,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      await batch.commit()
    }
  }

  const [runs, locks, storageFiles] = await Promise.all([
    adminDbCore.collection('examIngestionRuns').get(),
    adminDbCore.collection('examIngestionLocks').get(),
    adminStorageCore.bucket().getFiles({ prefix: 'exam-ingestion/' }),
  ])
  const expiredLocks = locks.docs.filter((lock) => {
    const leaseUntil = lock.data().leaseUntil as Timestamp | undefined
    return !leaseUntil || leaseUntil.toMillis() <= now
  })
  counts.ingestionRuns = runs.size
  counts.expiredIngestionLocks = expiredLocks.length
  counts.storageObjects = storageFiles[0].length

  console.log(JSON.stringify({ mode: write ? 'write' : 'dry-run', counts }, null, 2))
  if (!write) {
    console.log('No data was changed. Re-run with --write after verifying these counts.')
    return
  }

  await commitDeletes(runs.docs.map((document) => document.ref))
  await commitDeletes(expiredLocks.map((document) => document.ref))
  for (const file of storageFiles[0]) {
    if (!file.name.startsWith('exam-ingestion/')) throw new Error(`Refusing to delete unexpected Storage object: ${file.name}`)
    await file.delete({ ignoreNotFound: true })
  }
  console.log('Legacy exam ingestion cleanup completed.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

