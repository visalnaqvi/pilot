'use client'

import { ChangeEvent, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ACCEPTED_SOURCE_EXTENSIONS,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_FILES,
  MAX_SOURCE_TOTAL_BYTES,
  GenerationConfigSchema,
  type GeneratedQuestion,
  type GenerationStatus,
  type SourceAnalysis,
  type SourceUpload,
} from '@/lib/test-generation/schema'
import { authenticatedFetch } from '@/lib/authenticated-fetch'
import { uploadAuthorizedFile } from '@/lib/file-upload'
import type { ExamCatalogEntry, ExamSelectionStatus } from '@/lib/exam-catalog'
import { useAuth } from './auth-context'
import { ExamResolver } from './exam-resolver'
import { MathText, MathTextEditor } from './math-components'
import { SearchPicker } from './search-picker'

type JobListItem = {
  id: string
  ownerId: string
  status: GenerationStatus
  subject: string
  titleSuggestion: string
  publishedTestId?: string | null
}

type JobDetail = {
  id: string
  ownerId: string
  status: GenerationStatus
  analysis?: SourceAnalysis
  sources?: SourceUpload[]
  titleSuggestion?: string
  descriptionSuggestion?: string
  error?: string
  publishedTestId?: string
}

type Candidate = GeneratedQuestion & {
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'needs_changes'
  verificationStatus: 'pending' | 'supported' | 'answer_inferred' | 'unsupported' | 'edited'
  verificationConfidence?: number
  verificationIssues?: string[]
  suggestedFix?: string
  unsupportedOverrideApproved?: boolean
  position: number
}

type Exam = ExamCatalogEntry
type Category = { id: string; name: string; examId: string; createdBy: string }

const activeStatuses: GenerationStatus[] = [
  'analyzing', 'generating', 'verification_starting', 'verifying', 'publishing',
]
const accepted = ACCEPTED_SOURCE_EXTENSIONS.map(value => `.${value}`).join(',')

async function responseJson(response: Response) {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `Request failed with status ${response.status}.`)
  }
  return body as Record<string, unknown>
}

