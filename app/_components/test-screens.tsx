'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { collection, deleteField, doc, getDoc, getDocs, onSnapshot, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import { useAuth } from './auth-context'
import { ExamResolver } from './exam-resolver'
import { MathText, MathTextEditor } from './math-components'
import { SearchPicker } from './search-picker'
import type { MockTest, Question, QuestionBankItem, QuestionContent, QuestionFormat, TestQuestion } from './test-types'
import type { ExamCatalogEntry } from '@/lib/exam-catalog'

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
const categoryId = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

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
  const [exams, setExams] = useState<Exam[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [addingExam, setAddingExam] = useState(false)
  const [newExamName, setNewExamName] = useState('')
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [questions, setQuestions] = useState<DraftQuestion[]>([])
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const allowed = profile?.role === 'admin' || profile?.role === 'organisation'
  const marks = useMemo(() => questions.reduce((total, item) => total + Number(item.marks || 0), 0), [questions])
  const examOptions = useMemo(() => [...exams].sort((a, b) => a.name.localeCompare(b.name)), [exams])
  const categoryOptions = useMemo(() => categories.filter((item) => item.examId === examId).sort((a, b) => a.name.localeCompare(b.name)), [categories, examId])
  const selectedExam = exams.find((item) => item.id === examId)
  const selectedCategory = categories.find((item) => item.id === categoryIdValue && item.examId === examId)

  useEffect(() => {
    if (!user) return
    const stopExams = onSnapshot(collection(db, 'examCatalog'), (snapshot) => setExams(snapshot.docs.map((item) => ({ id: item.id, name: item.data().name as string, primaryAlias: typeof item.data().primaryAlias === 'string' && item.data().primaryAlias.trim() ? item.data().primaryAlias.trim() : item.data().name as string, aliases: Array.isArray(item.data().aliases) ? item.data().aliases.filter((value: unknown): value is string => typeof value === 'string') : [] })).filter((item) => item.name)), (reason) => setMessage(reason.message))
    // Categories belong to the organisation that created them. The createdBy query
    // also keeps categories created before organisationId was added available.
    const stopCategories = onSnapshot(query(collection(db, 'categories'), where('createdBy', '==', user.uid)), (snapshot) => setCategories(snapshot.docs.map((item) => ({ id: item.id, name: item.data().name as string, examId: item.data().examId as string, organisationId: item.data().organisationId as string | undefined })).filter((item) => item.name && item.examId)), (reason) => setMessage(reason.message))
    return () => { stopExams();
stopCategories() }
  }, [user])

  useEffect(() => {
    void (async () => {
      await Promise.resolve()
      if (!testId) { setQuestions([blankDraft()]);
return }
      if (!initialTest) return
      if (initialTest.questions) {
        setQuestions(initialTest.questions.map((question) => ({ key: crypto.randomUUID(), content: question, marks: question.marks, revision: 1, isNew: true, format: questionFormat(question) })))
        return
      }

      try {
        const result = await getDocs(collection(db, 'tests', testId, 'questions'))
        const memberships = result.docs.map((item) => ({ id: item.id, ...item.data() }) as TestQuestion).sort((a, b) => a.position - b.position)
        const drafts = await Promise.all(memberships.map(async (membership) => {
          const source = await getDoc(doc(db, 'questions', membership.questionId))
          const data = source.exists() ? source.data() as QuestionBankItem : null
          return {
            key: membership.id,
            questionId: data ? membership.questionId : undefined,
            content: data ?? membership.snapshot ?? blankContent(),
            marks: membership.marks,
            revision: data?.revision ?? membership.snapshot?.revision ?? 1,
            isNew: !data,
            format: questionFormat(data ?? membership.snapshot ?? blankContent()),
          }
        }))
        setQuestions(drafts)
      } catch (reason) {
        setMessage(reason instanceof Error ? reason.message : 'Unable to load questions.')
      }
    })()
  }, [initialTest, testId])

  function updateQuestion(index: number, update: Partial<DraftQuestion>) { setQuestions((current) => current.map((item, i) => i === index ? { ...item, ...update } : item)) }

  async function uploadQuestionImage(file: File, questionKey: string, slot: string) {
    if (!user) throw new Error('Sign in before uploading an image.')
    if (!file.type.startsWith('image/')) throw new Error('Please select an image file.')
    if (file.size > 5 * 1024 * 1024) throw new Error('Images must be 5 MB or smaller.')
    const extension = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'image'
    const imageRef = ref(storage, `question-images/${user.uid}/${questionKey}/${slot}-${crypto.randomUUID()}.${extension}`)
    await uploadBytes(imageRef, file, { contentType: file.type })
    return getDownloadURL(imageRef)
  }

  async function addCategory() {
    const name = newCategory.trim()
    const id = categoryId(name)
    if (!name || !id || !user || !examId) { setMessage('Select an exam, then enter a valid category name.');
return }
    try {
      const ownedCategory = categories.find((item) => item.examId === examId && item.name.toLowerCase() === name.toLowerCase())
      if (ownedCategory) {
        setCategoryIdValue(ownedCategory.id)
        setNewCategory('')
        setAddingCategory(false)
        return
      }
      const categoryRef = doc(db, 'categories', `${user.uid}_${examId}_${id}`)
      await setDoc(categoryRef, { name, examId, createdBy: user.uid, ...(profile?.role === 'organisation' ? { organisationId: user.uid } : {}), createdAt: serverTimestamp() })
      setCategoryIdValue(categoryRef.id)
      setNewCategory('')
      setAddingCategory(false)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to add category.')
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || !allowed) return
    const cleaned = questions.map((item) => ({ ...item, content: cleanContent(item.content, item.format), marks: Number(item.marks) }))
    if (!title.trim() || !selectedExam || !selectedCategory || cleaned.length === 0 || cleaned.some((item) => !validContent(item.content) || item.marks < 1)) {
      setMessage('Add a title, exam, category, every question and option, and at least one mark per question.')
      return
    }
    setSaving(true)
    setMessage('')
    try {
      const testRef = testId ? doc(db, 'tests', testId) : doc(collection(db, 'tests'))
      const batch = writeBatch(db)
      const testData = {
        title: title.trim(), exam: selectedExam.name, examAlias: selectedExam.primaryAlias, examId: selectedExam.id, category: selectedCategory.name, categoryId: selectedCategory.id, published: true, publishedAt: initialTest?.publishedAt || serverTimestamp(), description: description.trim(), durationMinutes: Number(duration) || 0,
        questionCount: cleaned.length, totalMarks: marks, visibility,
        ...(visibility !== 'public' ? { organisationId: initialTest?.organisationId || user.uid } : testId ? { organisationId: deleteField() } : {}),
        ...(testId ? { attemptLimit: deleteField() } : {}),
        ...(initialTest?.questions ? { questions: deleteField() } : {}),
        ...(testId ? {} : { createdBy: user.uid, deletedAt: null, createdAt: serverTimestamp(), schemaVersion: 2 }),
      }
      batch.set(testRef, testData, { merge: !!testId })

      const existing = testId ? await getDocs(collection(testRef, 'questions')) : null
      const retained = new Set(cleaned.filter((draft) => !draft.isNew).map((draft) => draft.key))
      existing?.docs.filter((item) => !retained.has(item.id)).forEach((item) => batch.delete(item.ref))

      for (const [position, draft] of cleaned.entries()) {
        const questionRef = draft.questionId ? doc(db, 'questions', draft.questionId) : doc(collection(db, 'questions'))
        if (draft.questionId) {
          batch.update(questionRef, { ...draft.content, revision: draft.revision + 1, updatedAt: serverTimestamp() })
        } else {
          const questionVisibility = visibility === 'public' ? 'public' : 'private'
          batch.set(questionRef, { ...draft.content, createdBy: user.uid, visibility: questionVisibility, ...(questionVisibility === 'private' ? { organisationId: user.uid } : {}), revision: 1, archivedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
        }
        const membershipRef = draft.isNew ? doc(collection(testRef, 'questions')) : doc(testRef, 'questions', draft.key)
        batch.set(membershipRef, { questionId: questionRef.id, position, marks: draft.marks, mode: 'linked' })
      }

      await batch.commit()
      router.push(testId ? `/tests/${testId}` : '/tests')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to save this test.')
    } finally {
      setSaving(false)
    }
  }

  if (!allowed) return null
  return (
    <form onSubmit={save} className="mt-8 space-y-6">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <label className="block text-sm font-bold">Test title<input value={title} onChange={(event) => setTitle(event.target.value)} required className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5" /></label>
        <div className="mt-4"><label className="block text-sm font-bold">Exam<span className="mt-2 block font-normal"><SearchPicker value={examId} options={examOptions.map((item) => ({ id: item.id, label: item.name, detail: [...new Set([item.primaryAlias, ...item.aliases])].filter(alias => alias && alias !== item.name).join(', ') || undefined }))} onChange={(option) => { setExamId(option.id); setCategoryIdValue(''); setAddingExam(false) }} onCreate={(query) => { setNewExamName(query); setAddingExam(true) }} createLabel="Add exam" placeholder="Search exams" /></span></label>{addingExam && <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-slate-900">Add a new exam</p><p className="mt-1 text-xs text-slate-500">Existing matches will be shown before you can create it.</p></div><button type="button" onClick={() => setAddingExam(false)} className="text-sm font-bold text-indigo-700">Cancel</button></div><ExamResolver key={newExamName} initialName={newExamName} autoFocus onResolved={(exam, status) => { setExamId(exam.id); setCategoryIdValue(''); setAddingExam(false); setMessage(status === 'created' ? `Created and selected ${exam.name}.` : `Selected ${exam.name}.`) }} /></div>}</div>
        <div className="mt-4"><label className="block text-sm font-bold">Category<span className="mt-2 block font-normal"><SearchPicker value={categoryIdValue} options={categoryOptions.map((item) => ({ id: item.id, label: item.name }))} onChange={(option) => setCategoryIdValue(option.id)} placeholder={examId ? 'Search categories' : 'Select an exam first'} disabled={!examId} /></span></label><button type="button" disabled={!examId} onClick={() => setAddingCategory((current) => !current)} className="mt-2 text-sm font-bold text-indigo-700 disabled:text-slate-400">{addingCategory ? 'Cancel new category' : '+ Add category'}</button>{addingCategory && <div className="mt-3 flex flex-wrap gap-2"><input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="New category name" className="min-w-52 flex-1 rounded-lg border border-slate-200 px-3 py-2" /><button type="button" onClick={addCategory} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Add category</button></div>}</div>
        <label className="mt-4 block text-sm font-bold">Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2.5" /></label>
        <label className="mt-4 block max-w-48 text-sm font-bold">Duration (minutes)<input value={duration} onChange={(event) => setDuration(Number(event.target.value))} type="number" min="0" className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5" /></label>
        {profile?.role === 'organisation' && <fieldset className="mt-5"><legend className="text-sm font-bold">Access mode</legend><div className="mt-3 grid gap-3 sm:grid-cols-3"><AccessModeOption title="Public" description="Visible to everyone with unlimited attempts and standard timed mode." checked={visibility === 'public'} select={() => setVisibility('public')} /><AccessModeOption title="Private" description="Visible only to joined institute users, with unlimited attempts." checked={visibility === 'private'} select={() => setVisibility('private')} /><AccessModeOption title="Assigned" description="Hidden from the test library and available only through a live assignment." checked={visibility === 'assigned'} select={() => setVisibility('assigned')} /></div></fieldset>}
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
const router = useRouter();
const [test, setTest] = useState<MockTest | null>(null);
const [message, setMessage] = useState('');
const [deleting, setDeleting] = useState(false);
useEffect(() => { getDoc(doc(db, 'tests', id)).then((result) => setTest(result.exists() ? ({ id: result.id, ...result.data() } as MockTest) : null)).catch((reason) => setMessage(reason.message)) }, [id]);
const canManage = !!test && (profile?.role === 'admin' || (profile?.role === 'organisation' && test.createdBy === user?.uid));
async function softDelete() { if (!test || !user || !confirm('Soft-delete this test?')) return;
setDeleting(true);
try { await updateDoc(doc(db, 'tests', id), { deletedAt: serverTimestamp(), deletedBy: user.uid });
router.push('/tests') } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to delete this test.') } finally { setDeleting(false) } } if (!test) return <p className="text-slate-500">Loading test…</p>;
if (!canManage) return <section><h1 className="text-3xl font-black">Access denied</h1></section>;
return <section className="mx-auto max-w-3xl"><Link href={`/tests/${id}`} className="text-sm font-bold text-indigo-600">← Back to test</Link><div className="mt-5 flex justify-between gap-4"><h1 className="text-4xl font-black">Edit mock test</h1><button disabled={deleting} onClick={softDelete} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-bold text-rose-700">Soft delete</button></div>{message && <p className="mt-4 text-rose-700">{message}</p>}<TestEditor testId={id} initialTest={test} /></section> }

type AssignmentWindow = { id: string; assignmentBatchId: string; assignmentName?: string; linkedTaskId?: string; maxAttempts?: number; attemptsUsed?: number; startAt?: { toDate: () => Date }; endAt?: { toDate: () => Date }; deadline?: { toDate: () => Date } }
type TestSessionStatus = 'open' | 'not_started' | 'ended' | 'attempts_exhausted' | 'invalid'
type TestSessionPayload = {
  status?: TestSessionStatus
  error?: string
  test?: MockTest
  questions?: Question[]
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
const [questions, setQuestions] = useState<Question[]>([]);
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
function useAttemptCount(testId: string, userId?: string) { const [count, setCount] = useState(0);
const [privateCount, setPrivateCount] = useState(0);
const [ready, setReady] = useState(false);
useEffect(() => { if (!userId) return;
return onSnapshot(query(collection(db, 'submissions'), where('testId', '==', testId), where('userId', '==', userId)), snapshot => { setCount(snapshot.size);
setPrivateCount(snapshot.docs.filter(item => item.data().testVisibility === 'private').length);
setReady(true) }, () => setReady(true)) }, [testId, userId]);
return { count, privateCount, ready } }
export function TakeTest({ id, assignmentBatchId }: { id: string; assignmentBatchId?: string }) { const { user, profile, isImpersonating } = useAuth();
const { test, questions, assignment, status: windowStatus, loading, error } = useTestSession(id, assignmentBatchId, user || undefined);
const { count: previousAttempts, privateCount: previousPrivateAttempts, ready: attemptsReady } = useAttemptCount(id, user?.uid);
const router = useRouter();
const [answers, setAnswers] = useState<Record<number, number>>({});
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
const assignmentUserName = profile?.name || user.displayName || profile?.email || user.email || 'User';
const markAssignmentTaskStarted = async () => {
  if (!assignment?.linkedTaskId) return
  await runTransaction(db, async transaction => {
    const taskRef = doc(db, 'tasks', assignment.linkedTaskId!)
    const assigneeRef = doc(db, 'tasks', assignment.linkedTaskId!, 'assignees', user.uid)
    const taskSnapshot = await transaction.get(taskRef)
    const assigneeSnapshot = await transaction.get(assigneeRef)
    if (!taskSnapshot.exists()) return
    const taskData = taskSnapshot.data() as { assignedUserIds?: string[]; isClosed?: boolean; sourceType?: string; linkedAssignmentBatchId?: string }
    if (taskData.isClosed || taskData.sourceType !== 'assignment' || taskData.linkedAssignmentBatchId !== assignment.assignmentBatchId || !taskData.assignedUserIds?.includes(user.uid)) return
    const currentStatus = assigneeSnapshot.exists() ? assigneeSnapshot.data().status as string : 'todo'
    if (currentStatus === 'done' || currentStatus === 'closed' || currentStatus === 'in_progress') return
    transaction.set(assigneeRef, {
      userId: user.uid,
      userName: assignmentUserName,
      userEmail: profile?.email || user.email || '',
      status: 'in_progress',
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
      updatedByName: assignmentUserName,
    }, { merge: true })
    transaction.update(taskRef, {
      updatedAt: serverTimestamp(),
      lastStatusAt: serverTimestamp(),
      lastStatus: 'in_progress',
      lastStatusUserId: user.uid,
      lastStatusUserName: assignmentUserName,
      lastStatusUpdatedBy: user.uid,
      lastStatusUpdatedByName: assignmentUserName,
    })
  })
};
const submit = async (automatic?: { reason: 'time_expired' | 'fullscreen_exited' }) => { if (!user || submittingRef.current) return;
submittingRef.current = true;
if (automatic) pendingAutoSubmitReason.current = automatic.reason;
const autoSubmitReason = automatic?.reason || pendingAutoSubmitReason.current;
setSubmitting(true);
setSubmitError('');
try { const submittedAt = new Date();
if (assignmentStart && submittedAt < assignmentStart) throw new Error(`This assignment opens on ${assignmentStart.toLocaleString()}.`);
const withinAutomaticSubmissionGrace = Boolean(autoSubmitReason) && assignmentEnd && submittedAt.getTime() <= assignmentEnd.getTime() + 60_000;
if (assignmentEnd && submittedAt > assignmentEnd && !withinAutomaticSubmissionGrace) throw new Error('The assignment ended before your submission could be saved.');
const score = questions.reduce((sum, item, index) => sum + (answers[index] === item.correctAnswer ? item.marks : 0), 0);
const correct = questions.filter((item, index) => answers[index] === item.correctAnswer).length;
const answerDetails = questions.map((item, questionIndex) => ({ questionIndex, prompt: item.prompt, options: item.options, selectedAnswer: answers[questionIndex] ?? null, correctAnswer: item.correctAnswer, isCorrect: answers[questionIndex] === item.correctAnswer, marks: item.marks }));
const invites = profile?.role === 'user' ? await getDocs(query(collection(db, 'organisationInvites'), where('userId', '==', user.uid), where('status', '==', 'accepted'))) : null;
const organisationIds = invites ? invites.docs.map((item) => item.data().organisationId as string) : [];
await runTransaction(db, async transaction => {
  let attemptNumber = test.visibility === 'private' ? previousPrivateAttempts + 1 : previousAttempts + 1
  let assignmentBatchId: string | undefined
  if (test.visibility === 'assigned') {
    if (!assignment?.assignmentBatchId) throw new Error('This assignment is missing its attempt-tracking information. Ask the institute to recreate it.')
    const assignmentRef = doc(db, 'testAssignments', assignment.id)
    const assignmentSnapshot = await transaction.get(assignmentRef)
    if (!assignmentSnapshot.exists()) throw new Error('This test is not assigned to you.')
    const assignmentData = assignmentSnapshot.data() as AssignmentWindow
    const start = assignmentData.startAt?.toDate()
    const end = assignmentData.endAt?.toDate() || assignmentData.deadline?.toDate()
    const maxAttempts = assignmentData.maxAttempts || 1
    const attemptsUsed = assignmentData.attemptsUsed || 0
    if (start && submittedAt < start) throw new Error(`This assignment opens on ${start.toLocaleString()}.`)
    if (end && submittedAt.getTime() > end.getTime() + (autoSubmitReason ? 60_000 : 0)) throw new Error('The assignment ended before your submission could be saved.')
    if (attemptsUsed >= maxAttempts) throw new Error(`You have used all ${maxAttempts} attempts allowed for this assignment.`)
    if (!assignmentData.assignmentBatchId) throw new Error('This assignment is missing its attempt-tracking information. Ask the institute to recreate it.')
    attemptNumber = attemptsUsed + 1
    assignmentBatchId = assignmentData.assignmentBatchId
    if (assignmentData.linkedTaskId && (!end || submittedAt <= end)) {
      const taskRef = doc(db, 'tasks', assignmentData.linkedTaskId)
      const taskSnapshot = await transaction.get(taskRef)
      if (taskSnapshot.exists()) {
        const taskData = taskSnapshot.data() as { assignedUserIds?: string[]; isClosed?: boolean; sourceType?: string; linkedAssignmentBatchId?: string }
        if (!taskData.isClosed && taskData.sourceType === 'assignment' && taskData.linkedAssignmentBatchId === assignmentBatchId && taskData.assignedUserIds?.includes(user.uid)) {
          transaction.set(doc(db, 'tasks', assignmentData.linkedTaskId, 'assignees', user.uid), {
            userId: user.uid,
            userName: assignmentUserName,
            userEmail: profile?.email || user.email || '',
            status: 'done',
            updatedAt: serverTimestamp(),
            updatedBy: user.uid,
            updatedByName: assignmentUserName,
          }, { merge: true })
          transaction.update(taskRef, {
            updatedAt: serverTimestamp(),
            lastStatusAt: serverTimestamp(),
            lastStatus: 'done',
            lastStatusUserId: user.uid,
            lastStatusUserName: assignmentUserName,
            lastStatusUpdatedBy: user.uid,
            lastStatusUpdatedByName: assignmentUserName,
          })
        }
      }
    }
    transaction.update(assignmentRef, { attemptsUsed: attemptNumber })
  }
  const submissionRef = test.visibility === 'public'
    ? doc(collection(db, 'submissions'))
    : test.visibility === 'private'
      ? doc(collection(db, 'submissions'))
      : doc(db, 'submissions', `${test.id}_${user.uid}_${assignmentBatchId}_${attemptNumber}`)
  const submission = { userId: user.uid, userName: profile?.name || user.displayName || '', userEmail: user.email || profile?.email || '', testId: test.id, testTitle: test.title, ...(test.exam ? { testExam: test.exam } : {}), ...(test.examId ? { testExamId: test.examId } : {}), testCategory: test.category || 'Uncategorised', testVisibility: test.visibility, score, totalMarks: questions.reduce((sum, item) => sum + item.marks, 0), correctAnswers: correct, questionCount: questions.length, answers: answerDetails, organisationIds, attemptNumber, ...(assignmentBatchId ? { assignmentBatchId } : {}), autoSubmitted: Boolean(autoSubmitReason), ...(autoSubmitReason ? { autoSubmitReason } : {}), submittedAt: serverTimestamp() };
  transaction.set(submissionRef, submission)
  organisationIds.forEach((organisationId) => transaction.set(doc(db, 'organisationSubmissions', `${submissionRef.id}_${organisationId}`), { ...submission, organisationId }))
})
try { window.localStorage.removeItem(testTimerKey(test.id, user.uid, assignment?.assignmentBatchId)) } catch { /* Submission is already saved. */ }
allowedFullscreenExit.current = true;
if (document.fullscreenElement) { try { await document.exitFullscreen() } catch { /* Navigation can still complete. */ } }
router.push(`/tests/${id}/result?score=${score}&correct=${correct}&total=${questions.reduce((sum, item) => sum + item.marks, 0)}&questions=${questions.length}`) } catch (reason) { setSubmitError(reason instanceof Error ? reason.message : 'Unable to save your submission. Please try again.') } finally { submittingRef.current = false; setSubmitting(false) } };
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
const attemptedCount = Object.keys(answers).length;
const progress = questions.length ? attemptedCount / questions.length * 100 : 0;
return <section className="mx-auto max-w-6xl">{requiresSecureMode && <SecureExamGuard allowedExit={allowedFullscreenExit} onViolation={() => { setSecurityViolation(true); void submit({ reason: 'fullscreen_exited' }) }} />}<div className="rounded-2xl bg-slate-900 p-7 text-white"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-bold tracking-widest text-indigo-300">{requiresSecureMode ? 'SECURE MOCK TEST' : 'PUBLIC MOCK TEST'}</p><h1 className="mt-2 text-3xl font-black">{test.title}</h1><p className="mt-3 text-slate-300">{questions.length} questions · {test.durationMinutes || 'No'} minute limit</p></div>{requiresSecureMode ? <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" />Fullscreen active</span> : <span className="inline-flex items-center gap-2 rounded-full bg-sky-500/15 px-3 py-1.5 text-xs font-bold text-sky-300">Standard timed mode</span>}</div></div><div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start"><main className="space-y-5">{questions.map((question, questionIndex) => <article id={`question-${questionIndex + 1}`} key={questionIndex} className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6"><p className="text-sm font-bold text-indigo-600">QUESTION {questionIndex + 1} · {question.marks} MARK{question.marks === 1 ? '' : 'S'}</p><h2 className="mt-2 text-lg font-bold"><MathText>{question.prompt}</MathText></h2>{question.promptImageUrl && <Image src={question.promptImageUrl} alt={`Question ${questionIndex + 1}`} width={960} height={540} unoptimized className="mt-4 max-h-96 rounded-xl border border-slate-200 object-contain" />}<div className="mt-5 grid gap-3">{question.options.map((option, optionIndex) => <label key={optionIndex} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 ${answers[questionIndex] === optionIndex ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}`}><input type="radio" name={`answer-${questionIndex}`} checked={answers[questionIndex] === optionIndex} onChange={() => setAnswers((current) => ({ ...current, [questionIndex]: optionIndex }))} /><span className="min-w-0"><MathText>{option}</MathText>{question.optionImageUrls?.[optionIndex] && <Image src={question.optionImageUrls[optionIndex]} alt={`Option ${String.fromCharCode(65 + optionIndex)}`} width={640} height={360} unoptimized className="mt-3 max-h-56 rounded-lg border border-slate-200 object-contain" />}</span></label>)}</div></article>)}{submitError && <p className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{submitError}</p>}<button disabled={submitting} onClick={() => void submit()} className="w-full rounded-xl bg-indigo-600 py-4 font-bold text-white disabled:opacity-50">{submitting ? 'Saving submission…' : 'Submit test'}</button></main><aside className="order-first lg:order-none lg:sticky lg:top-6"><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><TestTimer durationMinutes={test.durationMinutes} assignmentEndAt={assignmentEnd?.getTime()} storageKey={testTimerKey(test.id, user.uid, assignment?.assignmentBatchId)} onExpire={() => void submit({ reason: 'time_expired' })} /><div className="mt-5 border-t border-slate-200 pt-5"><div className="flex items-center justify-between gap-3"><h2 className="font-black text-slate-900">Progress</h2><span className="text-sm font-bold text-indigo-700">{attemptedCount}/{questions.length}</span></div><div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-600 transition-[width] duration-300" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-xs text-slate-500">{Math.round(progress)}% attempted</p></div><div className="mt-5 border-t border-slate-200 pt-5"><h2 className="font-black text-slate-900">Questions</h2><div className="mt-3 grid grid-cols-5 gap-2">{questions.map((_, index) => { const attempted = answers[index] !== undefined; return <button key={index} type="button" onClick={() => document.getElementById(`question-${index + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} aria-label={`Go to question ${index + 1}, ${attempted ? 'attempted' : 'pending'}`} className={`grid h-10 place-items-center rounded-lg border text-sm font-black transition-colors ${attempted ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>{index + 1}</button> })}</div><div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold text-slate-600"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Attempted</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-300" />Pending</span></div></div></div></aside></div></section> }

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
export function TestResult({ score, correct, total, questionCount }: {
score: number;
correct: number;
total: number;
questionCount: number }) {
return <section className="mx-auto max-w-2xl text-center"><div className="rounded-3xl bg-white p-10 shadow-sm"><p className="text-sm font-bold tracking-widest text-indigo-600">TEST COMPLETE</p><h1 className="mt-3 text-3xl font-black">Here&apos;s your score</h1><div className="mx-auto mt-8 grid h-44 w-44 place-items-center rounded-full border-[12px] border-indigo-100 text-indigo-600"><div><strong className="text-5xl font-black">{score}</strong><span className="text-lg font-bold">/{total}</span></div></div><p className="mt-7 text-lg text-slate-600">You answered <b className="text-slate-900">{correct} of {questionCount}</b> questions correctly.</p><Link href="/tests" className="mt-8 inline-block rounded-xl bg-indigo-600 px-6 py-3 font-bold text-white">Back to test library</Link></div></section> }

