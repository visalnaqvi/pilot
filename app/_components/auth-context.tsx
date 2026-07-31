'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { authenticatedFetch } from '@/lib/authenticated-fetch'

export type Role = 'user' | 'organisation' | 'admin'
export type UserProfile = {
  uid: string
  email: string
  name?: string
  role: Role
  globalRole?: 'user' | 'admin'
  organizationId?: string | null
  membershipRole?: 'owner' | 'teacher' | 'student' | null
  profilePhotoPath?: string | null
  logoPath?: string | null
  profilePhotoUrl?: string
  logoUrl?: string
  address?: string | null
  contactNumbers?: string[]
  googleMapsUrl?: string | null
  instagramUrl?: string | null
  facebookUrl?: string | null
}
type AuthState = {
  user: User | null
  profile: UserProfile | null
  actualUser: User | null
  actualProfile: UserProfile | null
  ready: boolean
  isImpersonating: boolean
  refreshProfile: () => Promise<void>
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
  refreshProfile: async () => undefined,
  startImpersonating: () => undefined,
  stopImpersonating: () => undefined,
}
const AuthContext = createContext<AuthState>(emptyAuthState)
const impersonationKey = 'mockpilot-admin-impersonation'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [actualUser, setActualUser] = useState<User | null>(null)
  const [actualProfile, setActualProfile] = useState<UserProfile | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [ready, setReady] = useState(false)

  const loadProfile = async (currentUser: User) => {
    const response = await authenticatedFetch(currentUser, '/api/me', { cache: 'no-store' })
    if (!response.ok) throw new Error('Unable to load your profile.')
    const data = await response.json() as { profile: UserProfile; actor: UserProfile | null }
    setProfile(data.profile)
    setActualProfile(data.actor || data.profile)
  }

  useEffect(() => onAuthStateChanged(auth, async nextUser => {
    setActualUser(nextUser)
    setProfile(null)
    setActualProfile(null)
    if (!nextUser) {
      window.sessionStorage.removeItem(impersonationKey)
      setReady(true)
      return
    }
    try {
      await loadProfile(nextUser)
    } catch {
      setProfile(null)
      setActualProfile(null)
    } finally {
      setReady(true)
    }
  }), [])

  const refreshProfile = async () => {
    if (actualUser) await loadProfile(actualUser)
  }
  const startImpersonating = (target: UserProfile) => {
    if (actualProfile?.role !== 'admin' || target.role === 'admin') return
    window.sessionStorage.setItem(impersonationKey, target.uid)
    setProfile(target)
  }
  const stopImpersonating = () => {
    window.sessionStorage.removeItem(impersonationKey)
    setProfile(actualProfile)
  }
  const user = useMemo(() => {
    if (!actualUser || !profile || profile.uid === actualUser.uid) return actualUser
    return {
      ...actualUser,
      uid: profile.uid,
      email: profile.email,
      displayName: profile.name || profile.email,
      getIdToken: actualUser.getIdToken.bind(actualUser),
      getIdTokenResult: actualUser.getIdTokenResult.bind(actualUser),
      reload: actualUser.reload.bind(actualUser),
      toJSON: actualUser.toJSON.bind(actualUser),
    } as User
  }, [actualUser, profile])
  const isImpersonating = Boolean(actualProfile?.role === 'admin' && profile && profile.uid !== actualProfile.uid)

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      actualUser,
      actualProfile,
      ready,
      isImpersonating,
      refreshProfile,
      startImpersonating,
      stopImpersonating,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