export function AiTestGenerator() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const [jobs, setJobs] = useState<JobListItem[]>([])
  const [job, setJob] = useState<JobDetail | null>(null)
  const [questions, setQuestions] = useState<Candidate[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [exams, setExams] = useState<Exam[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [examId, setExamId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [addingExam, setAddingExam] = useState(false)
  const [newExamName, setNewExamName] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [duration, setDuration] = useState(30)
  const [visibility, setVisibility] = useState<'public' | 'private' | 'assigned'>('private')
  const [previewing, setPreviewing] = useState(false)
  const [config, setConfig] = useState({
    sourceKind: 'notes' as SourceAnalysis['sourceKind'],
    subject: '',
    language: '',
    selectedTopics: [] as string[],
    difficulty: 'mixed' as 'easy' | 'medium' | 'hard' | 'mixed',
    mcqCount: 20,
    shortAnswerCount: 0,
    mcqMarks: 1,
    shortAnswerMarks: 1,
  })
  const canCreate = profile?.role === 'organisation'
  const canReview = canCreate || profile?.role === 'admin'

  const api = useCallback(async (url: string, init?: RequestInit) => {
    if (!user) throw new Error('Sign in to continue.')
    return responseJson(await fetch(url, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
        authorization: `Bearer ${await user.getIdToken()}`,
      },
    }))
  }, [user])

  const loadJobs = useCallback(async () => {
    if (!user || !canReview) return
    try {
      const body = await api('/api/test-generation/jobs')
      setJobs((body.jobs as JobListItem[]) || [])
      setEnabled(body.enabled !== false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load drafts.')
    }
  }, [api, canReview, user])

  const loadJob = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setBusy('loading')
    try {
      const body = await api(`/api/test-generation/jobs/${id}`)
      const loaded = body.job as JobDetail
      const sourceReferences = (loaded.sources || []).map(source => ({
        sourceId: source.id,
        filename: source.name,
        locator: 'Uploaded file',
        excerpt: 'Source material used for this generated draft.',
      }))
      const rawAnalysis = loaded.analysis as Partial<SourceAnalysis> | undefined
      const analysis: SourceAnalysis = {
        sourceKind: rawAnalysis?.sourceKind || 'notes',
        language: rawAnalysis?.language || 'English',
        subject: rawAnalysis?.subject || 'Study material',
        summary: rawAnalysis?.summary || 'The uploaded material is ready for question generation.',
        topics: rawAnalysis?.topics?.length ? rawAnalysis.topics : [{
          name: rawAnalysis?.subject || 'All uploaded material',
          importance: 'high',
          rationale: 'Generate questions across the uploaded study material.',
          sourceReferences: sourceReferences.length ? sourceReferences : [{
            sourceId: 'uploaded-material',
            filename: 'Uploaded material',
            locator: 'Full source',
            excerpt: 'The uploaded source material.',
          }],
        }],
        warnings: rawAnalysis?.warnings || [],
      }
      const normalizedJob = { ...loaded, analysis }
      setJob(normalizedJob)
      const normalizedQuestions = ((body.questions as Array<{
        id: string
        position: number
        content: Record<string, unknown>
        reviewStatus: string
        verificationStatus: string
        verification?: { issues?: string[]; confidence?: number; suggestedFix?: string }
      }>) || []).map(row => ({
        id: row.id,
        kind: row.content.kind === 'short_answer' ? 'short_answer' as const : 'mcq' as const,
        prompt: String(row.content.prompt || ''),
        topic: String(row.content.topic || analysis.subject),
        difficulty: ['easy', 'medium', 'hard'].includes(String(row.content.difficulty)) ? row.content.difficulty as 'easy' | 'medium' | 'hard' : 'medium',
        marks: Number(row.content.marks || 1),
        answerOrigin: row.content.answerOrigin === 'model_inferred' ? 'model_inferred' as const : 'source_supported' as const,
        sourceReferences: Array.isArray(row.content.sourceReferences) ? row.content.sourceReferences : sourceReferences,
        ...(row.content.kind === 'short_answer' ? {
          modelAnswer: String(row.content.modelAnswer || ''),
          rubric: Array.isArray(row.content.rubric) ? row.content.rubric : [{ criterion: 'Correct answer', marks: Number(row.content.marks || 1) }],
        } : {
          options: Array.isArray(row.content.options) ? row.content.options.map(String) : ['', '', '', ''],
          correctAnswer: Number(row.content.correctAnswer || 0),
          explanation: String(row.content.explanation || ''),
        }),
        reviewStatus: row.reviewStatus === 'accepted' ? 'approved' as const : row.reviewStatus === 'rejected' ? 'rejected' as const : 'pending' as const,
        verificationStatus: row.verificationStatus === 'verified' ? 'supported' as const : 'pending' as const,
        verificationConfidence: row.verification?.confidence,
        verificationIssues: row.verification?.issues || [],
        suggestedFix: row.verification?.suggestedFix,
        position: row.position,
      })) as Candidate[]
      setQuestions(normalizedQuestions.sort((a, b) => a.position - b.position))
      if (analysis) {
        setConfig(current => ({
          ...current,
          sourceKind: analysis.sourceKind,
          subject: analysis.subject,
          language: analysis.language,
          selectedTopics: analysis.topics.map(topic => topic.name),
        }))
      }
      if (loaded.titleSuggestion) setTitle(current => current || loaded.titleSuggestion || '')
      if (loaded.descriptionSuggestion) setDescription(current => current || loaded.descriptionSuggestion || '')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load this draft.')
    } finally {
      if (!quiet) setBusy('')
    }
  }, [api])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadJobs(), 0)
    return () => window.clearTimeout(timer)
  }, [loadJobs])

  useEffect(() => {
    if (!user || !canReview) return
    const controller = new AbortController()
    void Promise.all([
      authenticatedFetch(user, '/api/exams?scope=catalog', { cache: 'no-store', signal: controller.signal }),
      authenticatedFetch(user, profile?.organizationId ? `/api/categories?organizationId=${encodeURIComponent(profile.organizationId)}` : '/api/categories', { cache: 'no-store', signal: controller.signal }),
    ]).then(async ([examResponse, categoryResponse]) => {
      const examBody = await examResponse.json()
      const categoryBody = await categoryResponse.json()
      if (!examResponse.ok) throw new Error(examBody.error || 'Unable to load exams.')
      if (!categoryResponse.ok) throw new Error(categoryBody.error || 'Unable to load categories.')
      setExams(examBody.items || [])
      setCategories(categoryBody.items || [])
    }).catch(error => {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Unable to load test options.')
    })
    return () => controller.abort()
  }, [canReview, profile?.organizationId, user])

  const activeJobId = job?.id
  const activeJobStatus = job?.status
  const generationRequestPending = busy === 'generating' || busy === 'retrying'

  useEffect(() => {
    if (!activeJobId || ((!activeJobStatus || !activeStatuses.includes(activeJobStatus)) && !generationRequestPending)) return
    const refresh = async () => {
      try {
        await loadJob(activeJobId, true)
        await loadJobs()
      } catch { /* The next poll can retry. */ }
    }
    const timer = window.setInterval(() => void refresh(), 4000)
    void refresh()
    return () => window.clearInterval(timer)
  }, [activeJobId, activeJobStatus, generationRequestPending, loadJob, loadJobs])

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = [...(event.target.files || [])]
    event.currentTarget.value = ''
    if (!selected.length) return
    if (selected.length > MAX_SOURCE_FILES) return setMessage(`Choose no more than ${MAX_SOURCE_FILES} files.`)
    if (selected.some(file => file.size > MAX_SOURCE_FILE_BYTES)) return setMessage('Each file must be 20 MB or smaller.')
    if (selected.reduce((sum, file) => sum + file.size, 0) > MAX_SOURCE_TOTAL_BYTES) return setMessage('The selected files exceed the 50 MB combined limit.')
    setFiles(selected)
    setMessage('')
  }

  async function uploadAndAnalyse() {
    if (!user || !files.length) return
    setBusy('uploading')
    setMessage('')
    try {
      const created = await api('/api/test-generation/jobs', { method: 'POST' })
      const jobId = String(created.jobId)
      const fileIds: string[] = []
      for (const file of files) {
        const uploaded = await uploadAuthorizedFile(user, file, profile?.organizationId || null)
        fileIds.push(uploaded.fileId)
      }
      await api(`/api/test-generation/jobs/${jobId}/finalize`, {
        method: 'POST',
        body: JSON.stringify({ fileIds }),
      })
      setFiles([])
      await loadJob(jobId)
      await loadJobs()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to upload these files.')
    } finally {
      setBusy('')
    }
  }

  async function retryFailedStage() {
    if (!job) return
    setBusy('retrying')
    setMessage('')
    try {
      await api(`/api/test-generation/jobs/${job.id}/generate`, {
        method: 'POST',
        body: JSON.stringify({ config: GenerationConfigSchema.parse(config) }),
      })
      await loadJob(job.id)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to retry this stage.')
      await loadJob(job.id, true)
    } finally {
      setBusy('')
    }
  }

  async function generate() {
    if (!job) return
    setBusy('generating')
    setMessage('')
    try {
      await api(`/api/test-generation/jobs/${job.id}/generate`, {
        method: 'POST',
        body: JSON.stringify({ config: GenerationConfigSchema.parse(config) }),
      })
      await loadJob(job.id)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to generate questions.')
      await loadJob(job.id, true)
    } finally {
      setBusy('')
    }
  }

  async function saveQuestion(index: number, status: Candidate['reviewStatus']) {
    if (!job) return
    const current = questions[index]
    if (status === 'approved' && current.kind !== 'mcq') {
      setMessage('Short-answer questions are temporarily disabled. Reject this question or generate a new MCQ-only draft.')
      return
    }
    if (status === 'approved' && current.verificationStatus === 'unsupported'
      && !window.confirm('The verifier marked this question as unsupported. Approving it will explicitly override that blocker. Publish it anyway?')) return
    setBusy(current.id)
    setMessage('')
    try {
      await api(`/api/test-generation/jobs/${job.id}/questions/${current.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          content: {
            kind: current.kind,
            prompt: current.prompt,
            marks: current.marks,
            ...(current.kind === 'mcq' ? {
              options: current.options,
              correctAnswer: current.correctAnswer,
              explanation: current.explanation,
            } : {
              modelAnswer: current.modelAnswer,
              rubric: current.rubric,
            }),
          },
          reviewStatus: status === 'approved' ? 'accepted' : status === 'rejected' ? 'rejected' : 'pending',
        }),
      })
      setQuestions(items => items.map((item, itemIndex) => itemIndex === index ? {
        ...item,
        reviewStatus: status,
        ...(status === 'approved' && item.verificationStatus === 'unsupported' ? { unsupportedOverrideApproved: true } : {}),
      } : item))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save this question.')
    } finally {
      setBusy('')
    }
  }

  async function moveQuestion(index: number, direction: -1 | 1) {
    if (!job) return
    const target = index + direction
    if (target < 0 || target >= questions.length) return
    const reordered = [...questions]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    setQuestions(reordered.map((question, position) => ({ ...question, position })))
    try {
      await api(`/api/test-generation/jobs/${job.id}/questions/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ questionIds: reordered.map(question => question.id) }),
      })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to reorder questions.')
      await loadJob(job.id, true)
    }
  }

  async function publish() {
    if (!job) return
    setBusy('publishing')
    setMessage('')
    try {
      const body = await api(`/api/test-generation/jobs/${job.id}/publish`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          examId,
          categoryName: categories.find(item => item.id === categoryId)?.name || '',
          durationMinutes: Number(duration),
          visibility,
        }),
      })
      router.push(`/tests/${String(body.testId)}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to publish this test.')
    } finally {
      setBusy('')
    }
  }

  async function createCategory(categoryName: string) {
    const name = categoryName.trim()
    if (!user || !job || !examId || !name) {
      setMessage('Select an exam, then enter a valid category name.')
      return
    }
    const existing = categoryOptions.find(item => item.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      setCategoryId(existing.id)
      return
    }
    setBusy('category')
    setMessage('')
    try {
      const body = await api('/api/categories', {
        method: 'POST',
        body: JSON.stringify({ name, examId, organizationId: profile?.organizationId || null }),
      })
      const category = body.item as Category
      setCategories(current => current.some(item => item.id === category.id) ? current : [...current, category])
      setCategoryId(category.id)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create this category.')
    } finally {
      setBusy('')
    }
  }

  function applyResolvedExam(exam: ExamCatalogEntry, status: ExamSelectionStatus) {
    setExams(current => current.some(item => item.id === exam.id) ? current : [...current, exam])
    setExamId(exam.id)
    setCategoryId('')
    setAddingExam(false)
    setMessage(status === 'created' ? `Created and selected ${exam.name}.` : `Selected ${exam.name}.`)
  }

  async function selectCatalogExam(id: string) {
    const exam = exams.find(item => item.id === id)
    if (!exam) return
    setBusy('exam')
    setMessage('')
    try {
      const result = await api('/api/exams/resolve', {
        method: 'POST',
        body: JSON.stringify({ selectionId: exam.id }),
      })
      applyResolvedExam(result.exam as ExamCatalogEntry, 'selected')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to select this exam.')
    } finally {
      setBusy('')
    }
  }

  async function discard() {
    if (!job || !window.confirm('Discard this draft and permanently delete its uploaded source files?')) return
    setBusy('discarding')
    try {
      await api(`/api/test-generation/jobs/${job.id}`, { method: 'DELETE' })
      setJob(null)
      setQuestions([])
      await loadJobs()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to discard this draft.')
    } finally {
      setBusy('')
    }
  }

  const selectedExam = exams.find(item => item.id === examId)
  const categoryOptions = categories.filter(item => item.examId === examId)
  const mcqQuestions = questions.filter((item): item is Extract<Candidate, { kind: 'mcq' }> => item.kind === 'mcq')
  const shortAnswerCount = questions.length - mcqQuestions.length
  const approvedCount = mcqQuestions.filter(item => item.reviewStatus === 'approved').length
  const analysis = job?.analysis
  const displayedStatus: GenerationStatus | undefined = job
    && ((job.status === 'analysis_ready' && busy === 'generating')
      || (job.status === 'failed' && busy === 'retrying'))
    ? 'generating'
    : job?.status

  if (!canReview) return <section><h1 className="text-3xl font-black">Access denied</h1></section>

  return <section className="mx-auto max-w-6xl">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-sm font-black uppercase tracking-[.2em] text-indigo-600">AI test generator</p><h1 className="mt-2 text-4xl font-black">Turn study material into a mock test</h1><p className="mt-3 max-w-3xl text-slate-600">Upload notes or a question paper, choose the topics and test format, then review every answer before publishing.</p></div>
      {job && job.status !== 'published' && <button type="button" disabled={Boolean(busy)} onClick={() => void discard()} className="rounded-xl border border-rose-200 px-4 py-3 text-sm font-black text-rose-700 disabled:opacity-50">Discard draft</button>}
    </div>
    {message && <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">{message}</p>}

    {!job && <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <StageNumber number="1" title="Upload study material" />
        {!enabled && <p className="mt-5 rounded-xl bg-rose-50 p-4 text-rose-700">AI generation is currently disabled.</p>}
        {canCreate ? <>
          <label className="mt-6 grid min-h-48 cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 p-8 text-center hover:bg-indigo-50"><span><span className="block text-lg font-black text-indigo-700">Choose up to five files</span><span className="mt-2 block text-sm text-slate-500">PDF, Word export, text, PNG, JPEG, WebP, or GIF · 20 MB each · 50 MB total</span></span><input type="file" multiple accept={accepted} onChange={chooseFiles} className="sr-only" /></label>
          {files.length > 0 && <div className="mt-5 space-y-2">{files.map(file => <div key={`${file.name}-${file.size}`} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm"><span className="truncate font-semibold">{file.name}</span><span className="ml-4 shrink-0 text-slate-500">{(file.size / 1024 / 1024).toFixed(1)} MB</span></div>)}</div>}
          <button type="button" disabled={!enabled || !files.length || Boolean(busy)} onClick={() => void uploadAndAnalyse()} className="mt-6 w-full rounded-xl bg-indigo-600 py-4 font-black text-white disabled:opacity-50">{busy === 'uploading' ? 'Uploading and starting analysis…' : 'Upload and analyse'}</button>
          <p className="mt-4 text-xs text-slate-500">For OneNote pages containing diagrams or handwriting, export to PDF or use screenshots. Native .one files are not supported.</p>
        </> : <p className="mt-6 rounded-xl bg-slate-50 p-5 text-slate-600">Administrators can review organisation drafts but cannot upload material on behalf of an organisation.</p>}
      </div>
      <DraftList jobs={jobs} open={(id) => void loadJob(id)} />
    </div>}

    {job?.status === 'published' && <div className="mt-8 rounded-3xl border border-emerald-200 bg-white p-8 shadow-sm"><p className="text-sm font-black uppercase tracking-[.2em] text-emerald-700">Published test</p><h2 className="mt-2 text-3xl font-black">This is now a standard test</h2><p className="mt-3 max-w-2xl text-slate-600">Use the regular test editor to update its details, questions, answers, marks, and ordering.</p><div className="mt-6 flex flex-wrap gap-3">{job.publishedTestId && <Link href={`/tests/${job.publishedTestId}/edit`} className="rounded-xl bg-indigo-600 px-5 py-3 font-black text-white">Edit published test</Link>}<button type="button" onClick={() => setJob(null)} className="rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-700">Back to generator</button></div></div>}

    {job && job.status !== 'published' && <div className="mt-8 space-y-7">
      <Progress status={displayedStatus || job.status} />
      {displayedStatus && activeStatuses.includes(displayedStatus) && <ProcessingCard status={displayedStatus} />}
      {displayedStatus === 'failed' && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6"><h2 className="text-xl font-black text-rose-900">Generation stopped</h2><p className="mt-2 text-rose-700">{job.error || 'The model did not complete this stage.'}</p><button type="button" disabled={Boolean(busy)} onClick={() => void retryFailedStage()} className="mt-4 rounded-xl bg-rose-700 px-5 py-3 font-bold text-white disabled:opacity-50">{busy === 'retrying' ? 'Retrying…' : 'Retry failed stage'}</button></div>}

      {displayedStatus === 'analysis_ready' && analysis && <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <StageNumber number="2" title="Review analysis and configure the test" />
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <TextField label="Subject" value={config.subject} setValue={value => setConfig(current => ({ ...current, subject: value }))} />
          <TextField label="Output language" value={config.language} setValue={value => setConfig(current => ({ ...current, language: value }))} />
          <SelectField label="Detected source type" value={config.sourceKind} setValue={value => setConfig(current => ({ ...current, sourceKind: value as typeof current.sourceKind }))} options={[['notes', 'Notes'], ['question_paper', 'Question paper'], ['mixed', 'Mixed'], ['unknown', 'Unknown']]} />
          <SelectField label="Difficulty" value={config.difficulty} setValue={value => setConfig(current => ({ ...current, difficulty: value as typeof current.difficulty }))} options={[['mixed', 'Mixed'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']]} />
        </div>
        <p className="mt-6 text-sm font-black text-slate-900">Selected topics</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{analysis.topics.map(topic => {
          const checked = config.selectedTopics.includes(topic.name)
          return <label key={topic.name} className={`rounded-xl border p-4 ${checked ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'}`}><span className="flex items-start gap-3"><input type="checkbox" checked={checked} onChange={() => setConfig(current => ({ ...current, selectedTopics: checked ? current.selectedTopics.filter(value => value !== topic.name) : [...current.selectedTopics, topic.name] }))} /><span><span className="block font-bold">{topic.name}</span><span className="mt-1 block text-xs uppercase tracking-wide text-indigo-600">{topic.importance} importance</span><span className="mt-2 block text-sm text-slate-600">{topic.rationale}</span></span></span></label>
        })}</div>
        {analysis.warnings.length > 0 && <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="font-black text-amber-900">Source warnings</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">{analysis.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <NumberField label="MCQs" value={config.mcqCount} setValue={value => setConfig(current => ({ ...current, mcqCount: value }))} min={5} max={50} />
          <NumberField label="MCQ marks" value={config.mcqMarks} setValue={value => setConfig(current => ({ ...current, mcqMarks: value }))} min={1} max={100} />
        </div>
        <p className="mt-3 text-sm text-slate-500">This release generates MCQs only. Short-answer questions will be added in a future update.</p>
        <button type="button" disabled={Boolean(busy)} onClick={() => void generate()} className="mt-7 w-full rounded-xl bg-indigo-600 py-4 font-black text-white disabled:opacity-50">{busy === 'generating' ? 'Starting generation…' : 'Generate and verify questions'}</button>
      </div>}

      {job.status === 'review' && <>
        <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
          <StageNumber number="3" title="Review generated questions" />
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm"><Badge tone="green">{approvedCount} MCQs approved</Badge><Badge tone="slate">{mcqQuestions.length - approvedCount} MCQs remaining</Badge><Badge tone="amber">{mcqQuestions.filter(item => item.answerOrigin === 'model_inferred').length} AI-inferred answers</Badge>{shortAnswerCount > 0 && <Badge tone="red">{shortAnswerCount} short answers excluded</Badge>}<button type="button" disabled={!approvedCount} onClick={() => setPreviewing(current => !current)} className="ml-auto rounded-lg border border-indigo-200 px-3 py-2 font-bold text-indigo-700 disabled:opacity-50">{previewing ? 'Close learner preview' : 'Preview learner test'}</button></div>
          {previewing && <div className="mt-6 rounded-2xl border-2 border-indigo-200 bg-slate-50 p-5"><p className="text-xs font-black uppercase tracking-widest text-indigo-600">Learner preview</p><h3 className="mt-2 text-2xl font-black">{title || job.titleSuggestion || 'Generated mock test'}</h3><div className="mt-5 space-y-4">{mcqQuestions.filter(item => item.reviewStatus === 'approved').map((question, index) => <article key={question.id} className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-xs font-black text-indigo-600">QUESTION {index + 1} · {question.marks} MARK{question.marks === 1 ? '' : 'S'}</p><p className="mt-2 font-bold"><MathText>{question.prompt}</MathText></p><div className="mt-4 grid gap-2">{question.options.map((option, optionIndex) => <label key={optionIndex} className="flex gap-2 rounded-lg border border-slate-200 p-3"><input type="radio" disabled /><MathText>{option}</MathText></label>)}</div></article>)}</div></div>}
          <div className="mt-7 space-y-5">{questions.map((question, index) => <CandidateEditor key={question.id} question={question} index={index} busy={busy === question.id} canMoveUp={index > 0} canMoveDown={index < questions.length - 1} move={direction => void moveQuestion(index, direction)} update={update => setQuestions(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } as Candidate : item))} save={(status) => void saveQuestion(index, status)} openSource={async source => {
            const upload = job.sources?.find(item => item.id === source.sourceId)
            if (!upload) return
            const body = await api(`/api/files/${upload.id}/download`)
            if (typeof body.url === 'string') window.open(body.url, '_blank', 'noopener,noreferrer')
          }} />)}</div>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
          <StageNumber number="4" title="Test details and publication" />
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <TextField label="Test title" value={title} setValue={setTitle} />
            <NumberField label="Duration in minutes (0 for no limit)" value={duration} setValue={setDuration} min={0} max={1440} />
            <div>
              <label className="block text-sm font-bold">Exam<span className="mt-2 block font-normal"><SearchPicker value={examId} options={exams.map(item => ({ id: item.id, label: item.name, detail: [...new Set([item.primaryAlias, ...item.aliases])].filter(alias => alias && alias !== item.name).join(', ') || undefined }))} onChange={option => void selectCatalogExam(option.id)} onCreate={job.status === 'review' ? query => { setNewExamName(query); setAddingExam(true) } : undefined} createLabel="Create exam" placeholder="Search the exam catalog" disabled={busy === 'exam'} /></span></label>
              {addingExam && <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div><p className="text-sm font-bold text-slate-900">Create a new exam</p><p className="mt-1 text-xs text-slate-500">Catalog matches are checked before a new exam can be created.</p></div>
                  <button type="button" onClick={() => setAddingExam(false)} className="text-sm font-bold text-indigo-700">Cancel</button>
                </div>
                <ExamResolver key={newExamName} initialName={newExamName} autoFocus autoResolveInitialName onResolved={applyResolvedExam} />
              </div>}
            </div>
            <label className="block text-sm font-bold">Category<span className="mt-2 block font-normal"><SearchPicker value={categoryId} options={categoryOptions.map(item => ({ id: item.id, label: item.name }))} onChange={option => setCategoryId(option.id)} onCreate={job.status === 'review' ? query => void createCategory(query) : undefined} createLabel="Create category" placeholder={selectedExam ? 'Search or create a category' : 'Select an exam first'} disabled={!selectedExam || busy === 'category'} /></span></label>
            <SelectField label="Visibility" value={visibility} setValue={value => setVisibility(value as typeof visibility)} options={[['private', 'Organisation members'], ['assigned', 'Assigned students'], ['public', 'Public']]} />
          </div>
          <label className="mt-5 block text-sm font-bold">Description<textarea value={description} onChange={event => setDescription(event.target.value)} rows={4} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal" /></label>
          <button type="button" disabled={approvedCount === 0 || !title.trim() || !examId || !categoryId || Boolean(busy)} onClick={() => void publish()} className="mt-7 w-full rounded-xl bg-emerald-600 py-4 font-black text-white disabled:opacity-50">{busy === 'publishing' ? 'Publishing…' : `Publish ${approvedCount} approved question${approvedCount === 1 ? '' : 's'}`}</button>
        </div>
      </>}
    </div>}
  </section>
}

