import { TakeTest } from '@/app/_components/test-screens'

export default async function TakeTestPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ assignment?: string }>
}) {
  const { id } = await params
  const { assignment } = await searchParams
  return <TakeTest id={id} assignmentBatchId={assignment} />
}
