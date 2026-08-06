import { VerifyEmail } from '@/app/_components/verify-email'

type VerifyEmailPageProps = {
  searchParams: Promise<{
    verified?: string | string[]
    delivery?: string | string[]
    cooldown?: string | string[]
  }>
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const query = await searchParams
  const requestedCooldown = Number(query.cooldown)
  const initialCooldown = Number.isFinite(requestedCooldown)
    ? Math.min(3_600, Math.max(0, Math.ceil(requestedCooldown)))
    : 0
  return (
    <VerifyEmail
      returnedFromEmail={query.verified === '1'}
      initialDelivery={query.delivery === 'sent'
        ? 'sent'
        : query.delivery === 'cooldown'
          ? 'cooldown'
          : query.delivery === 'failed'
            ? 'failed'
            : null}
      initialCooldown={initialCooldown}
    />
  )
}
