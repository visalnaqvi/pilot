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

export function firebasePrivateKeyFromEnv(env: {
  FIREBASE_ADMIN_PRIVATE_KEY?: string
  FIREBASE_PRIVATE_KEY?: string
}) {
  return normalizeFirebasePrivateKey(env.FIREBASE_ADMIN_PRIVATE_KEY)
    ?? normalizeFirebasePrivateKey(env.FIREBASE_PRIVATE_KEY)
}
