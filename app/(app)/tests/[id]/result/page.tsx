import { TestResult } from '@/app/_components/test-screens'

export default async function ResultPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ score?: string; correct?: string }> }) {
  const { id } = await params
  const search = await searchParams
  const score = Number(search.score)
  const correct = Number(search.correct)
  return <TestResult id={id} score={Number.isFinite(score) ? score : 0} correct={Number.isFinite(correct) ? correct : 0} />
}
