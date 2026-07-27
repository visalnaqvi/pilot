import { z } from 'zod'

export const EXAM_SECTIONS = ['overview', 'schedule', 'eligibility', 'pattern', 'syllabus', 'resources'] as const
export type ExamSection = (typeof EXAM_SECTIONS)[number]

const NullableText = z.string().trim().max(4000).nullable()
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
export const HttpUrlSchema = z.string().trim().refine((value) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}, 'Enter a valid HTTP or HTTPS URL.')

export const EvidenceRefSchema = z.object({
  sourceId: z.string(),
  sourceTitle: z.string(),
  url: HttpUrlSchema,
  snapshotPath: z.string().nullable(),
  excerpt: z.string(),
  chunkIds: z.array(z.string()),
  capturedAt: z.string(),
  sourceKind: z.enum(['official', 'secondary']).optional(),
})

export const OverviewSchema = z.object({
  officialName: NullableText,
  conductingBody: NullableText,
  summary: NullableText,
  status: z.enum(['announced', 'applications_open', 'scheduled', 'completed', 'postponed', 'cancelled', 'not_announced']).nullable(),
  applicationMethod: NullableText,
  vacanciesLabel: NullableText,
})

export const ScheduleEventSchema = z.object({
  id: z.string(),
  type: z.enum(['notification', 'application_open', 'application_close', 'correction_window', 'admit_card', 'exam', 'answer_key', 'result', 'counselling', 'other']),
  label: z.string(),
  stage: NullableText,
  startDate: IsoDate,
  endDate: IsoDate,
  dateText: NullableText,
  precision: z.enum(['exact', 'month', 'expected', 'tba']),
  status: z.enum(['confirmed', 'tentative', 'postponed', 'cancelled']),
})

export const ScheduleSchema = z.object({
  events: z.array(ScheduleEventSchema),
})

export const EligibilitySchema = z.object({
  qualifications: z.array(z.string()),
  minimumAge: z.number().int().min(0).max(100).nullable(),
  maximumAge: z.number().int().min(0).max(100).nullable(),
  ageAsOf: IsoDate,
  nationality: z.array(z.string()),
  attemptLimit: NullableText,
  experience: NullableText,
  reservationNotes: NullableText,
  fees: z.array(z.object({
    category: z.string(),
    amount: z.number().min(0).nullable(),
    currency: z.string(),
    note: NullableText,
  })),
})

export const PatternSchema = z.object({
  stages: z.array(z.object({
    id: z.string(),
    name: z.string(),
    mode: NullableText,
    durationMinutes: z.number().int().positive().nullable(),
    questionCount: z.number().int().nonnegative().nullable(),
    totalMarks: z.number().nonnegative().nullable(),
    negativeMarking: NullableText,
    qualifyingRule: NullableText,
    sections: z.array(z.object({
      name: z.string(),
      questions: z.number().int().nonnegative().nullable(),
      marks: z.number().nonnegative().nullable(),
      durationMinutes: z.number().int().positive().nullable(),
    })),
  })),
})

export const SyllabusSchema = z.object({
  groups: z.array(z.object({
    stage: NullableText,
    subject: z.string(),
    topics: z.array(z.string()),
    notes: NullableText,
  })),
})

export const ExamLinkSchema = z.object({
  label: z.string(),
  url: HttpUrlSchema,
  kind: z.enum(['authority', 'notification', 'application', 'syllabus', 'other']),
})

