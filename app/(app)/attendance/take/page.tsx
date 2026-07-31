import { AttendanceRegister } from '@/app/_components/attendance-register'

type SearchValue = string | string[] | undefined

function first(value: SearchValue) {
  return Array.isArray(value) ? value[0] : value
}

export default async function TakeAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{
    sessionId?: SearchValue
    timetableId?: SearchValue
    timetableVersionId?: SearchValue
    entryId?: SearchValue
    timetableEntryId?: SearchValue
    classDate?: SearchValue
  }>
}) {
  const parameters = await searchParams
  return <AttendanceRegister
    sessionId={first(parameters.sessionId)}
    timetableId={first(parameters.timetableId)}
    timetableVersionId={first(parameters.timetableVersionId)}
    timetableEntryId={first(parameters.timetableEntryId) || first(parameters.entryId)}
    classDate={first(parameters.classDate)}
  />
}
