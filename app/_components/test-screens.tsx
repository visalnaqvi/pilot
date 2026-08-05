'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { authenticatedFetch } from '@/lib/authenticated-fetch'
import { uploadAuthorizedFile } from '@/lib/file-upload'
import { useAuth } from './auth-context'
import { ExamResolver } from './exam-resolver'
import { MathText, MathTextEditor } from './math-components'
import { SearchPicker } from './search-picker'
import type { LearnerQuestion, MockTest, QuestionContent, QuestionFormat } from './test-types'
import type { ExamCatalogEntry, ExamSelectionStatus } from '@/lib/exam-catalog'
import { shouldUseStandardTestEditor } from '@/lib/test-editing'
import { useTeacherOrganisations } from './use-teacher-organisations'

type DraftQuestion = { key: string;
questionId?: string;
content: QuestionContent;
marks: number;
revision: number;
isNew: boolean;
format: QuestionFormat }
type Exam = ExamCatalogEntry
type Category = { id: string;
name: string;
examId: string;
organisationId?: string }

const blankContent = (): QuestionContent => ({ prompt: '', options: ['', '', '', ''], correctAnswer: 0, optionImageUrls: ['', '', '', ''] })
const containsEquation = (content: QuestionContent) => /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/.test(`${content.prompt}\n${content.options.join('\n')}`)
const questionFormat = (content: QuestionContent): QuestionFormat => content.format || (content.promptImageUrl || content.optionImageUrls?.some(Boolean) ? 'image' : containsEquation(content) ? 'equation' : 'plain')
const blankDraft = (): DraftQuestion => ({ key: crypto.randomUUID(), content: blankContent(), marks: 1, revision: 1, isNew: true, format: 'plain' })
const cleanContent = (content: QuestionContent, format: QuestionFormat): QuestionContent => ({ ...content, format, prompt: content.prompt.trim(), options: content.options.map((option) => option.trim()), optionImageUrls: (content.optionImageUrls || []).map((url) => url || '') })
const validContent = (content: QuestionContent) => !!content.prompt && content.options.length === 4 && content.options.every(Boolean) && content.correctAnswer >= 0 && content.correctAnswer < content.options.length
function QuestionFields({ draft, onChange, uploadImage }: { draft: DraftQuestion;
onChange: (update: Partial<DraftQuestion>) => void;
uploadImage: (file: File, slot: string) => Promise<string> }) {
  function updateContent(update: Partial<QuestionContent>) { onChange({ content: { ...draft.content, ...update } }) }
  function updateOption(optionIndex: number, value: string) { const options = [...draft.content.options];
options[optionIndex] = value;
updateContent({ options }) }
  function updateOptionImage(optionIndex: number, url: string) { const optionImageUrls = [...(draft.content.optionImageUrls || ['', '', '', ''])];
optionImageUrls[optionIndex] = url;
updateContent({ optionImageUrls }) }
  async function chooseImage(file: File | undefined, slot: 'prompt' | number) { if (!file) return;
try { const url = await uploadImage(file, slot === 'prompt' ? 'prompt' : `option-${slot}`);
if (slot === 'prompt') updateContent({ promptImageUrl: url });
else updateOptionImage(slot, url) } catch (reason) { window.alert(reason instanceof Error ? reason.message : 'Unable to upload image.') } }
  const showImages = draft.format === 'image'

  return <><label className="mt-4 block text-sm font-bold">Question type<select value={draft.format} onChange={(event) => onChange({ format: event.target.value as QuestionFormat })} className="mt-2 block rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal"><option value="plain">Plain text</option><option value="equation">Equation</option><option value="image">Image with text</option></select></label><MathTextEditor multiline required showEquationTools={draft.format === 'equation'} value={draft.content.prompt} onChange={(prompt) => updateContent({ prompt })} placeholder={draft.format === 'equation' ? 'Write your question and insert equations where needed.' : 'Write your question text.'} inputClassName="mt-4 min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-indigo-500" />{showImages && <ImageUpload label="Question image" value={draft.content.promptImageUrl} onSelect={(file) => chooseImage(file, 'prompt')} onRemove={() => updateContent({ promptImageUrl: '' })} />}<div className="mt-4 grid gap-3 sm:grid-cols-2">{draft.content.options.map((option, optionIndex) => <div key={optionIndex} className="rounded-lg border border-slate-200 p-2 text-sm"><div className="flex items-start gap-2"><input type="radio" name={`correct-${draft.key}`} checked={draft.content.correctAnswer === optionIndex} onChange={() => updateContent({ correctAnswer: optionIndex })} className="mt-2" /><div className="min-w-0 flex-1"><MathTextEditor required showEquationTools={draft.format === 'equation'} value={option} onChange={(value) => updateOption(optionIndex, value)} placeholder={`Option ${String.fromCharCode(65 + optionIndex)}`} inputClassName="w-full rounded-md border border-slate-200 px-2 py-1 outline-none focus:border-indigo-500" />{showImages && <ImageUpload label={`Option ${String.fromCharCode(65 + optionIndex)} image`} value={draft.content.optionImageUrls?.[optionIndex]} onSelect={(file) => chooseImage(file, optionIndex)} onRemove={() => updateOptionImage(optionIndex, '')} compact />}</div></div></div>)}</div></>
}

