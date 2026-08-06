'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/_components/auth-context'
import { useBrand } from '@/app/_components/brand-provider'

export default function Home() {
  const router = useRouter()
  const brand = useBrand()
  const { user, ready } = useAuth()
  useEffect(() => {
    if (!ready) return
    router.replace(!user ? '/login' : user.emailVerified ? '/dashboard' : '/verify-email')
  }, [ready, router, user])
  return <main className="grid min-h-screen place-items-center text-slate-500">Loading {brand.name}…</main>
}
