type AppUrlEnvironment = {
  [key: string]: string | undefined
  APP_BASE_URL?: string
  VERCEL_PROJECT_PRODUCTION_URL?: string
  VERCEL_URL?: string
}

function normalizeBaseUrl(value: string) {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`
  const url = new URL(candidate)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The public application URL must use HTTP or HTTPS.')
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

export function appBaseUrl(environment: AppUrlEnvironment = process.env) {
  const value = environment.VERCEL_PROJECT_PRODUCTION_URL?.trim()
    || environment.APP_BASE_URL?.trim()
    || environment.VERCEL_URL?.trim()
    || 'http://localhost:3000'
  return normalizeBaseUrl(value)
}