function DraftList({ jobs, open }: { jobs: JobListItem[]; open: (id: string) => void }) {
  return <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-black">Recent drafts</h2><div className="mt-4 space-y-2">{jobs.length ? jobs.map(job => job.status === 'published' && job.publishedTestId ? <Link key={job.id} href={`/tests/${job.publishedTestId}/edit`} className="block w-full rounded-xl border border-slate-200 p-3 text-left hover:border-indigo-300 hover:bg-indigo-50"><span className="block truncate font-bold">{job.titleSuggestion || job.subject || 'Untitled generation'}</span><span className="mt-1 block text-xs font-semibold uppercase tracking-wide text-emerald-700">Edit published test</span></Link> : <button key={job.id} type="button" onClick={() => open(job.id)} className="w-full rounded-xl border border-slate-200 p-3 text-left hover:border-indigo-300 hover:bg-indigo-50"><span className="block truncate font-bold">{job.titleSuggestion || job.subject || 'Untitled generation'}</span><span className="mt-1 block text-xs font-semibold uppercase tracking-wide text-indigo-600">{job.status.replaceAll('_', ' ')}</span></button>) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No AI-generated drafts yet.</p>}</div></aside>
}

function StageNumber({ number, title }: { number: string; title: string }) {
  return <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-indigo-600 font-black text-white">{number}</span><h2 className="text-2xl font-black">{title}</h2></div>
}

