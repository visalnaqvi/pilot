import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

function adminApp() {
  if (getApps().length) return getApps()[0]
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const configured = [projectId, clientEmail, privateKey].filter(Boolean).length
  if (configured && configured !== 3) throw new Error('Firebase Admin configuration is incomplete. Set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY together.')
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || (projectId ? `${projectId}.firebasestorage.app` : undefined)
  if (configured === 3) {
    if (!privateKey!.includes('BEGIN PRIVATE KEY')) throw new Error('FIREBASE_ADMIN_PRIVATE_KEY must be the private_key from a Firebase service-account JSON key.')
    return initializeApp({
      credential: cert({ projectId: projectId!, clientEmail: clientEmail!, privateKey: privateKey! }),
      storageBucket,
    })
  }
  return initializeApp({ credential: applicationDefault(), storageBucket })
}

const app = adminApp()
export const adminAuthCore = getAuth(app)
export const adminDbCore = getFirestore(app)
export const adminStorageCore = getStorage(app)
