import { timingSafeEqual } from 'node:crypto'
import { processDueTaskEmailJobs } from '@/lib/task-email-worker'
import { processDueTimetableEmailJobs } from '@/lib/timetable-email-worker'

export const runtime = 'nodejs'
export const maxDuration = 60

function authorized(request: Request) {
  const configured = process.env.CRON_SECRET
  const provided = request.headers.get('authorization')
  if (!configured || !provided) return false
  const expected = Buffer.from(`Bearer ${configured}`)
  const actual = Buffer.from(provided)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 })
  }
  try {
    const [tasks, timetables] = await Promise.all([
      processDueTaskEmailJobs(),
      processDueTimetableEmailJobs(),
    ])
    return Response.json({ tasks, timetables })
  } catch (error) {
    console.error('Email cron failed.', error)
    return Response.json({ error: 'Email processing failed.' }, { status: 500 })
  }
}