function ImageUpload({ label, value, onSelect, onRemove, compact = false }: { label: string;
value?: string;
onSelect: (file?: File) => void;
onRemove: () => void;
compact?: boolean }) {
  return <div className={`${compact ? 'mt-2' : 'mt-3'} rounded-lg border border-dashed border-slate-300 p-3`}><div className="flex flex-wrap items-center gap-3"><label className="cursor-pointer rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700">{value ? 'Replace image' : 'Upload image'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(event) => { onSelect(event.target.files?.[0]);
event.currentTarget.value = '' }} /></label>{value && <button type="button" onClick={onRemove} className="text-xs font-bold text-rose-600">Remove</button>}<span className="text-xs text-slate-500">{label}</span></div>{value && <Image src={value} alt={`${label} preview`} width={640} height={360} unoptimized className="mt-3 max-h-48 rounded-md border border-slate-200 object-contain" />}</div>
}

function TestEditor({ testId, initialTest }: { testId?: string;
initialTest?: MockTest }) {
  const { user, profile } = useAuth()
  const router = useRouter()
  const [title, setTitle] = useState(initialTest?.title || '')
  const [examId, setExamId] = useState(initialTest?.examId || '')
  const [categoryIdValue, setCategoryIdValue] = useState(initialTest?.categoryId || '')
  const [description, setDescription] = useState(initialTest?.description || '')
  const [duration, setDuration] = useState(initialTest?.durationMinutes || 30)
  const [visibility, setVisibility] = useState<'public' | 'private' | 'assigned'>(initialTest?.visibility || 'public')
  const [organisationId, setOrganisationId] = useState(initialTest?.organisationId || '')
  const [exams, setExams] = useState<Exam[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [addingExam, setAddingExam] = useState(false)
  const [newExamName, setNewExamName] = useState('')
  const [resolvingExam, setResolvingExam] = useState(false)
  const [questions, setQuestions] = useState<DraftQuestion[]>([])
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const uploadedImagePaths = useRef(new Map<string, string>())
  const { organisations: teacherOrganisations, loading: teacherOrganisationsLoading } = useTeacherOrganisations(profile?.role === 'user' ? user : null)
  const isTeacher = profile?.role === 'user' && (
    initialTest
      ? teacherOrganisations.some(item => item.id === initialTest.organisationId)
      : teacherOrganisations.length > 0
  )
  const allowed = profile?.role === 'admin' || profile?.role === 'organisation' || isTeacher
  const contentOrganisationId = initialTest?.organisationId
    || (profile?.role === 'organisation' ? profile.organizationId || '' : organisationId)
    || (teacherOrganisations.length === 1 ? teacherOrganisations[0].id : '')
  const contentVisibility = isTeacher && visibility === 'public' ? 'assigned' : visibility
  const marks = useMemo(() => questions.reduce((total, item) => total + Number(item.marks || 0), 0), [questions])
  const examOptions = useMemo(() => [...exams].sort((a, b) => a.name.localeCompare(b.name)), [exams])
  const categoryOptions = useMemo(() => categories
    .filter(item => item.examId === examId)
    .filter(item => profile?.role === 'admin' || item.organisationId === contentOrganisationId)
    .sort((a, b) => a.name.localeCompare(b.name)), [categories, contentOrganisationId, examId, profile?.role])
  const selectedExam = exams.find((item) => item.id === examId)
  const selectedCategory = categories.find((item) => item.id === categoryIdValue && item.examId === examId)

  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    void Promise.all([
      authenticatedFetch(user, '/api/exams?scope=catalog', { cache: 'no-store', signal: controller.signal }),
      authenticatedFetch(user, `/api/categories${contentOrganisationId ? `?organizationId=${encodeURIComponent(contentOrganisationId)}` : ''}`, { cache: 'no-store', signal: controller.signal }),
    ]).then(async ([examResponse, categoryResponse]) => {
      const examBody = await examResponse.json()
      const categoryBody = await categoryResponse.json()
      if (!examResponse.ok) throw new Error(examBody.error || 'Unable to load exams.')
      if (!categoryResponse.ok) throw new Error(categoryBody.error || 'Unable to load categories.')
      setExams(examBody.items || [])
      setCategories(categoryBody.items || [])
    }).catch(reason => {
      if (!controller.signal.aborted) setMessage(reason instanceof Error ? reason.message : 'Unable to load test options.')
    })
    return () => controller.abort()
  }, [contentOrganisationId, user])

  useEffect(() => {
    void (async () => {
      await Promise.resolve()
      if (!testId) { setQuestions([blankDraft()]);
return }
      if (!initialTest) return
      if (initialTest.questions) {
        setQuestions(initialTest.questions.map((question) => ({
          key: crypto.randomUUID(),
          questionId: 'questionId' in question && typeof question.questionId === 'string' ? question.questionId : undefined,
          content: question,
          marks: question.marks,
          revision: 1,
          isNew: !('questionId' in question && question.questionId),
          format: questionFormat(question),
        })))
        return
      }
    })()
  }, [initialTest, testId, user])

  function updateQuestion(index: number, update: Partial<DraftQuestion>) { setQuestions((current) => current.map((item, i) => i === index ? { ...item, ...update } : item)) }

  async function uploadQuestionImage(file: File, questionKey: string, slot: string) {
    void questionKey
    void slot
    if (!user) throw new Error('Sign in before uploading an image.')
    if (!file.type.startsWith('image/')) throw new Error('Please select an image file.')
    if (file.size > 5 * 1024 * 1024) throw new Error('Images must be 5 MB or smaller.')
    if (profile?.role !== 'admin' && !contentOrganisationId) throw new Error('Select an institute before uploading question images.')
    const uploaded = await uploadAuthorizedFile(user, file, contentOrganisationId || null)
    const response = await authenticatedFetch(user, `/api/files/${uploaded.fileId}/download`, { cache: 'no-store' })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || 'Unable to preview the uploaded image.')
    uploadedImagePaths.current.set(body.url, uploaded.path)
    return body.url as string
  }

  async function addCategory(categoryName: string) {
    const name = categoryName.trim()
    if (!name || !user || !examId || (profile?.role !== 'admin' && !contentOrganisationId)) { setMessage('Select an institute and exam, then enter a valid category name.');
return }
    try {
      const ownedCategory = categories.find((item) => item.examId === examId && item.name.toLowerCase() === name.toLowerCase())
      if (ownedCategory) {
        setCategoryIdValue(ownedCategory.id)
        return
      }
      const response = await authenticatedFetch(user, '/api/categories', {
        method: 'POST',
        body: JSON.stringify({ name, examId, organizationId: contentOrganisationId || null }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to add category.')
      setCategories(current => current.some(item => item.id === body.item.id) ? current : [...current, body.item])
      setCategoryIdValue(body.item.id)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to add category.')
    }
  }

  function applyResolvedExam(exam: ExamCatalogEntry, status: ExamSelectionStatus) {
    setExams(current => current.some(item => item.id === exam.id) ? current : [...current, exam])
    setExamId(exam.id)
    setCategoryIdValue('')
    setAddingExam(false)
    setMessage(status === 'created' ? `Created and selected ${exam.name}.` : `Selected ${exam.name}.`)
  }

  async function selectCatalogExam(exam: ExamCatalogEntry) {
    if (!user) return
    setResolvingExam(true)
    setMessage('')
    try {
      const response = await authenticatedFetch(user, '/api/exams/resolve', {
        method: 'POST',
        body: JSON.stringify({ selectionId: exam.id }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to select this exam.')
      applyResolvedExam(body.exam as ExamCatalogEntry, 'selected')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to select this exam.')
    } finally {
      setResolvingExam(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || !allowed || (profile?.role !== 'admin' && !contentOrganisationId)) return
    const cleaned = questions.map((item) => ({ ...item, content: cleanContent(item.content, item.format), marks: Number(item.marks) }))
    if (!title.trim() || !selectedExam || !selectedCategory || cleaned.length === 0 || cleaned.some((item) => !validContent(item.content) || item.marks < 1)) {
      setMessage('Select an institute, then add a title, exam, category, every question and option, and at least one mark per question.')
      return
    }
    setSaving(true)
    setMessage('')
    try {
      const response = await authenticatedFetch(user, '/api/tests', {
        method: testId ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...(testId ? { id: testId } : {}),
          organizationId: contentOrganisationId || null,
          examId: selectedExam.id,
          categoryId: selectedCategory.id,
          title: title.trim(),
          description: description.trim(),
          durationMinutes: Number(duration) || 0,
          visibility: contentVisibility,
          published: true,
          questions: cleaned.map(draft => ({
            questionId: draft.questionId,
            kind: 'mcq',
            prompt: draft.content.prompt,
            options: draft.content.options,
            correctAnswer: draft.content.correctAnswer,
            marks: draft.marks,
            format: draft.format,
            promptImagePath: draft.content.promptImageUrl
              ? uploadedImagePaths.current.get(draft.content.promptImageUrl) || draft.content.promptImagePath || null
              : null,
            optionImagePaths: (draft.content.optionImageUrls || []).map((url, index) => (
              url ? uploadedImagePaths.current.get(url) || draft.content.optionImagePaths?.[index] || '' : ''
            )),
          })),
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to save this test.')
      router.push(testId ? `/tests/${testId}` : '/tests')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to save this test.')
    } finally {
      setSaving(false)
    }
  }

  if (teacherOrganisationsLoading) return <p className="mt-6 text-slate-500">Checking teaching permissions…</p>
  if (!allowed) return null
  return (
    <form onSubmit={save} className="mt-8 space-y-6">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        {isTeacher && <label className="mb-4 block text-sm font-bold">Institute<select value={contentOrganisationId} disabled={Boolean(initialTest)} onChange={event => { setOrganisationId(event.target.value); setCategoryIdValue('') }} required className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal disabled:bg-slate-100"><option value="">Select institute</option>{teacherOrganisations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <label className="block text-sm font-bold">Test title<input value={title} onChange={(event) => setTitle(event.target.value)} required className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5" /></label>
        <div className="mt-4"><label className="block text-sm font-bold">Exam<span className="mt-2 block font-normal"><SearchPicker value={examId} options={examOptions.map((item) => ({ id: item.id, label: item.name, detail: [...new Set([item.primaryAlias, ...item.aliases])].filter(alias => alias && alias !== item.name).join(', ') || undefined }))} onChange={(option) => { const exam = exams.find(item => item.id === option.id); if (exam) void selectCatalogExam(exam) }} onCreate={(query) => { setNewExamName(query); setAddingExam(true) }} createLabel="Create exam" placeholder="Search the exam catalog" disabled={resolvingExam} /></span></label>{addingExam && <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-slate-900">Create a new exam</p><p className="mt-1 text-xs text-slate-500">Catalog matches are checked before a new exam can be created.</p></div><button type="button" onClick={() => setAddingExam(false)} className="text-sm font-bold text-indigo-700">Cancel</button></div><ExamResolver key={newExamName} initialName={newExamName} autoFocus autoResolveInitialName onResolved={applyResolvedExam} /></div>}</div>
        <div className="mt-4"><label className="block text-sm font-bold">Category<span className="mt-2 block font-normal"><SearchPicker value={categoryIdValue} options={categoryOptions.map((item) => ({ id: item.id, label: item.name }))} onChange={(option) => setCategoryIdValue(option.id)} onCreate={(query) => void addCategory(query)} createLabel="Create category" placeholder={examId ? 'Search or create a category' : 'Select an exam first'} disabled={!examId} /></span></label></div>
        <label className="mt-4 block text-sm font-bold">Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2.5" /></label>
        <label className="mt-4 block max-w-48 text-sm font-bold">Duration (minutes)<input value={duration} onChange={(event) => setDuration(Number(event.target.value))} type="number" min="0" className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5" /></label>
        {(profile?.role === 'organisation' || isTeacher) && <fieldset className="mt-5"><legend className="text-sm font-bold">Access mode</legend><div className={`mt-3 grid gap-3 ${isTeacher ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>{!isTeacher && <AccessModeOption title="Public" description="Visible to everyone with unlimited attempts and standard timed mode." checked={contentVisibility === 'public'} select={() => setVisibility('public')} />}<AccessModeOption title="Private" description="Visible only to joined institute students, with unlimited attempts." checked={contentVisibility === 'private'} select={() => setVisibility('private')} /><AccessModeOption title="Assigned" description="Hidden from the test library and available only through a live assignment." checked={contentVisibility === 'assigned'} select={() => setVisibility('assigned')} /></div></fieldset>}
      </div>
      {questions.map((question, index) => <div key={question.key} className="rounded-2xl bg-white p-6 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h2 className="font-bold">Question {index + 1}</h2><p className="text-xs text-slate-500">Saved to the question bank and linked to this test.</p></div><div className="flex gap-3">{index > 0 && <button type="button" onClick={() => setQuestions((current) => { const copy = [...current];
[copy[index - 1], copy[index]] = [copy[index], copy[index - 1]];
return copy })} className="text-sm font-bold text-indigo-600">Up</button>}<button type="button" onClick={() => setQuestions((current) => current.filter((_, i) => i !== index))} className="text-sm font-bold text-rose-600">Remove</button></div></div><QuestionFields draft={question} onChange={(update) => updateQuestion(index, update)} uploadImage={(file, slot) => uploadQuestionImage(file, question.key, slot)} /><div className="mt-4"><label className="block max-w-36 text-sm font-bold">Marks<input value={question.marks} onChange={(event) => updateQuestion(index, { marks: Number(event.target.value) })} type="number" min="1" required className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2" /></label></div></div>)}
      <div className="flex flex-wrap items-center justify-between gap-4"><button type="button" onClick={() => setQuestions((current) => [...current, blankDraft()])} className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 font-bold text-indigo-700">+ New question</button><button disabled={saving} className="rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : `${testId ? 'Save test' : 'Publish test'} · ${marks} marks`}</button></div>
      {message && <p className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{message}</p>}
    </form>
  )
}

function AccessModeOption({ title, description, checked, select }: { title: string; description: string; checked: boolean; select: () => void }) {
  return <label className={`cursor-pointer rounded-xl border p-4 transition-colors ${checked ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500' : 'border-slate-200 hover:border-indigo-200'}`}><span className="flex items-center gap-2"><input type="radio" checked={checked} onChange={select} /><b className="text-sm text-slate-900">{title}</b></span><span className="mt-2 block text-xs leading-5 text-slate-600">{description}</span></label>
}

export function CreateTest() { return <section className="mx-auto max-w-3xl"><Link href="/tests" className="text-sm font-bold text-indigo-600">← Test library</Link><h1 className="mt-5 text-4xl font-black">Build a mock test</h1><TestEditor /></section> }

export function EditTest({ id }: { id: string }) { const { user, profile } = useAuth();
const { organisations: teacherOrganisations, loading: teacherOrganisationsLoading } = useTeacherOrganisations(profile?.role === 'user' ? user : null);
const router = useRouter();
const [test, setTest] = useState<MockTest | null>(null);
const [message, setMessage] = useState('');
const [deleting, setDeleting] = useState(false);
useEffect(() => {
  if (!user) return
  authenticatedFetch(user, `/api/tests?id=${encodeURIComponent(id)}&edit=1`, { cache: 'no-store' })
    .then(async response => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to load this test.')
      setTest(body.item)
    })
    .catch(reason => setMessage(reason instanceof Error ? reason.message : 'Unable to load this test.'))
}, [id, user]);
const canManage = !!test && (profile?.role === 'admin' || test.createdBy === user?.uid || (profile?.role === 'user' && teacherOrganisations.some(item => item.id === test.organisationId)));
async function softDelete() { if (!test || !user || !confirm('Soft-delete this test?')) return;
setDeleting(true);
try {
const response = await authenticatedFetch(user, '/api/tests', { method: 'PATCH', body: JSON.stringify({ id, deleted: true }) });
if (!response.ok) throw new Error((await response.json()).error || 'Unable to delete this test.');
router.push('/tests') } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to delete this test.') } finally { setDeleting(false) } } if (!test || teacherOrganisationsLoading) return <p className="text-slate-500">Loading test…</p>;
if (!canManage) return <section><h1 className="text-3xl font-black">Access denied</h1></section>;
if (!shouldUseStandardTestEditor(test)) return <section className="mx-auto max-w-3xl"><Link href={`/tests/${id}`} className="text-sm font-bold text-indigo-600">← Back to test</Link><div className="mt-6 rounded-2xl border border-indigo-200 bg-white p-7"><h1 className="text-3xl font-black">AI-generated draft</h1><p className="mt-3 text-slate-600">Finish reviewing and publish this draft before editing it as a standard test.</p><Link href="/manage/tests/generate" className="mt-6 inline-block rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white">Open AI generator</Link></div></section>;
return <section className="mx-auto max-w-3xl"><Link href={`/tests/${id}`} className="text-sm font-bold text-indigo-600">← Back to test</Link><div className="mt-5 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between"><h1 className="text-4xl font-black">Edit mock test</h1><button disabled={deleting} onClick={softDelete} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-bold text-rose-700">Soft delete</button></div>{message && <p className="mt-4 text-rose-700">{message}</p>}<TestEditor testId={id} initialTest={test} /></section> }

type AssignmentWindow = { id: string; assignmentBatchId: string; assignmentName?: string; linkedTaskId?: string; maxAttempts?: number; attemptsUsed?: number; startAt?: { toDate: () => Date }; endAt?: { toDate: () => Date }; deadline?: { toDate: () => Date } }
type TestSessionStatus = 'open' | 'not_started' | 'ended' | 'attempts_exhausted' | 'invalid'
type TestSessionPayload = {
  status?: TestSessionStatus
  error?: string
  test?: MockTest
  questions?: LearnerQuestion[]
  assignment?: {
    id: string
    assignmentBatchId: string
    assignmentName?: string
    linkedTaskId?: string
    maxAttempts?: number
    attemptsUsed?: number
    startAt?: string
    endAt?: string
    deadline?: string
  } | null
}
function useTestSession(id: string, requestedAssignmentBatchId: string | undefined, user?: { getIdToken: () => Promise<string> }) { const [test, setTest] = useState<MockTest | null>(null);
const [questions, setQuestions] = useState<LearnerQuestion[]>([]);
const [assignment, setAssignment] = useState<AssignmentWindow | null>(null);
const [status, setStatus] = useState<TestSessionStatus | null>(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState('');
useEffect(() => { if (!user) return;
const controller = new AbortController();
void (async () => {
  try {
    const queryString = new URLSearchParams({ testId: id })
    if (requestedAssignmentBatchId) queryString.set('assignment', requestedAssignmentBatchId)
    const response = await fetch(`/api/test-session?${queryString}`, {
      headers: { authorization: `Bearer ${await user.getIdToken()}` },
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => ({})) as TestSessionPayload
    if (!response.ok) throw new Error(payload.error || 'Unable to load this test.')
    const loadedAssignment = payload.assignment
      ? {
          ...payload.assignment,
          startAt: payload.assignment.startAt ? { toDate: () => new Date(payload.assignment!.startAt!) } : undefined,
          endAt: payload.assignment.endAt ? { toDate: () => new Date(payload.assignment!.endAt!) } : undefined,
          deadline: payload.assignment.deadline ? { toDate: () => new Date(payload.assignment!.deadline!) } : undefined,
        }
      : null
    setAssignment(loadedAssignment)
    setStatus(payload.status || null)
    setTest(payload.test || null)
    setQuestions(payload.questions || [])
  } catch (reason) {
    if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load this test.')
  } finally {
    if (!controller.signal.aborted) setLoading(false)
  }
})()
return () => controller.abort() }, [id, requestedAssignmentBatchId, user]);
return { test, questions, assignment, status, loading, error } }
function useAttemptCount(_testId: string, userId?: string) {
return { count: 0, privateCount: 0, ready: Boolean(userId) } }
export function TakeTest({ id, assignmentBatchId }: { id: string; assignmentBatchId?: string }) { const { user, isImpersonating } = useAuth();
const { test, questions, assignment, status: windowStatus, loading, error } = useTestSession(id, assignmentBatchId, user || undefined);
const { ready: attemptsReady } = useAttemptCount(id, user?.uid);
const router = useRouter();
const [answers, setAnswers] = useState<Record<number, number | string>>({});
const [submitting, setSubmitting] = useState(false);
const submittingRef = useRef(false);
const [submitError, setSubmitError] = useState('');
const [sessionStarted, setSessionStarted] = useState(false);
const [fullscreenError, setFullscreenError] = useState('');
const [securityViolation, setSecurityViolation] = useState(false);
const allowedFullscreenExit = useRef(false);
const pendingAutoSubmitReason = useRef<'time_expired' | 'fullscreen_exited' | null>(null);
if (loading) return <p className="text-slate-500">Loading test…</p>;
if (!user) return <p className="text-slate-500">Loading your test session…</p>;
if (isImpersonating) return <TestAccessBlocked title="View-only impersonation" message="Exit impersonation before starting or submitting a test." />;
const assignmentStart = assignment?.startAt?.toDate();
const assignmentEnd = assignment?.endAt?.toDate() || assignment?.deadline?.toDate();
if (assignment && windowStatus === 'not_started') return <section className="mx-auto max-w-2xl"><h1 className="text-3xl font-black">This assignment has not started</h1><p className="mt-3 text-slate-600">You can access it from <b className="text-slate-900">{assignmentStart?.toLocaleString()}</b>.</p><Link href="/tests" className="mt-6 inline-block text-sm font-bold text-indigo-600">← Back to tests</Link></section>;
if (assignment && windowStatus === 'ended') return <section className="mx-auto max-w-2xl"><h1 className="text-3xl font-black">This assignment has ended</h1><p className="mt-3 text-slate-600">The access window closed on <b className="text-slate-900">{assignmentEnd?.toLocaleString()}</b>.</p><Link href="/tests" className="mt-6 inline-block text-sm font-bold text-indigo-600">← Back to tests</Link></section>;
if (assignment && windowStatus === 'attempts_exhausted') return <TestAccessBlocked title="Assignment attempt limit reached" message={`You have used all ${assignment.maxAttempts || 1} attempt${(assignment.maxAttempts || 1) === 1 ? '' : 's'} allowed for this assignment.`} />;
if (assignment && windowStatus === 'invalid') return <TestAccessBlocked title="Assignment unavailable" message="This assignment does not have a valid access window. Contact your institute." />;
if (!attemptsReady) return <p className="text-slate-500">Loading test…</p>;
if (!test) return <section><h1 className="text-3xl font-black">Test unavailable</h1><p>{error || 'This test does not exist or you do not have access to it.'}</p></section>;
const isAssignedTest = test.visibility === 'assigned';
const requiresSecureMode = test.visibility !== 'public';
if (isAssignedTest && !assignment) return <TestAccessBlocked title="Assignment required" message="This test can only be opened from an assignment created for you." />;
const markAssignmentTaskStarted = async () => {
  if (!assignment?.linkedTaskId) return
  const response = await authenticatedFetch(user, '/api/tasks', {
    method: 'PATCH',
    body: JSON.stringify({ action: 'status', taskId: assignment.linkedTaskId, status: 'in_progress' }),
  })
  if (!response.ok) throw new Error((await response.json()).error || 'Unable to start the linked task.')
};
const submit = async (automatic?: { reason: 'time_expired' | 'fullscreen_exited' }) => { if (!user || submittingRef.current) return;
submittingRef.current = true;
if (automatic) pendingAutoSubmitReason.current = automatic.reason;
const autoSubmitReason = automatic?.reason || pendingAutoSubmitReason.current;
setSubmitting(true);
setSubmitError('');
try {
  const response = await fetch('/api/test-submissions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await user.getIdToken()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      testId: test.id,
      ...(assignment?.assignmentBatchId ? { assignmentBatchId: assignment.assignmentBatchId } : {}),
      answers: questions.map((_, questionIndex) => answers[questionIndex] ?? null),
      autoSubmitted: Boolean(autoSubmitReason),
      ...(autoSubmitReason ? { autoSubmitReason } : {}),
    }),
  })
  const payload = await response.json().catch(() => ({})) as { id?: string; error?: string }
  if (!response.ok || !payload.id) throw new Error(payload.error || 'Unable to save your submission.')
  try { window.localStorage.removeItem(testTimerKey(test.id, user.uid, assignment?.assignmentBatchId)) } catch { /* Submission is already saved. */ }
  allowedFullscreenExit.current = true;
  if (document.fullscreenElement) { try { await document.exitFullscreen() } catch { /* Navigation can still complete. */ } }
  router.push(`/tests/${id}/result?submission=${encodeURIComponent(payload.id)}`)
} catch (reason) {
  setSubmitError(reason instanceof Error ? reason.message : 'Unable to save your submission. Please try again.')
} finally {
  submittingRef.current = false;
  setSubmitting(false)
} };
const startSecureSession = async () => {
  setFullscreenError('')
  if (!document.fullscreenEnabled) { setFullscreenError('This browser does not support the required fullscreen exam mode.'); return }
  try {
    await document.documentElement.requestFullscreen()
    try {
      await markAssignmentTaskStarted()
    } catch (reason) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
      throw reason
    }
    setSessionStarted(true)
  } catch (reason) { setFullscreenError(reason instanceof Error ? `Unable to start the assignment: ${reason.message}` : 'Fullscreen permission was not granted. Allow fullscreen access to start the test.') }
};
if (requiresSecureMode && !sessionStarted) return <SecureTestStart test={test} questionCount={questions.length} error={fullscreenError} start={() => void startSecureSession()} />;
if (requiresSecureMode && securityViolation) return <section className="mx-auto max-w-2xl"><div className="rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm"><span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose-100 text-rose-700"><ShieldAlertIcon /></span><p className="mt-5 text-sm font-bold tracking-widest text-rose-600">SECURE MODE ENDED</p><h1 className="mt-2 text-3xl font-black">Fullscreen was exited</h1><p className="mt-3 text-slate-600">Your test is being submitted automatically according to the exam rules.</p>{submitError && <><p className="mt-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{submitError}</p><button type="button" disabled={submitting} onClick={() => void submit()} className="mt-5 rounded-xl bg-rose-600 px-5 py-3 font-bold text-white disabled:opacity-50">Retry submission</button></>}</div></section>;
const attemptedCount = Object.values(answers).filter(answer => answer !== '').length;
const progress = questions.length ? attemptedCount / questions.length * 100 : 0;
return <section className="mx-auto max-w-6xl">{requiresSecureMode && <SecureExamGuard allowedExit={allowedFullscreenExit} onViolation={() => { setSecurityViolation(true); void submit({ reason: 'fullscreen_exited' }) }} />}<div className="rounded-2xl bg-slate-900 p-7 text-white"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-bold tracking-widest text-indigo-300">{requiresSecureMode ? 'SECURE MOCK TEST' : 'PUBLIC MOCK TEST'}</p><h1 className="mt-2 text-3xl font-black">{test.title}</h1><p className="mt-3 text-slate-300">{questions.length} questions · {test.durationMinutes || 'No'} minute limit</p></div>{requiresSecureMode ? <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" />Fullscreen active</span> : <span className="inline-flex items-center gap-2 rounded-full bg-sky-500/15 px-3 py-1.5 text-xs font-bold text-sky-300">Standard timed mode</span>}</div></div><div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start"><main className="space-y-5">{questions.map((question, questionIndex) => <article id={`question-${questionIndex + 1}`} key={questionIndex} className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6"><p className="text-sm font-bold text-indigo-600">QUESTION {questionIndex + 1} · {question.marks} MARK{question.marks === 1 ? '' : 'S'}</p><h2 className="mt-2 text-lg font-bold"><MathText>{question.prompt}</MathText></h2>{question.promptImageUrl && <Image src={question.promptImageUrl} alt={`Question ${questionIndex + 1}`} width={960} height={540} unoptimized className="mt-4 max-h-96 rounded-xl border border-slate-200 object-contain" />}{question.kind === 'short_answer' ? <textarea value={typeof answers[questionIndex] === 'string' ? answers[questionIndex] : ''} onChange={(event) => setAnswers(current => ({ ...current, [questionIndex]: event.target.value }))} placeholder="Write your answer" rows={7} className="mt-5 w-full rounded-xl border border-slate-200 p-4 outline-none focus:border-indigo-500" /> : <div className="mt-5 grid gap-3">{question.options.map((option, optionIndex) => <label key={optionIndex} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 ${answers[questionIndex] === optionIndex ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}`}><input type="radio" name={`answer-${questionIndex}`} checked={answers[questionIndex] === optionIndex} onChange={() => setAnswers((current) => ({ ...current, [questionIndex]: optionIndex }))} /><span className="min-w-0"><MathText>{option}</MathText>{question.optionImageUrls?.[optionIndex] && <Image src={question.optionImageUrls[optionIndex]} alt={`Option ${String.fromCharCode(65 + optionIndex)}`} width={640} height={360} unoptimized className="mt-3 max-h-56 rounded-lg border border-slate-200 object-contain" />}</span></label>)}</div>}</article>)}{submitError && <p className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{submitError}</p>}<button disabled={submitting} onClick={() => void submit()} className="w-full rounded-xl bg-indigo-600 py-4 font-bold text-white disabled:opacity-50">{submitting ? 'Saving submission…' : 'Submit test'}</button></main><aside className="order-first lg:order-none lg:sticky lg:top-6"><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><TestTimer durationMinutes={test.durationMinutes} assignmentEndAt={assignmentEnd?.getTime()} storageKey={testTimerKey(test.id, user.uid, assignment?.assignmentBatchId)} onExpire={() => void submit({ reason: 'time_expired' })} /><div className="mt-5 border-t border-slate-200 pt-5"><div className="flex items-center justify-between gap-3"><h2 className="font-black text-slate-900">Progress</h2><span className="text-sm font-bold text-indigo-700">{attemptedCount}/{questions.length}</span></div><div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-600 transition-[width] duration-300" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-xs text-slate-500">{Math.round(progress)}% attempted</p></div><div className="mt-5 border-t border-slate-200 pt-5"><h2 className="font-black text-slate-900">Questions</h2><div className="mt-3 grid grid-cols-5 gap-2">{questions.map((_, index) => { const attempted = answers[index] !== undefined && answers[index] !== ''; return <button key={index} type="button" onClick={() => document.getElementById(`question-${index + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} aria-label={`Go to question ${index + 1}, ${attempted ? 'attempted' : 'pending'}`} className={`grid h-10 place-items-center rounded-lg border text-sm font-black transition-colors ${attempted ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>{index + 1}</button> })}</div><div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold text-slate-600"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Attempted</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-300" />Pending</span></div></div></div></aside></div></section> }

function TestAccessBlocked({ title, message }: { title: string; message: string }) {
  return <section className="mx-auto max-w-2xl"><div className="rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm"><h1 className="text-3xl font-black text-slate-950">{title}</h1><p className="mt-3 text-slate-600">{message}</p><Link href="/tests" className="mt-6 inline-block rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white">Back to tests</Link></div></section>
}

function SecureTestStart({ test, questionCount, error, start }: { test: MockTest; questionCount: number; error: string; start: () => void }) {
  return <section className="mx-auto max-w-2xl"><div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/70 sm:p-10"><span className="grid h-16 w-16 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><ShieldIcon /></span><p className="mt-6 text-sm font-bold tracking-widest text-indigo-600">SECURE EXAM MODE</p><h1 className="mt-2 text-3xl font-black text-slate-950">Ready to start {test.title}?</h1><p className="mt-3 leading-7 text-slate-600">This test runs in fullscreen mode. Read the rules below before starting.</p><div className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-5"><h2 className="font-black text-slate-900">Exam rules</h2><ul className="mt-4 space-y-3 text-sm leading-6 text-slate-700"><li className="flex gap-3"><RuleCheck />The browser will enter fullscreen mode when you start.</li><li className="flex gap-3"><RuleCheck />Do not press Escape or leave fullscreen before submitting.</li><li className="flex gap-3"><RuleCheck />Leaving fullscreen will immediately end and auto-submit the test.</li><li className="flex gap-3"><RuleCheck />The timer cannot be reset by refreshing the page.</li></ul></div><div className="mt-6 grid gap-3 rounded-xl bg-indigo-50 p-4 text-sm sm:grid-cols-2"><p><span className="block text-xs font-bold uppercase tracking-wide text-indigo-500">Questions</span><b className="mt-1 block text-indigo-950">{questionCount}</b></p><p><span className="block text-xs font-bold uppercase tracking-wide text-indigo-500">Time limit</span><b className="mt-1 block text-indigo-950">{test.durationMinutes ? `${test.durationMinutes} minutes` : 'No test limit'}</b></p></div>{error && <p className="mt-5 rounded-xl bg-rose-50 p-4 text-sm font-medium text-rose-700">{error}</p>}<div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Link href="/tests" className="rounded-xl border border-slate-300 px-5 py-3 text-center text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</Link><button type="button" onClick={start} className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700">Start test in fullscreen</button></div></div></section>
}

function SecureExamGuard({ allowedExit, onViolation }: { allowedExit: React.RefObject<boolean>; onViolation: () => void }) {
  const violationRef = useRef(onViolation)
  const triggeredRef = useRef(false)
  useEffect(() => { violationRef.current = onViolation }, [onViolation])
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && !allowedExit.current && !triggeredRef.current) { triggeredRef.current = true; violationRef.current() }
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    handleFullscreenChange()
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [allowedExit])
  return null
}

function RuleCheck() { return <span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><svg aria-hidden="true" viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 10 3 3 7-7" /></svg></span> }
function ShieldIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4.5 6v5.5c0 4.6 3 7.6 7.5 9.5 4.5-1.9 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m9 12 2 2 4-4" /></svg> }
function ShieldAlertIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4.5 6v5.5c0 4.6 3 7.6 7.5 9.5 4.5-1.9 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="M12 8v5M12 16h.01" /></svg> }

const testTimerKey = (testId: string, userId: string, assignmentBatchId?: string) => `mockpilot:test-timer:${testId}:${userId}${assignmentBatchId ? `:${assignmentBatchId}` : ''}`

function TestTimer({ durationMinutes, assignmentEndAt, storageKey, onExpire }: { durationMinutes: number; assignmentEndAt?: number; storageKey: string; onExpire: () => void }) {
  const [remaining, setRemaining] = useState<number | null>(null)
  const expireRef = useRef(onExpire)
  const submittedRef = useRef(false)
  useEffect(() => { expireRef.current = onExpire }, [onExpire])
  useEffect(() => {
    let startedAt = Date.now()
    try {
      const stored = Number(window.localStorage.getItem(storageKey))
      if (Number.isFinite(stored) && stored > 0) startedAt = stored
      else window.localStorage.setItem(storageKey, String(startedAt))
    } catch { /* The timer still works when storage is unavailable. */ }
    const ends = [durationMinutes > 0 ? startedAt + durationMinutes * 60_000 : undefined, assignmentEndAt].filter((value): value is number => typeof value === 'number')
    if (!ends.length) return
    const endAt = Math.min(...ends)
    const tick = () => {
      const next = Math.max(0, endAt - Date.now())
      setRemaining(next)
      if (next === 0 && !submittedRef.current) { submittedRef.current = true; expireRef.current() }
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [assignmentEndAt, durationMinutes, storageKey])
  if (remaining === null) return <div><p className="text-xs font-bold uppercase tracking-widest text-slate-500">Time remaining</p><p className="mt-2 text-2xl font-black text-slate-900">No limit</p></div>
  const totalSeconds = Math.ceil(remaining / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor(totalSeconds % 3600 / 60)
  const seconds = totalSeconds % 60
  const label = hours ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  const urgent = remaining <= 5 * 60_000
  return <div aria-live={urgent ? 'polite' : 'off'}><p className="text-xs font-bold uppercase tracking-widest text-slate-500">Time remaining</p><p className={`mt-2 font-mono text-3xl font-black tabular-nums ${urgent ? 'text-rose-600' : 'text-slate-900'}`}>{label}</p>{urgent && <p className="mt-1 text-xs font-semibold text-rose-600">Your test will submit automatically.</p>}</div>
}
export function TestResult({ submissionId }: { submissionId: string }) {
const { user } = useAuth();
const [result, setResult] = useState<{ score: number | null; totalMarks: number; correctAnswers: number; questionCount: number; gradingStatus?: string; mcqScore?: number; mcqMarks?: number; pendingMarks?: number } | null>(null);
const [message, setMessage] = useState('');
useEffect(() => { if (!user || !submissionId) return;
const controller = new AbortController();
void (async () => { try {
  const response = await fetch(`/api/test-submissions/${encodeURIComponent(submissionId)}`, { headers: { authorization: `Bearer ${await user.getIdToken()}` }, signal: controller.signal });
  const payload = await response.json().catch(() => ({})) as { submission?: typeof result; error?: string };
  if (!response.ok || !payload.submission) throw new Error(payload.error || 'Unable to load your result.');
  setResult(payload.submission);
} catch (reason) { if (!controller.signal.aborted) setMessage(reason instanceof Error ? reason.message : 'Unable to load your result.'); } })();
return () => controller.abort() }, [submissionId, user]);
if (!submissionId) return <TestAccessBlocked title="Result unavailable" message="This result link does not include a submission identifier." />;
if (!result) return <p className={message ? 'text-rose-700' : 'text-slate-500'}>{message || 'Loading result…'}</p>;
const pending = result.gradingStatus === 'pending';
const displayedScore = pending ? result.mcqScore || 0 : result.score || 0;
const displayedTotal = pending ? result.mcqMarks || 0 : result.totalMarks;
return <section className="mx-auto max-w-2xl text-center"><div className="rounded-3xl bg-white p-10 shadow-sm"><p className="text-sm font-bold tracking-widest text-indigo-600">TEST COMPLETE</p><h1 className="mt-3 text-3xl font-black">{pending ? 'MCQ subtotal' : 'Here’s your score'}</h1><div className="mx-auto mt-8 grid h-44 w-44 place-items-center rounded-full border-[12px] border-indigo-100 text-indigo-600"><div><strong className="text-5xl font-black">{displayedScore}</strong><span className="text-lg font-bold">/{displayedTotal}</span></div></div>{pending ? <p className="mt-7 rounded-xl bg-amber-50 p-4 text-amber-800">Your short answers are pending organisation review. <b>{result.pendingMarks || 0} marks</b> will be added after grading.</p> : <p className="mt-7 text-lg text-slate-600">You answered <b className="text-slate-900">{result.correctAnswers} of {result.questionCount}</b> MCQs correctly.</p>}<div className="mt-8 flex flex-wrap justify-center gap-3"><Link href="/submissions" className="rounded-xl border border-indigo-200 px-6 py-3 font-bold text-indigo-700">View submission</Link><Link href="/tests" className="rounded-xl bg-indigo-600 px-6 py-3 font-bold text-white">Back to test library</Link></div></div></section> }
