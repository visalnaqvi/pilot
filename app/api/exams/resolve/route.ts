import OpenAI from 'openai'
import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { cleanAliases, examCatalogId, normalizeExamKey, type ExamCatalogEntry } from '@/lib/exam-catalog'

export const runtime = 'nodejs'

const MAX_NAME_LENGTH = 120

function jsonError(message: string, status: number) { return Response.json({ error: message }, { status }) }
function asEntry(id: string, data: FirebaseFirestore.DocumentData): ExamCatalogEntry { const aliases = Array.isArray(data.aliases) ? data.aliases.filter((value: unknown): value is string => typeof value === 'string') : []; return { id, name: data.name, primaryAlias: typeof data.primaryAlias === 'string' && data.primaryAlias.trim() ? data.primaryAlias.trim() : aliases[0] || data.name, aliases } }
function parseProposal(value: unknown): ExamCatalogEntry | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  if (typeof input.name !== 'string' || typeof input.primaryAlias !== 'string' || !Array.isArray(input.aliases)) return null
  const name = input.name.trim().slice(0, MAX_NAME_LENGTH)
  const id = examCatalogId(name)
  if (!name || !id) return null
  const primaryAlias = cleanAliases('', [input.primaryAlias])[0] || name
  const aliases = cleanAliases(name, [primaryAlias, ...input.aliases])
  return { id, name, primaryAlias, aliases }
}

async function searchCatalog(query: string) {
  const key = normalizeExamKey(query)
  const keys = [...new Set([key, ...key.split(' ').filter(Boolean)])].slice(0, 10)
  const catalog = adminDb.collection('examCatalog')
  const [canonical, aliases] = await Promise.all([
    catalog.where('nameKey', 'in', keys).limit(12).get(),
    catalog.where('aliasKeys', 'array-contains-any', keys).limit(12).get(),
  ])
  const entries = new Map<string, ExamCatalogEntry>()
  for (const snapshot of [...canonical.docs, ...aliases.docs]) entries.set(snapshot.id, asEntry(snapshot.id, snapshot.data()))
  return [...entries.values()].slice(0, 12)
}

function parseDecision(text: string): { action: 'matches'; ids: string[] } | { action: 'create'; name: string; primaryAlias: string; aliases: string[] } {
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object') throw new Error('The model returned an invalid result.')
  const value = parsed as Record<string, unknown>
  if (value.action === 'matches' && Array.isArray(value.ids) && value.ids.every((id) => typeof id === 'string')) return { action: 'matches', ids: value.ids.slice(0, 5) }
  if (value.action === 'create' && typeof value.name === 'string' && typeof value.primaryAlias === 'string') return { action: 'create', name: value.name, primaryAlias: value.primaryAlias, aliases: Array.isArray(value.aliases) ? value.aliases : [] }
  throw new Error('The model returned an invalid result.')
}

async function resolveWithModel(name: string) {
  if (!process.env.OPENAI_API_KEY) throw new Error('Exam matching is not configured.')
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const instructions = 'Resolve a user-entered exam name against the catalog. You must call search_exam_catalog before deciding. Return JSON only: {"action":"matches","ids":["catalog-id"]} when the search has relevant candidates; otherwise {"action":"create","name":"Canonical Exam Name","primaryAlias":"Short display alias","aliases":["common alias"]}. primaryAlias must be the best concise, widely recognized display name or abbreviation for the canonical name. Include it in aliases when it differs from the canonical name. Never invent match IDs. Keep aliases concise and distinct.'
  let response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    instructions,
    input: name,
    tools: [{ type: 'function', name: 'search_exam_catalog', description: 'Search canonical exam names and aliases in the application catalog.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }, strict: true }],
  })
  for (let round = 0; round < 2; round += 1) {
    const calls = response.output.filter((item) => item.type === 'function_call')
    if (!calls.length) return parseDecision(response.output_text)
    response = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      instructions,
      previous_response_id: response.id,
      input: await Promise.all(calls.map(async (call) => {
        let query = name
        try { const args = JSON.parse(call.arguments) as { query?: unknown }; if (typeof args.query === 'string') query = args.query } catch { /* use entered name */ }
        return { type: 'function_call_output' as const, call_id: call.call_id, output: JSON.stringify(await searchCatalog(query)) }
      })),
    })
  }
  throw new Error('The model did not complete exam matching.')
}

