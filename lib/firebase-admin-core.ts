import admin from 'firebase-admin'
import { getFirestore } from 'firebase-admin/firestore'
import { firebasePrivateKeyFromEnv } from './firebase-private-key'

function adminApp() {
  const existingApp = admin.apps[0]
  if (existingApp) return existingApp
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  const privateKey = firebasePrivateKeyFromEnv({
    FIREBASE_ADMIN_PRIVATE_KEY: process.env.FIREBASE_ADMIN_PRIVATE_KEY,
    FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
  })
  const configured = [projectId, clientEmail, privateKey].filter(Boolean).length
  if (configured && configured !== 3) throw new Error('Firebase Admin configuration is incomplete.')
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || (projectId ? `${projectId}.firebasestorage.app` : undefined)
  if (configured === 3) {
    return admin.initializeApp({
      credential: admin.credential.cert({ projectId: projectId!, clientEmail: clientEmail!, privateKey: privateKey! }),
      storageBucket,
    })
  }
  return admin.initializeApp({ credential: admin.credential.applicationDefault(), storageBucket })
}

export const adminStorageCore = admin.storage(adminApp())
export const adminAuthCore = admin.auth(adminApp())
export const adminFirestoreCore = getFirestore(adminApp())
