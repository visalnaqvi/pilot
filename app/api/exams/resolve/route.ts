import { randomUUID } from 'node:crypto'
import { eq, ilike, inArray, or } from 'drizzle-orm'
import { z } from 'zod'
import { examAliases, exams, organizationExams } from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { cleanAliases, normalizeExamKey, type ExamCatalogEntry } from '@/lib/exam-catalog'
import { suggestExamCatalogEntry } from '@/lib/exam-resolution'

const requestSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  selectionId: z.string().uuid().optional(),
  proposal: z.object({
    id: z.string(),
    name: z.string().trim().min(2).max(120),
    primaryAlias: z.string().trim().min(1).max(120),
    aliases: z.array(z.string().trim().min(1).max(120)).max(12),
  }).optional(),
})

async function entry(examId: string): Promise<ExamCatalogEntry | null> {
  const db = database()
  const item = (await db.select().from(exams).where(eq(exams.id, examId)).limit(1))[0]
  if (!item) return null
  const aliases = await db.select().from(examAliases).where(eq(examAliases.examId, examId))
  return {
    id: item.id,
    name: item.name,
    primaryAlias: aliases.find(alias => alias.isPrimary)?.alias || item.name,
    aliases: aliases.map(alias => alias.alias),
  }
}

async function selectForOrganization(examId: string, userId: string, organizationId: string | null) {
  if (!organizationId) return
  await database().insert(organizationExams).values({
    organizationId,
    examId,
    createdBy: userId,
  }).onConflictDoNothing()
}

async function findCatalogMatches(searchTerms: string[]) {
  const terms = [...new Set(searchTerms.map(term => term.trim()).filter(Boolean))]
  const normalizedTerms = [...new Set(terms.map(normalizeExamKey).filter(Boolean))]
  if (!normalizedTerms.length) return []
  const matches = await database().select({ id: exams.id }).from(exams)
    .leftJoin(examAliases, eq(examAliases.examId, exams.id))
    .where(or(
      inArray(exams.normalizedName, normalizedTerms),
      inArray(examAliases.normalizedAlias, normalizedTerms),
      ...terms.map(term => ilike(exams.name, `%${term}%`)),
    ))
    .limit(8)
  const uniqueIds = [...new Set(matches.map(item => item.id))]
  return (await Promise.all(uniqueIds.map(entry))).filter(
    (item): item is ExamCatalogEntry => Boolean(item),
  )
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  if (auth.user.globalRole !== 'admin' && !['owner', 'teacher'].includes(auth.user.membershipRole || '')) {
    return Response.json({ error: 'Organization manager access required.' }, { status: 403 })
  }
  try {
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid exam request.', issues: parsed.error.issues }, { status: 400 })
    const { selectionId, proposal, name } = parsed.data
    if (selectionId) {
      const selected = await entry(selectionId)
      if (!selected) return Response.json({ error: 'Exam not found.' }, { status: 404 })
      await selectForOrganization(selectionId, auth.user.uid, auth.user.organizationId)
      return Response.json({ status: 'selected', exam: selected })
    }
    if (proposal) {
      const normalizedName = normalizeExamKey(proposal.name)
      const aliases = cleanAliases(proposal.name, [proposal.primaryAlias, ...proposal.aliases])
      const created = await database().transaction(async tx => {
        const existing = (await tx.select().from(exams).where(eq(exams.normalizedName, normalizedName)).limit(1))[0]
        const exam = existing || (await tx.insert(exams).values({
          name: proposal.name,
          normalizedName,
          createdBy: auth.user.uid,
        }).returning())[0]
        if (!existing && aliases.length) {
          await tx.insert(examAliases).values(aliases.map((alias, index) => ({
            examId: exam.id,
            alias,
            normalizedAlias: normalizeExamKey(alias),
            isPrimary: index === 0,
          }))).onConflictDoNothing()
        }
        if (auth.user.organizationId) {
          await tx.insert(organizationExams).values({
            organizationId: auth.user.organizationId,
            examId: exam.id,
            createdBy: auth.user.uid,
          }).onConflictDoNothing()
        }
        return exam.id
      })
      return Response.json({ status: 'created', exam: await entry(created) })
    }
    if (!name) return Response.json({ error: 'Enter an exam name.' }, { status: 400 })
    const directMatches = await findCatalogMatches([name])
    if (directMatches.length) {
      return Response.json({ status: 'matches', exams: directMatches })
    }

    try {
      const suggestion = await suggestExamCatalogEntry(name)
      const suggestedMatches = await findCatalogMatches([
        suggestion.name,
        suggestion.primaryAlias,
        ...suggestion.aliases,
      ])
      if (suggestedMatches.length) {
        return Response.json({ status: 'matches', exams: suggestedMatches })
      }
      return Response.json({
        status: 'proposed',
        source: suggestion.recognized ? 'ai' : 'input',
        exam: {
          id: randomUUID(),
          name: suggestion.name,
          primaryAlias: suggestion.primaryAlias,
          aliases: suggestion.aliases,
        },
      })
    } catch (error) {
      console.error('AI exam resolution failed:', error)
      return Response.json({
        status: 'proposed',
        source: 'input',
        exam: { id: randomUUID(), name, primaryAlias: name, aliases: [] },
      })
    }
  } catch (error) {
    return errorResponse(error, 'Unable to resolve this exam.')
  }
}
