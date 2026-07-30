import { AttendanceDashboard } from '@/app/_components/attendance-dashboard'

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ timetableId?: string; entryId?: string; classDate?: string }>
}) {
  const parameters = await searchParams
  return <AttendanceDashboard
    initialTimetableId={parameters.timetableId}
    initialEntryId={parameters.entryId}
    initialClassDate={parameters.classDate}
  />
}
