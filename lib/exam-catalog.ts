export type ExamCatalogEntry = {
  id: string
  name: string
  primaryAlias: string
  aliases: string[]
}

export type ExamResolution =
  | { status: 'matches'; exams: ExamCatalogEntry[] }
  | { status: 'proposed'; exam: ExamCatalogEntry; source?: 'ai' | 'input' }
  | { status: 'selected'; exam: ExamCatalogEntry }
  | { status: 'created'; exam: ExamCatalogEntry }

export type ExamSelectionStatus = 'selected' | 'created'

export type ExamCatalogSuggestion = {
  recognized: boolean
  canonicalName: string
  primaryAlias: string
  aliases: string[]
}

export const EXAM_CATALOG_NAMING_INSTRUCTION = [
  'Always return a concise, catalog-ready canonical exam name, including when the search is generic, descriptive, ambiguous, or not a recognized official exam.',
  'Convert informal school terminology into a conventional exam title while preserving essential details such as class or grade, board, level, and exam type.',
  'Do not merely copy or title-case the user search as the canonical name.',
  'For example, a search such as "12th standard final board exam" should become "Class 12 Board Examination" unless the input identifies a more specific board or region.',
].join(' ')

export function normalizeExamKey(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function examCatalogId(name: string) {
  const key = normalizeExamKey(name)
  const slug = key.replace(/\s+/g, '-').slice(0, 100)
  let hash = 2166136261
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return `${slug}-${(hash >>> 0).toString(36)}`
}

export function cleanAliases(name: string, aliases: unknown) {
  const canonical = name.trim()
  const seen = new Set([normalizeExamKey(canonical)])
  if (!Array.isArray(aliases)) return []
  return aliases
    .filter((alias): alias is string => typeof alias === 'string')
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 1 && alias.length <= 120)
    .filter((alias) => {
      const key = normalizeExamKey(alias)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 12)
}

export function prepareExamCatalogProposal(searchName: string, suggestion: ExamCatalogSuggestion) {
  const searched = searchName.trim()
  const name = suggestion.canonicalName.trim() || searched
  const aliases = cleanAliases(name, [
    suggestion.primaryAlias,
    ...suggestion.aliases,
    searched,
  ])
  const requestedPrimaryKey = normalizeExamKey(suggestion.primaryAlias)
  const primaryAlias = aliases.find(alias => normalizeExamKey(alias) === requestedPrimaryKey)
    || aliases[0]
    || name
  return { name, primaryAlias, aliases }
}
