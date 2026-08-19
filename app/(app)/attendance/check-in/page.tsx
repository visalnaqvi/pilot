import type { Metadata } from 'next'
import { AttendanceQrCheckIn } from '@/app/_components/attendance-qr-check-in'

export const metadata: Metadata = { referrer: 'no-referrer' }

type SearchValue = string | string[] | undefined

export default async function AttendanceCheckInPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: SearchValue }>
}) {
  const value = (await searchParams).token
  return <AttendanceQrCheckIn token={Array.isArray(value) ? value[0] : value} />
}
