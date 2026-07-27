import { EditQuestion } from '@/app/_components/manage-questions'
export default async function EditQuestionPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <EditQuestion id={id} /> }
