import { verify as verifySignature } from 'node:crypto'

const FIREBASE_CERTIFICATES_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
const MAX_TOKEN_LENGTH = 16_384
const CLOCK_SKEW_SECONDS = 300

type FirebaseTokenHeader = {
  alg?: unknown
  kid?: unknown
}

export type VerifiedFirebaseIdToken = {
  uid: string
  email?: string
  name?: string
  emailVerified: boolean
}

type FirebaseTokenPayload = {
  aud?: unknown
  iss?: unknown
  sub?: unknown
  exp?: unknown
  iat?: unknown
  auth_time?: unknown
  email?: unknown
  email_verified?: unknown
  name?: unknown
}

type FirebaseCertificates = Record<string, string>

let cachedCertificates: { values: FirebaseCertificates; expiresAt: number } | null = null
let certificatesRequest: Promise<FirebaseCertificates> | null = null

function decodeJsonSegment<T>(segment: string): T {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T
  } catch {
    throw new Error('The authentication token is malformed.')
  }
}

function requiredNumber(value: unknown, claim: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`The authentication token has an invalid ${claim} claim.`)
  }
  return value
}

function certificateMaxAge(header: string | null) {
  const seconds = Number(header?.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1])
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 300
}

async function loadFirebaseCertificates() {
  if (cachedCertificates && cachedCertificates.expiresAt > Date.now()) {
    return cachedCertificates.values
  }
  if (certificatesRequest) return certificatesRequest

  certificatesRequest = (async () => {
    const response = await fetch(FIREBASE_CERTIFICATES_URL, { cache: 'no-store' })
    if (!response.ok) throw new Error('Firebase signing certificates are unavailable.')
    const result: unknown = await response.json()
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('Firebase returned invalid signing certificates.')
    }
    const certificates = Object.fromEntries(
      Object.entries(result).filter((entry): entry is [string, string] => (
        typeof entry[1] === 'string' && entry[1].includes('BEGIN CERTIFICATE')
      )),
    )
    if (!Object.keys(certificates).length) {
      throw new Error('Firebase returned no signing certificates.')
    }
    cachedCertificates = {
      values: certificates,
      expiresAt: Date.now() + certificateMaxAge(response.headers.get('cache-control')) * 1_000,
    }
    return certificates
  })()

  try {
    return await certificatesRequest
  } finally {
    certificatesRequest = null
  }
}

export function verifyFirebaseIdTokenWithCertificates(
  token: string,
  projectId: string,
  certificates: FirebaseCertificates,
  nowSeconds = Math.floor(Date.now() / 1_000),
): VerifiedFirebaseIdToken {
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    throw new Error('The authentication token is malformed.')
  }
  const segments = token.split('.')
  if (segments.length !== 3 || segments.some(segment => !segment)) {
    throw new Error('The authentication token is malformed.')
  }

  const header = decodeJsonSegment<FirebaseTokenHeader>(segments[0])
  const payload = decodeJsonSegment<FirebaseTokenPayload>(segments[1])
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new Error('The authentication token has an invalid signing header.')
  }
  const certificate = certificates[header.kid]
  if (!certificate) throw new Error('The authentication token uses an unknown signing key.')

  const validSignature = verifySignature(
    'RSA-SHA256',
    Buffer.from(`${segments[0]}.${segments[1]}`),
    certificate,
    Buffer.from(segments[2], 'base64url'),
  )
  if (!validSignature) throw new Error('The authentication token signature is invalid.')

  const expiresAt = requiredNumber(payload.exp, 'exp')
  const issuedAt = requiredNumber(payload.iat, 'iat')
  const authenticatedAt = requiredNumber(payload.auth_time, 'auth_time')
  if (expiresAt <= nowSeconds) throw new Error('The authentication token has expired.')
  if (issuedAt > nowSeconds + CLOCK_SKEW_SECONDS || authenticatedAt > nowSeconds + CLOCK_SKEW_SECONDS) {
    throw new Error('The authentication token has a future timestamp.')
  }
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('The authentication token belongs to another Firebase project.')
  }
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) {
    throw new Error('The authentication token has an invalid subject.')
  }

  return {
    uid: payload.sub,
    emailVerified: payload.email_verified === true,
    ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
    ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
  }
}

export async function verifyFirebaseIdToken(token: string) {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID
    || process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
  if (!projectId) throw new Error('FIREBASE_ADMIN_PROJECT_ID is required to verify authentication tokens.')
  return verifyFirebaseIdTokenWithCertificates(
    token,
    projectId,
    await loadFirebaseCertificates(),
  )
}
