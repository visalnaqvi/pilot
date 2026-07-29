import { TestResult } from '@/app/_components/test-screens'

export default async function ResultPage({ searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submission?: string }> }) {
  const search = await searchParams
  return <TestResult submissionId={search.submission || ''} />
}