function Progress({ status }: { status: GenerationStatus }) {
  const stages = ['Upload', 'Analyse', 'Configure', 'Generate & verify', 'Review', 'Publish']
  const active = status === 'uploading' ? 0 : status === 'analyzing' ? 1 : status === 'analysis_ready' ? 2 : ['generating', 'verification_starting', 'verifying'].includes(status) ? 3 : status === 'review' ? 4 : status === 'published' ? 5 : 0
  return <ol className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-6">{stages.map((stage, index) => <li key={stage} className={`rounded-xl px-3 py-3 text-center text-xs font-black ${index <= active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{stage}</li>)}</ol>
}

function ProcessingCard({ status }: { status: GenerationStatus }) {
  const label = status === 'analyzing' ? 'Reading and analysing your material' : status === 'generating' ? 'Creating questions and answers' : status === 'publishing' ? 'Publishing your approved test' : 'Checking every generated question'
  return <div className="rounded-3xl border border-indigo-200 bg-indigo-50 p-8 text-center"><span className="mx-auto block h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" /><h2 className="mt-5 text-2xl font-black text-indigo-950">{label}</h2><p className="mt-2 text-sm text-indigo-700">This can take several minutes. You may leave this page and return to the draft later.</p></div>
}

function CandidateEditor({ question, index, busy, canMoveUp, canMoveDown, move, update, save, openSource }: { question: Candidate; index: number; busy: boolean; canMoveUp: boolean; canMoveDown: boolean; move: (direction: -1 | 1) => void; update: (update: Partial<Candidate>) => void; save: (status: Candidate['reviewStatus']) => void; openSource: (source: Candidate['sourceReferences'][number]) => void }) {
  const tone = question.reviewStatus === 'approved' ? 'border-emerald-300' : question.verificationStatus === 'unsupported' ? 'border-rose-300' : 'border-slate-200'
  return <article className={`rounded-2xl border-2 ${tone} p-5`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-indigo-600">Question {index + 1} · {question.kind === 'mcq' ? 'MCQ' : 'Short answer'} · {question.marks} marks</p><p className="mt-1 text-sm text-slate-500">{question.topic} · {question.difficulty}</p><div className="mt-2 flex gap-2"><button type="button" disabled={!canMoveUp} onClick={() => move(-1)} className="text-xs font-bold text-indigo-700 disabled:text-slate-300">Move up</button><button type="button" disabled={!canMoveDown} onClick={() => move(1)} className="text-xs font-bold text-indigo-700 disabled:text-slate-300">Move down</button></div></div><div className="flex flex-wrap gap-2"><Badge tone={question.answerOrigin === 'model_inferred' ? 'amber' : 'green'}>{question.answerOrigin === 'model_inferred' ? 'AI-inferred answer' : 'Source supported'}</Badge><Badge tone={question.verificationStatus === 'unsupported' ? 'red' : question.verificationStatus === 'answer_inferred' ? 'amber' : 'green'}>{question.verificationStatus.replaceAll('_', ' ')}</Badge>{question.unsupportedOverrideApproved && <Badge tone="amber">Override approved</Badge>}</div></div>
    <MathTextEditor multiline value={question.prompt} onChange={prompt => update({ prompt })} inputClassName="mt-4 min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2.5" />
    {question.kind === 'mcq' ? <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{question.options.map((option, optionIndex) => <label key={optionIndex} className="flex gap-2 rounded-xl border border-slate-200 p-3"><input type="radio" checked={question.correctAnswer === optionIndex} onChange={() => update({ correctAnswer: optionIndex } as Partial<Candidate>)} /><input value={option} onChange={event => { const options = [...question.options]; options[optionIndex] = event.target.value; update({ options } as Partial<Candidate>) }} className="min-w-0 flex-1 outline-none" /></label>)}</div>
      <label className="mt-4 block text-sm font-bold">Answer explanation<textarea value={question.explanation} onChange={event => update({ explanation: event.target.value } as Partial<Candidate>)} rows={3} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal" /></label>
    </> : <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Short-answer questions are temporarily disabled. Reject this item; it will not be included when the test is published.</div>}
    {question.verificationIssues?.length ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="font-black text-rose-900">Verifier feedback</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-700">{question.verificationIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>{question.suggestedFix && <p className="mt-3 text-sm text-rose-800"><b>Suggested fix:</b> {question.suggestedFix}</p>}</div> : null}
    <div className="mt-4 flex flex-wrap gap-2">{question.sourceReferences.map((source, sourceIndex) => <button key={`${source.sourceId}-${sourceIndex}`} type="button" onClick={() => openSource(source)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-left text-xs text-indigo-800"><b>{source.filename}</b><span className="ml-1">{source.locator}</span></button>)}</div>
    <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} onClick={() => save('rejected')} className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-black text-rose-700 disabled:opacity-50">Reject</button>{question.kind === 'mcq' && <button type="button" disabled={busy} onClick={() => save('pending')} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black disabled:opacity-50">Save edits</button>}<button type="button" disabled={busy || question.kind !== 'mcq'} onClick={() => save('approved')} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{question.kind !== 'mcq' ? 'Short answers disabled' : busy ? 'Saving…' : question.reviewStatus === 'approved' ? 'Approved' : question.verificationStatus === 'unsupported' ? 'Override & approve' : 'Approve'}</button></div>
  </article>
}

function TextField({ label, value, setValue }: { label: string; value: string; setValue: (value: string) => void }) {
  return <label className="block text-sm font-bold">{label}<input value={value} onChange={event => setValue(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal" /></label>
}

function NumberField({ label, value, setValue, min, max }: { label: string; value: number; setValue: (value: number) => void; min: number; max: number }) {
  return <label className="block text-sm font-bold">{label}<input type="number" min={min} max={max} value={value} onChange={event => setValue(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal" /></label>
}

function SelectField({ label, value, setValue, options }: { label: string; value: string; setValue: (value: string) => void; options: Array<[string, string]> }) {
  return <label className="block text-sm font-bold">{label}<select value={value} onChange={event => setValue(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal">{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
}

function Badge({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'slate'; children: React.ReactNode }) {
  const classes = tone === 'green' ? 'bg-emerald-100 text-emerald-800' : tone === 'amber' ? 'bg-amber-100 text-amber-800' : tone === 'red' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'
  return <span className={`rounded-full px-2.5 py-1 text-xs font-black ${classes}`}>{children}</span>
}
