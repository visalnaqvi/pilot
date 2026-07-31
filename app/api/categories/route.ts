import { and, asc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { categories } from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'
import { normalizeExamKey } from '@/lib/exam-catalog'
import { canManageOrganization } from '@/lib/services/access'

const createSchema = z.object({
  organizationId: z.string().uuid().nullable().optional(),
  examId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
})

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const url = new URL(request.url)
    const organizationId = url.searchParams.get('organizationId') || auth.user.organizationId
    const examId = url.searchParams.get('examId')
    const rows = await database().select().from(categories).where(and(
      examId ? eq(categories.examId, examId) : undefined,
      organizationId
        ? eq(categories.organizationId, organizationId)
        : isNull(categories.organizationId),
    )).orderBy(asc(categories.name))
    return Response.json({
      items: rows.map(item => ({
        id: item.id,
        name: item.name,
        examId: item.examId,
        organizationId: item.organizationId,
        organisationId: item.organizationId,
        createdBy: item.createdBy,
      })),
      nextCursor: null,
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load categories.')
  }
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const parsed = createSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid category.', issues: parsed.error.issues }, { status: 400 })
    const organizationId = parsed.data.organizationId || auth.user.organizationId
    if (organizationId && !(await canManageOrganization(auth.user, organizationId))) {
      return Response.json({ error: 'Organization content access required.' }, { status: 403 })
    }
    if (!organizationId && auth.user.globalRole !== 'admin') {
      return Response.json({ error: 'An organization is required.' }, { status: 403 })
    }
    const normalizedName = normalizeExamKey(parsed.data.name)
    const db = database()
    const existing = (await db.select().from(categories).where(and(
      eq(categories.examId, parsed.data.examId),
      organizationId ? eq(categories.organizationId, organizationId) : isNull(categories.organizationId),
      eq(categories.normalizedName, normalizedName),
    )).limit(1))[0]
    if (existing) return Response.json({ item: { ...existing, organisationId: existing.organizationId } })
    const [item] = await db.insert(categories).values({
      organizationId,
      examId: parsed.data.examId,
      name: parsed.data.name,
      normalizedName,
      createdBy: auth.user.uid,
    }).returning()
    return Response.json({ item: { ...item, organisationId: item.organizationId } }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'Unable to create category.')
  }
}
