'use client'

import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { authenticatedFetch } from '@/lib/authenticated-fetch'

export type TeacherOrganisation = { id: string; name: string }

export function useTeacherOrganisations(user: User | null) {
  const [organisations, setOrganisations] = useState<TeacherOrganisation[]>([])
  const [loading, setLoading] = useState(Boolean(user))
  useEffect(() => {
    if (!user) {
      return
    }
    authenticatedFetch(user, '/api/organizations', { cache: 'no-store' })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        const teacherIds = new Set((data.memberships || []).filter((item: { role: string }) => item.role === 'teacher').map((item: { organizationId: string }) => item.organizationId))
        setOrganisations((data.items || []).filter((item: TeacherOrganisation) => teacherIds.has(item.id)).map((item: TeacherOrganisation) => ({ id: item.id, name: item.name })))
      })
      .catch(() => setOrganisations([]))
      .finally(() => setLoading(false))
  }, [user])
  return { organisations, loading }
}
