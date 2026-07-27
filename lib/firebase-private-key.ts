export function normalizeFirebasePrivateKey(value: string | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return undefined

  const quote = trimmed[0]
  const unquoted = (quote === '"' || quote === "'") && trimmed.at(-1) === quote
    ? trimmed.slice(1, -1)
    : trimmed

  return unquoted
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\r\n?/g, '\n')
    .trim()
}
