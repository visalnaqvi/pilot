import admin from 'firebase-admin'
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
  if (configured && configured !== 3) throw new Error('Firebase Admin configuration is incomplete. Set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY (or FIREBASE_PRIVATE_KEY) together.')
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || (projectId ? `${projectId}.firebasestorage.app` : undefined)
  if (configured === 3) {
    if (!privateKey!.startsWith('-----BEGIN PRIVATE KEY-----') || !privateKey!.endsWith('-----END PRIVATE KEY-----')) {
      throw new Error('The Firebase Admin private-key variable must contain the complete private_key from a Firebase service-account JSON key.')
    }
    return admin.initializeApp({
      credential: admin.credential.cert({ projectId: projectId!, clientEmail: clientEmail!, privateKey: privateKey! }),
      storageBucket,
    })
  }
  return admin.initializeApp({ credential: admin.credential.applicationDefault(), storageBucket })
}

const app = adminApp()
export const adminDbCore = admin.firestore(app)
export const adminStorageCore = admin.storage(app)
export const adminFieldValueCore = admin.firestore.FieldValue
export const adminTimestampCore = admin.firestore.Timestamp
