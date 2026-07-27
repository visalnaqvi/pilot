/* Run with Firebase Admin credentials in the environment. Defaults to dry-run. */
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const normalize = (value) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
const idFor = (name) => { const key = normalize(name); let hash = 2166136261; for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return `${key.replace(/\s+/g, '-').slice(0, 100)}-${(hash >>> 0).toString(36)}` }
const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
const rawPrivateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim()
const quote = rawPrivateKey?.[0]
const unquotedPrivateKey = rawPrivateKey && (quote === '"' || quote === "'") && rawPrivateKey.at(-1) === quote ? rawPrivateKey.slice(1, -1) : rawPrivateKey
const privateKey = unquotedPrivateKey?.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n').replace(/\r\n?/g, '\n').trim()
if (!getApps().length) initializeApp({ credential: projectId && clientEmail && privateKey ? cert({ projectId, clientEmail, privateKey }) : applicationDefault() })
const db = getFirestore()
const write = process.argv.includes('--write')

const legacy = await db.collection('exams').get()
const mapping = new Map()
for (const document of legacy.docs) {
  const name = document.data().name
  if (typeof name !== 'string' || !normalize(name)) continue
  mapping.set(document.id, { id: idFor(name), name: name.trim() })
}
console.log(`Found ${mapping.size} legacy exams; ${new Set([...mapping.values()].map((item) => item.id)).size} canonical catalog entries.`)
if (!write) { console.log('Dry run only. Re-run with --write to migrate.'); process.exit(0) }

for (const exam of new Map([...mapping.values()].map((item) => [item.id, item])).values()) {
  await db.collection('examCatalog').doc(exam.id).set({ name: exam.name, nameKey: normalize(exam.name), aliases: [], aliasKeys: [normalize(exam.name)], migratedAt: FieldValue.serverTimestamp() }, { merge: true })
}
for (const collectionName of ['categories', 'tests']) {
  const snapshot = await db.collection(collectionName).get()
  let batch = db.batch(); let count = 0
  for (const document of snapshot.docs) {
    const target = mapping.get(document.data().examId)
    if (!target) continue
    batch.update(document.ref, collectionName === 'tests' ? { examId: target.id, exam: target.name } : { examId: target.id })
    count += 1
    if (count === 400) { await batch.commit(); batch = db.batch(); count = 0 }
  }
  if (count) await batch.commit()
}
console.log('Migration complete.')
