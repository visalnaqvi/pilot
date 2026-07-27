import { TestResult } from '@/app/_components/test-screens'

export default async function ResultPage({ searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ score?: string; correct?: string; total?: string; questions?: string }> }) {
  const search = await searchParams
  const score = Number(search.score)
  const correct = Number(search.correct)
  const total = Number(search.total)
  const questionCount = Number(search.questions)
  return <TestResult
    score={Number.isFinite(score) ? score : 0}
    correct={Number.isFinite(correct) ? correct : 0}
    total={Number.isFinite(total) ? total : 0}
    questionCount={Number.isFinite(questionCount) ? questionCount : 0}
  />
}
