import { timingSafeEqual } from 'node:crypto'
import { processDueEmailJobs } from '@/lib/email-worker'

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
    return Response.json(await processDueEmailJobs())
  } catch (error) {
    console.error('Email cron failed.', error)
    return Response.json({ error: 'Email processing failed.' }, { status: 500 })
  }
}
