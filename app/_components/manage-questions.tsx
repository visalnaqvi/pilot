'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { authenticatedFetch } from '@/lib/authenticated-fetch'
import { useAuth } from './auth-context'
import { MathText, MathTextEditor } from './math-components'
import { paginate, Pagination } from './pagination'
import type { QuestionBankItem, QuestionContent } from './test-types'

export function ManageQuestions() {
  const { user, profile } = useAuth()
  const [items, setItems] = useState<QuestionBankItem[]>([])
  const [message, setMessage] = useState('')
  const [page, setPage] = useState(1)
  const allowed = profile?.role === 'admin' || profile?.role === 'organisation'
  const load = async () => {
    if (!user || !allowed) return
    const response = await authenticatedFetch(user, '/api/questions', { cache: 'no-store' })
    const data = await response.json()
    if (response.ok) setItems(data.items)
    else setMessage(data.error)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { queueMicrotask(() => void load()) }, [allowed, user])
  async function archive(item: QuestionBankItem) {
    if (!user) return
    if (!confirm(`${item.archivedAt ? 'Restore' : 'Archive'} “${item.prompt}”? Existing tests will keep it.`)) return
    const response = await authenticatedFetch(user, '/api/questions', {
      method: 'PATCH',
      body: JSON.stringify({ id: item.id, archived: !item.archivedAt }),
    })
    setMessage(response.ok ? 'Question updated.' : (await response.json()).error)
    if (response.ok) await load()
  }
  if (!allowed) return <section><h1 className="text-3xl font-black">Access denied</h1></section>
  const visible = paginate(items, page)
  return <section className="mx-auto max-w-4xl">
    <Link href="/manage/tests" className="text-sm font-bold text-indigo-600">← Manage tests</Link>
    <div className="mt-5 flex items-end justify-between gap-4"><div><p className="text-sm font-bold tracking-widest text-indigo-600">QUESTION BANK</p><h1 className="mt-1 text-4xl font-black">Manage questions</h1><p className="mt-2 text-slate-600">Archived questions cannot be selected for new tests but remain available to existing tests.</p></div><Link href="/tests/create" className="rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white">Create test</Link></div>
    {message && <p className="mt-5 text-rose-700">{message}</p>}
    <div className="mt-7 space-y-3">{visible.items.map(item => <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-semibold"><MathText>{item.prompt}</MathText></p><p className="mt-1 text-xs text-slate-500">{item.kind === 'short_answer' ? 'short answer · ' : ''}{item.visibility} · revision {item.revision} · {item.archivedAt ? 'archived' : 'active'}</p></div><div className="flex gap-2">{item.kind !== 'short_answer' && <Link href={`/manage/questions/${item.id}/edit`} className="rounded-lg border border-indigo-200 px-3 py-2 text-sm font-bold text-indigo-700">Edit</Link>}<button onClick={() => void archive(item)} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-bold text-rose-700">{item.archivedAt ? 'Restore' : 'Archive'}</button></div></div></article>)}
    {items.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-8 text-slate-500">Questions are added to the bank when you publish a test.</p>}<Pagination page={visible.page} totalItems={items.length} onPageChange={setPage} itemLabel="questions" className="rounded-xl border border-slate-200 bg-white" /></div>
  </section>
}

export function EditQuestion({ id }: { id: string }) {
  const { user } = useAuth()
  const router = useRouter()
  const [content, setContent] = useState<QuestionContent>({ prompt: '', options: ['', '', '', ''], correctAnswer: 0 })
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!user) return
    authenticatedFetch(user, `/api/questions?id=${id}`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        setContent({ prompt: data.item.prompt, options: data.item.options || ['', '', '', ''], correctAnswer: data.item.correctAnswer || 0 })
      })
      .catch(reason => setMessage(reason.message))
  }, [id, user])
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!user) return
    const response = await authenticatedFetch(user, '/api/questions', {
      method: 'PATCH',
      body: JSON.stringify({ id, prompt: content.prompt, options: content.options, correctAnswer: content.correctAnswer }),
    })
    if (response.ok) router.push('/manage/questions')
    else setMessage((await response.json()).error)
  }
  return <section className="mx-auto max-w-3xl"><Link href="/manage/questions" className="text-sm font-bold text-indigo-600">← Question bank</Link><h1 className="mt-5 text-4xl font-black">Edit bank question</h1><form onSubmit={save} className="mt-7 rounded-2xl bg-white p-6 shadow-sm"><MathTextEditor multiline required value={content.prompt} onChange={prompt => setContent(current => ({ ...current, prompt }))} placeholder="Write your question. Use Insert equation for mathematical notation." inputClassName="min-h-28 w-full rounded-lg border border-slate-200 p-3" />{content.options.map((option, index) => <div key={index} className="mt-3 rounded-lg border border-slate-200 p-3"><div className="flex items-start gap-3"><input type="radio" checked={content.correctAnswer === index} onChange={() => setContent(current => ({ ...current, correctAnswer: index }))} className="mt-2" /><MathTextEditor required value={option} onChange={value => setContent(current => ({ ...current, options: current.options.map((item, optionIndex) => optionIndex === index ? value : item) }))} inputClassName="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 outline-none" /></div></div>)}{message && <p className="mt-4 text-sm text-rose-700">{message}</p>}<button className="mt-6 rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white">Save question</button></form></section>
}