export const ExamCycleDetailsSchema = z.object({
  id: z.string(),
  label: z.string(),
  year: z.number().int().min(1900).max(2200).nullable(),
  isActive: z.boolean(),
  overview: OverviewSchema,
  schedule: ScheduleSchema,
  eligibility: EligibilitySchema,
  pattern: PatternSchema,
  syllabus: SyllabusSchema,
  links: z.array(ExamLinkSchema),
  evidence: z.record(z.string(), z.array(EvidenceRefSchema)),
  sectionRevisionIds: z.record(z.string(), z.string()).optional().default({}),
  publishedAt: z.unknown().optional(),
  publishedRevisionId: z.string().nullable(),
})

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>
export type ExamCycleDetails = z.infer<typeof ExamCycleDetailsSchema>
export type OverviewDetails = z.infer<typeof OverviewSchema>
export type ScheduleDetails = z.infer<typeof ScheduleSchema>
export type EligibilityDetails = z.infer<typeof EligibilitySchema>
export type PatternDetails = z.infer<typeof PatternSchema>
export type SyllabusDetails = z.infer<typeof SyllabusSchema>

export type ExamCatalogSummary = {
  id: string
  name: string
  createdBy?: string
  organisationIds?: string[]
  primaryAlias?: string
  aliases?: string[]
  activeCycleId?: string | null
  lastCheckedAt?: unknown
  lastPublishedAt?: unknown
  publishedRevisionId?: string | null
  latestUpdateSummary?: string | null
  pendingRevisionCount?: number
  lastRefreshStatus?: 'changed' | 'unchanged' | 'insufficient_evidence' | 'error' | 'skipped'
  lastRefreshError?: string | null
}

export type ExamRevision = {
  id: string
  examId: string
  examName: string
  cycleId: string
  cycleLabel: string
  section: ExamSection
  status: 'pending' | 'approved' | 'rejected'
  before: unknown
  after: unknown
  evidence: Record<string, EvidenceRef[]>
  summary: string
  confidence: number
  sourceId: string
  sourceTitle: string
  sourceUrl: string
  runId: string
  flowVersion?: 'gpt_web_v1'
  provisionallyPublishedAt?: unknown
  previousActiveCycleId?: string | null
  previousSectionRevisionId?: string | null
  beforeEvidence?: Record<string, EvidenceRef[]>
  createdCycle?: boolean
  reviewReason?: string
  revertedAt?: unknown
  createdAt?: unknown
  reviewedAt?: unknown
  reviewedBy?: string
}

export type ExamUpdate = {
  id: string
  examId: string
  cycleId: string
  section: ExamSection
  summary: string
  sourceTitle: string
  sourceUrl: string
  publishedAt?: unknown
  publishedRevisionId: string
  verificationStatus?: 'pending' | 'verified'
}

export function emptyExamCycle(id: string, label: string): ExamCycleDetails {
  const year = Number(label.match(/\b(20\d{2})\b/)?.[1] || '') || null
  return {
    id,
    label,
    year,
    isActive: true,
    overview: {
      officialName: null,
      conductingBody: null,
      summary: null,
      status: 'not_announced',
      applicationMethod: null,
      vacanciesLabel: null,
    },
    schedule: { events: [] },
    eligibility: {
      qualifications: [],
      minimumAge: null,
      maximumAge: null,
      ageAsOf: null,
      nationality: [],
      attemptLimit: null,
      experience: null,
      reservationNotes: null,
      fees: [],
    },
    pattern: { stages: [] },
    syllabus: { groups: [] },
    links: [],
    evidence: {},
    sectionRevisionIds: {},
    publishedRevisionId: null,
  }
}

export function sectionValue(cycle: ExamCycleDetails, section: ExamSection) {
  return section === 'resources' ? cycle.links : cycle[section]
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function sectionsEqual(left: unknown, right: unknown) {
  return stableJson(left) === stableJson(right)
}

export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate()
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.valueOf()) ? null : date
  }
  return null
}

export function isStale(lastCheckedAt: unknown, days = 2) {
  const checked = toDate(lastCheckedAt)
  return !checked || Date.now() - checked.valueOf() > days * 86_400_000
}

export function sortSchedule(events: z.infer<typeof ScheduleEventSchema>[]) {
  return events.slice().sort((left, right) => {
    if (!left.startDate && !right.startDate) return left.label.localeCompare(right.label)
    if (!left.startDate) return 1
    if (!right.startDate) return -1
    return left.startDate.localeCompare(right.startDate)
  })
}