async function matchingEntries(ids: string[]) {
  const entries = await Promise.all(ids.map(async (id) => {
    const document = await adminDb.collection('examCatalog').doc(id).get()
    return document.exists ? asEntry(document.id, document.data()!) : null
  }))
  return entries.filter((entry): entry is ExamCatalogEntry => entry !== null)
}

async function createExam(proposal: ExamCatalogEntry, userId: string) {
  const ref = adminDb.collection('examCatalog').doc(proposal.id)
  return adminDb.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref)
    if (existing.exists) {
      transaction.set(ref, {
        organisationIds: FieldValue.arrayUnion(userId),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return asEntry(existing.id, existing.data()!)
    }
    transaction.create(ref, {
      name: proposal.name,
      primaryAlias: proposal.primaryAlias,
      nameKey: normalizeExamKey(proposal.name),
      aliases: proposal.aliases,
      aliasKeys: [normalizeExamKey(proposal.name), ...proposal.aliases.map(normalizeExamKey)],
      createdBy: userId,
      organisationIds: [userId],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return proposal
  })
}

export async function POST(request: Request) {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return jsonError('Sign in to add an exam.', 401)
    const decoded = await adminAuth.verifyIdToken(token)
    const profile = await adminDb.collection('users').doc(decoded.uid).get()
    if (!profile.exists || !['admin', 'organisation'].includes(profile.data()?.role)) return jsonError('You are not allowed to add exams.', 403)
    const body: unknown = await request.json()
    const input = body && typeof body === 'object' ? body as { name?: unknown; proposal?: unknown; selectionId?: unknown } : {}
    if (input.selectionId !== undefined) {
      if (typeof input.selectionId !== 'string' || !input.selectionId.trim()) return jsonError('Select a valid exam.', 400)
      const ref = adminDb.collection('examCatalog').doc(input.selectionId)
      const document = await ref.get()
      if (!document.exists) return jsonError('That exam no longer exists.', 404)
      await ref.set({
        organisationIds: FieldValue.arrayUnion(decoded.uid),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return Response.json({ status: 'selected', exam: asEntry(document.id, document.data()!) })
    }
    const confirmedProposal = input.proposal === undefined ? null : parseProposal(input.proposal)
    if (input.proposal !== undefined && !confirmedProposal) return jsonError('The proposed exam details are invalid.', 400)
    if (!confirmedProposal && (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > MAX_NAME_LENGTH)) return jsonError('Enter an exam name of up to 120 characters.', 400)
    const enteredName = confirmedProposal?.name || (input.name as string).trim()
    const decision = await resolveWithModel(enteredName)
    if (decision.action === 'matches') {
      const exams = await matchingEntries(decision.ids)
      if (exams.length) return Response.json({ status: 'matches', exams })
    }
    if (confirmedProposal) {
      return Response.json({ status: 'created', exam: await createExam(confirmedProposal, decoded.uid) })
    }
    const name = (decision.action === 'create' ? decision.name : enteredName).trim().slice(0, MAX_NAME_LENGTH)
    const id = examCatalogId(name)
    if (!id) return jsonError('Unable to create a valid exam name.', 400)
    const proposedAlias = decision.action === 'create' ? decision.primaryAlias : name
    const primaryAlias = cleanAliases('', [proposedAlias])[0] || name
    const aliases = cleanAliases(name, decision.action === 'create' ? [primaryAlias, ...decision.aliases] : [])
    return Response.json({ status: 'proposed', exam: { id, name, primaryAlias, aliases } })
  } catch (error) {
    console.error('Exam resolution failed:', error)
    return jsonError(error instanceof Error ? error.message : 'Unable to resolve this exam.', 500)
  }
}
