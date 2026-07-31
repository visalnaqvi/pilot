import { AttendanceDashboard } from '@/app/_components/attendance-dashboard'
import { redirect } from 'next/navigation'

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ timetableId?: string; entryId?: string; classDate?: string }>
}) {
  const parameters = await searchParams
  if (parameters.timetableId && parameters.entryId && parameters.classDate) {
    const query = new URLSearchParams({
      timetableId: parameters.timetableId,
      timetableEntryId: parameters.entryId,
      classDate: parameters.classDate,
    })
    redirect(`/attendance/take?${query}`)
  }
  return <AttendanceDashboard />
}
