export type ExamCatalogEntry = {
  id: string
  name: string
  primaryAlias: string
  aliases: string[]
}

export type ExamResolution =
  | { status: 'matches'; exams: ExamCatalogEntry[] }
  | { status: 'proposed'; exam: ExamCatalogEntry }
  | { status: 'selected'; exam: ExamCatalogEntry }
  | { status: 'created'; exam: ExamCatalogEntry }

export type ExamSelectionStatus = 'selected' | 'created'

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
