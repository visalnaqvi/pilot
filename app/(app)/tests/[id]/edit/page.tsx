import { EditTest } from '@/app/_components/test-screens'

export default async function EditTestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <EditTest id={id} />
}
