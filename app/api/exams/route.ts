import { asc, eq, inArray } from 'drizzle-orm'
import { examAliases, exams, organizationExams } from '@/db/schema'
import { authenticateRequest, errorResponse } from '@/lib/admin-api'
import { database } from '@/lib/db'

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if ('error' in auth) return auth.error
  try {
    const db = database()
    const scope = new URL(request.url).searchParams.get('scope')
    const includeCatalog = scope === 'catalog'
    const catalog = includeCatalog || auth.user.globalRole === 'admin' || !auth.user.organizationId
      ? await db.select().from(exams).orderBy(asc(exams.name))
      : await db.select({
          id: exams.id,
          name: exams.name,
          normalizedName: exams.normalizedName,
          createdBy: exams.createdBy,
          createdAt: exams.createdAt,
          updatedAt: exams.updatedAt,
        }).from(organizationExams)
          .innerJoin(exams, eq(exams.id, organizationExams.examId))
          .where(eq(organizationExams.organizationId, auth.user.organizationId))
          .orderBy(asc(exams.name))
    const ids = catalog.map(item => item.id)
    const aliases = ids.length ? await db.select().from(examAliases).where(inArray(examAliases.examId, ids)) : []
    return Response.json({
      items: catalog.map(item => {
        const ownAliases = aliases.filter(alias => alias.examId === item.id)
        return {
          id: item.id,
          name: item.name,
          canonicalName: item.name,
          primaryAlias: ownAliases.find(alias => alias.isPrimary)?.alias || item.name,
          aliases: ownAliases.map(alias => alias.alias),
        }
      }),
      nextCursor: null,
    })
  } catch (error) {
    return errorResponse(error, 'Unable to load exams.')
  }
}
