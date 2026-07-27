'use client'

import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: 'AIzaSyDHiQfgBCK-Xkfz0xHMSI2zOKE1DI4uauQ',
  authDomain: 'mock-test-app-b659d.firebaseapp.com',
  projectId: 'mock-test-app-b659d',
  storageBucket: 'mock-test-app-b659d.firebasestorage.app',
  messagingSenderId: '672768912632',
  appId: '1:672768912632:web:ee72488e1e4448d9741f0d',
}

// Reuse the existing app during development hot reloads.
export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig)
export const auth = getAuth(firebaseApp)
export const db = getFirestore(firebaseApp)
export const storage = getStorage(firebaseApp)
