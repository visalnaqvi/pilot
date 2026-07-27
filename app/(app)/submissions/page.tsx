import { SubmissionsDashboard } from '@/app/_components/submissions-dashboard'

export default async function SubmissionsPage({ searchParams }: { searchParams: Promise<{ submission?: string | string[]; user?: string | string[] }> }) {
  const query = await searchParams
  const submissionId = typeof query.submission === 'string' ? query.submission : undefined
  const userId = typeof query.user === 'string' ? query.user : undefined

  return <SubmissionsDashboard initialSubmissionId={submissionId} initialUserId={userId} />
}
