'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'

export type Role = 'user' | 'organisation' | 'admin'
export type UserProfile = {
  uid: string
  email: string
  name?: string
  role: Role
  profilePhotoUrl?: string
  logoUrl?: string
  address?: string
  contactNumbers?: string[]
  googleMapsUrl?: string
  instagramUrl?: string
  facebookUrl?: string
}
type AuthState = {
  user: User | null
  profile: UserProfile | null
  actualUser: User | null
  actualProfile: UserProfile | null
  ready: boolean
  isImpersonating: boolean
  startImpersonating: (target: UserProfile) => void
  stopImpersonating: () => void
}
const emptyAuthState: AuthState = {
  user: null,
  profile: null,
  actualUser: null,
  actualProfile: null,
  ready: false,
  isImpersonating: false,
  startImpersonating: () => undefined,
  stopImpersonating: () => undefined,
}
const AuthContext = createContext<AuthState>(emptyAuthState)
const impersonationKey = 'mockpilot-admin-impersonation'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [actualUser, setActualUser] = useState<User | null>(null)
  const [actualProfile, setActualProfile] = useState<UserProfile | null>(null)
  const [impersonatedUid, setImpersonatedUid] = useState<string | null>(null)
  const [impersonatedProfile, setImpersonatedProfile] = useState<UserProfile | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [profileReady, setProfileReady] = useState(false)
  const [impersonationReady, setImpersonationReady] = useState(false)

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setActualUser(nextUser)
    setActualProfile(null)
    setImpersonatedUid(null)
    setImpersonatedProfile(null)
    setAuthReady(true)
    setProfileReady(!nextUser)
    setImpersonationReady(!nextUser)
  }), [])
  useEffect(() => {
    if (!actualUser) return
    return onSnapshot(doc(db, 'users', actualUser.uid), (snapshot) => {
      const nextProfile = snapshot.exists() ? ({ uid: snapshot.id, ...snapshot.data() } as UserProfile) : null
      setActualProfile(nextProfile)
      if (nextProfile?.role === 'admin') {
        const storedUid = window.sessionStorage.getItem(impersonationKey)
        setImpersonatedUid(storedUid)
        if (!storedUid) {
          setImpersonatedProfile(null)
          setImpersonationReady(true)
        }
      } else {
        window.sessionStorage.removeItem(impersonationKey)
        setImpersonatedUid(null)
        setImpersonatedProfile(null)
        setImpersonationReady(true)
      }
      setProfileReady(true)
    }, () => {
      setProfileReady(true)
      setImpersonationReady(true)
    })
  }, [actualUser])
  useEffect(() => {
    if (!impersonatedUid || actualProfile?.role !== 'admin') return
    return onSnapshot(doc(db, 'users', impersonatedUid), (snapshot) => {
      const target = snapshot.exists() ? ({ uid: snapshot.id, ...snapshot.data() } as UserProfile) : null
      if (!target || target.role === 'admin') {
        window.sessionStorage.removeItem(impersonationKey)
        setImpersonatedUid(null)
        setImpersonatedProfile(null)
      } else {
        setImpersonatedProfile(target)
      }
      setImpersonationReady(true)
    }, () => {
      setImpersonatedProfile(null)
      setImpersonationReady(true)
    })
  }, [actualProfile?.role, impersonatedUid])

  const startImpersonating = (target: UserProfile) => {
    if (actualProfile?.role !== 'admin' || target.role === 'admin') return
    window.sessionStorage.setItem(impersonationKey, target.uid)
    setImpersonatedUid(target.uid)
    setImpersonatedProfile(target)
    setImpersonationReady(true)
  }
  const stopImpersonating = () => {
    window.sessionStorage.removeItem(impersonationKey)
    setImpersonatedUid(null)
    setImpersonatedProfile(null)
    setImpersonationReady(true)
  }
  const user = useMemo(() => {
    if (!actualUser || !impersonatedProfile) return actualUser
    return {
      ...actualUser,
      uid: impersonatedProfile.uid,
      email: impersonatedProfile.email,
      displayName: impersonatedProfile.name || impersonatedProfile.email,
      getIdToken: actualUser.getIdToken.bind(actualUser),
      getIdTokenResult: actualUser.getIdTokenResult.bind(actualUser),
      reload: actualUser.reload.bind(actualUser),
      toJSON: actualUser.toJSON.bind(actualUser),
    } as User
  }, [actualUser, impersonatedProfile])
  const profile = impersonatedProfile || actualProfile
  const isImpersonating = Boolean(actualProfile?.role === 'admin' && impersonatedProfile)

  return <AuthContext.Provider value={{ user, profile, actualUser, actualProfile, ready: authReady && profileReady && impersonationReady, isImpersonating, startImpersonating, stopImpersonating }}>{children}</AuthContext.Provider>
}
export const useAuth = () => useContext(AuthContext)
