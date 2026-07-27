import { TakeTest } from '@/app/_components/test-screens'

export default async function TakeTestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <TakeTest id={id} />
}
