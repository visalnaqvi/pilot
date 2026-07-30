'use client'

import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { db } from '@/lib/firebase'
import { memberRole } from '@/lib/membership'

export type TeacherOrganisation = {
  id: string
  name: string
}

export function useTeacherOrganisations(user: User | null) {
  const [organisations, setOrganisations] = useState<TeacherOrganisation[]>([])
  const [loading, setLoading] = useState(Boolean(user))

  useEffect(() => {
    if (!user) return
    return onSnapshot(
      query(
        collection(db, 'organisationInvites'),
        where('userId', '==', user.uid),
        where('status', '==', 'accepted'),
      ),
      snapshot => {
        setOrganisations(snapshot.docs
          .filter(document => memberRole(document.data().memberRole) === 'teacher')
          .map(document => ({
            id: String(document.data().organisationId),
            name: String(document.data().organisationName || document.data().organisationEmail || document.data().organisationId),
          }))
          .sort((first, second) => first.name.localeCompare(second.name)))
        setLoading(false)
      },
      () => {
        setOrganisations([])
        setLoading(false)
      },
    )
  }, [user])

  return { organisations, loading }
}
