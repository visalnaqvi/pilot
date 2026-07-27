import { z } from 'zod'
import {
  EligibilitySchema,
  ExamLinkSchema,
  OverviewSchema,
  PatternSchema,
  ScheduleSchema,
  SyllabusSchema,
  type EvidenceRef,
  type ExamSection,
} from '@/lib/exam-information'

export const RefreshClaimSchema = z.object({
  fieldPath: z.string().startsWith('/'),
  sourceUrl: z.string(),
  sourceTitle: z.string(),
  sourceKind: z.enum(['official', 'secondary']),
  claim: z.string(),
})

const RefreshSection = <T extends z.ZodType>(schema: T) => z.object({
  present: z.boolean(),
  data: schema,
  claims: z.array(RefreshClaimSchema),
})

export const ExamWebRefreshSchema = z.object({
  identityMatch: z.boolean(),
  status: z.enum(['changed', 'unchanged', 'insufficient_evidence']),
  cycleId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
  cycleLabel: z.string(),
  year: z.number().int().min(1900).max(2200).nullable(),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  overview: RefreshSection(OverviewSchema),
  schedule: RefreshSection(ScheduleSchema),
  eligibility: RefreshSection(EligibilitySchema),
  pattern: RefreshSection(PatternSchema),
  syllabus: RefreshSection(SyllabusSchema),
  resources: RefreshSection(z.array(ExamLinkSchema)),
})

export type ExamWebRefresh = z.infer<typeof ExamWebRefreshSchema>
export type RefreshClaim = z.infer<typeof RefreshClaimSchema>

export function canonicalSourceUrl(value: string) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Unsupported evidence URL protocol: ${url.protocol}`)
  url.hash = ''
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString()
}

function leafValues(value: unknown, prefix = ''): Map<string, string> {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return new Map()
  if (Array.isArray(value)) {
    const usesStableIds = value.every((item) =>
      item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')
    return new Map(value.flatMap((item, index) => {
      const segment = usesStableIds
        ? `~id=${encodeURIComponent((item as { id: string }).id)}`
        : String(index)
      return [...leafValues(item, `${prefix}/${segment}`)]
    }))
  }
  if (typeof value === 'object') {
    return new Map(Object.entries(value as Record<string, unknown>)
      .flatMap(([key, item]) => [...leafValues(item, `${prefix}/${key}`)]))
  }
  return new Map([[prefix || '/', JSON.stringify(value)]])
}

function claimCoversPath(claimPath: string, path: string) {
  if (claimPath === path || (claimPath !== '/' && path.startsWith(`${claimPath}/`))) return true
  const arrayItemRoot = (value: string) => {
    const segments = value.split('/')
    const numericIndex = segments.findIndex((segment) => /^\d+$/.test(segment) || segment.startsWith('~id='))
    return numericIndex >= 0 ? segments.slice(0, numericIndex + 1).join('/') : null
  }
  const claimRoot = arrayItemRoot(claimPath)
  return Boolean(claimRoot && claimRoot === arrayItemRoot(path))
}

function semanticClaimPath(path: string, section: ExamSection, data: unknown) {
  const segments = path.split('/').filter(Boolean)
  if (segments[0] !== section) return path
  const normalized: string[] = [section]
  let current = data
  for (const segment of segments.slice(1)) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      const item = current[Number(segment)]
      if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
        normalized.push(`~id=${encodeURIComponent((item as { id: string }).id)}`)
      } else {
        normalized.push(segment)
      }
      current = item
      continue
    }
    normalized.push(segment)
    current = current && typeof current === 'object'
      ? (current as Record<string, unknown>)[segment]
      : undefined
  }
  return `/${normalized.join('/')}`
}

export function validateRefreshEvidence(input: {
  section: ExamSection
  before: unknown
  after: unknown
  claims: RefreshClaim[]
  consultedUrls: Set<string>
}) {
  const root = `/${input.section}`
  const normalizedClaimPaths = new Map<RefreshClaim, string>()
  for (const claim of input.claims) {
    if (!claim.fieldPath.startsWith(root)) {
      throw new Error(`Evidence path ${claim.fieldPath} does not belong to ${input.section}.`)
    }
    const citedUrl = canonicalSourceUrl(claim.sourceUrl)
    if (!input.consultedUrls.has(citedUrl)) {
      const examples = [...input.consultedUrls].slice(0, 3).join(', ')
      throw new Error(`Evidence URL was not returned by web search: ${claim.sourceUrl}. Returned URL count: ${input.consultedUrls.size}${examples ? `; examples: ${examples}` : ''}`)
    }
    if (claim.claim.trim().length < 8) {
      throw new Error(`Evidence claim for ${claim.fieldPath} is too short.`)
    }
    const afterPath = semanticClaimPath(claim.fieldPath, input.section, input.after)
    const normalizedPath = afterPath === claim.fieldPath
      ? semanticClaimPath(claim.fieldPath, input.section, input.before)
      : afterPath
    normalizedClaimPaths.set(claim, normalizedPath)
  }

  const beforeLeaves = leafValues(input.before, root)
  const afterLeaves = leafValues(input.after, root)
  const changedPaths = [...new Set([...beforeLeaves.keys(), ...afterLeaves.keys()])]
    .filter((path) => beforeLeaves.get(path) !== afterLeaves.get(path))
  const uncovered = changedPaths.filter((path) =>
    !input.claims.some((claim) => claimCoversPath(normalizedClaimPaths.get(claim) || claim.fieldPath, path)))
  if (uncovered.length) {
    throw new Error(`Missing cited evidence for ${uncovered.slice(0, 5).join(', ')}${uncovered.length > 5 ? '…' : ''}`)
  }
}

export function evidenceFromClaims(claims: RefreshClaim[], capturedAt: string): Record<string, EvidenceRef[]> {
  const evidence: Record<string, EvidenceRef[]> = {}
  for (const claim of claims) {
    const references = evidence[claim.fieldPath] || []
    references.push({
      sourceId: canonicalSourceUrl(claim.sourceUrl),
      sourceTitle: claim.sourceTitle,
      url: claim.sourceUrl,
      snapshotPath: null,
      excerpt: claim.claim,
      chunkIds: [],
      capturedAt,
      sourceKind: claim.sourceKind,
    })
    evidence[claim.fieldPath] = references
  }
  return evidence
}
