import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import dotenv from 'dotenv'

const defaultInterval = '15m'
const minimumIntervalMilliseconds = 30_000
const maximumIntervalMilliseconds = 24 * 60 * 60_000
const requestTimeoutMilliseconds = 60_000
const taskEmailCronPath = '/api/cron/task-emails'

export type PollerOptions = {
  help: boolean
  intervalMilliseconds: number
  once: boolean
}

export type PollerConfig = {
  cronSecret: string
  cronUrl: string
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>
type PollResult = 'aborted' | 'failed' | 'success'

type PollerDependencies = {
  error?: (message: string) => void
  fetch?: FetchLike
  log?: (message: string) => void
  now?: () => Date
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
}

export const pollerHelp = `Usage:
  npm run email:poll
  npm run email:poll -- --interval 5m
  npm run email:poll -- --interval=1h
  npm run email:poll -- --once

Options:
  --interval <duration>  Delay between completed polls. Supports s, m, or h.
                         Default: ${defaultInterval}; minimum: 30s; maximum: 24h.
  --once                 Process the queue once, then exit.
  --help                 Show this help.

Environment:
  TASK_EMAIL_CRON_URL       Full production email-queue cron endpoint.
  CRON_SECRET               Secret matching the Vercel environment variable.
  TASK_EMAIL_POLL_INTERVAL  Optional default interval; CLI --interval wins.`

export function parsePollInterval(value: string) {
  const normalized = value.trim().toLowerCase()
  const match = /^([1-9]\d*)(s|m|h)$/.exec(normalized)
  if (!match) {
    throw new Error('The poll interval must be a positive whole number followed by s, m, or h (for example, 30s, 5m, or 1h).')
  }

  const unitMilliseconds = {
    s: 1_000,
    m: 60_000,
    h: 60 * 60_000,
  } as const
  const milliseconds = Number(match[1]) * unitMilliseconds[match[2] as keyof typeof unitMilliseconds]
  if (!Number.isSafeInteger(milliseconds)) {
    throw new Error('The poll interval is too large.')
  }
  if (milliseconds < minimumIntervalMilliseconds || milliseconds > maximumIntervalMilliseconds) {
    throw new Error('The poll interval must be between 30s and 24h.')
  }
  return milliseconds
}

export function formatPollInterval(milliseconds: number) {
  if (milliseconds % (60 * 60_000) === 0) return `${milliseconds / (60 * 60_000)}h`
  if (milliseconds % 60_000 === 0) return `${milliseconds / 60_000}m`
  return `${milliseconds / 1_000}s`
}

export function parsePollerOptions(
  argv: string[],
  environment: Record<string, string | undefined> = process.env,
): PollerOptions {
  let intervalArgument: string | undefined
  let once = false
  let help = false

  function setIntervalArgument(value: string | undefined) {
    if (!value || value.startsWith('--')) {
      throw new Error('Provide a duration after --interval (for example, --interval 5m).')
    }
    if (intervalArgument) {
      throw new Error('Provide --interval only once.')
    }
    intervalArgument = value
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--once') {
      once = true
    } else if (argument === '--help' || argument === '-h') {
      help = true
    } else if (argument === '--interval') {
      setIntervalArgument(argv[index + 1])
      index += 1
    } else if (argument.startsWith('--interval=')) {
      setIntervalArgument(argument.slice('--interval='.length))
    } else {
      throw new Error(`Unknown option: ${argument}`)
    }
  }

  const configuredInterval = environment.TASK_EMAIL_POLL_INTERVAL?.trim()
  return {
    help,
    intervalMilliseconds: parsePollInterval(help ? defaultInterval : intervalArgument || configuredInterval || defaultInterval),
    once,
  }
}

export function resolvePollerConfig(
  environment: Record<string, string | undefined> = process.env,
): PollerConfig {
  const cronUrl = environment.TASK_EMAIL_CRON_URL?.trim()
  const cronSecret = environment.CRON_SECRET?.trim()
  if (!cronUrl) {
    throw new Error('Set TASK_EMAIL_CRON_URL to the production /api/cron/task-emails endpoint.')
  }
  if (!cronSecret) {
    throw new Error('Set CRON_SECRET to the same value configured in Vercel.')
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(cronUrl)
  } catch {
    throw new Error('TASK_EMAIL_CRON_URL must be an absolute URL.')
  }

  const localHttpHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)
  if (parsedUrl.protocol !== 'https:' && !(parsedUrl.protocol === 'http:' && localHttpHost)) {
    throw new Error('TASK_EMAIL_CRON_URL must use HTTPS, except when testing with localhost.')
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new Error('TASK_EMAIL_CRON_URL must not contain credentials, query parameters, or a fragment.')
  }
  if (parsedUrl.pathname.replace(/\/+$/, '') !== taskEmailCronPath) {
    throw new Error(`TASK_EMAIL_CRON_URL must point to ${taskEmailCronPath}.`)
  }

  parsedUrl.pathname = taskEmailCronPath
  return { cronSecret, cronUrl: parsedUrl.toString() }
}

function sanitize(value: string, secret: string) {
  return value
    .replaceAll(secret, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

async function defaultWait(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return
  await new Promise<void>(resolveWait => {
    const timer = setTimeout(finish, milliseconds)
    function finish() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolveWait()
    }
    signal?.addEventListener('abort', finish, { once: true })
  })
}

export async function pollTaskEmailQueue(
  config: PollerConfig,
  signal?: AbortSignal,
  dependencies: PollerDependencies = {},
): Promise<PollResult> {
  const fetchRequest = dependencies.fetch || globalThis.fetch
  const log = dependencies.log || console.log
  const logError = dependencies.error || console.error
  const now = dependencies.now || (() => new Date())
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMilliseconds)])
    : AbortSignal.timeout(requestTimeoutMilliseconds)

  try {
    const response = await fetchRequest(config.cronUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.cronSecret}`,
      },
      signal: requestSignal,
    })
    const body = sanitize(await response.text(), config.cronSecret)
    if (!response.ok) {
      logError(`[${now().toISOString()}] Email queue poll failed: HTTP ${response.status}${body ? ` — ${body}` : ''}`)
      return 'failed'
    }
    log(`[${now().toISOString()}] Task and timetable email queues processed${body ? `: ${body}` : '.'}`)
    return 'success'
  } catch (error) {
    if (signal?.aborted) return 'aborted'
    const message = sanitize(error instanceof Error ? error.message : String(error), config.cronSecret)
    logError(`[${now().toISOString()}] Email queue poll failed: ${message || 'Unknown request error.'}`)
    return 'failed'
  }
}

export async function runTaskEmailPoller(
  options: PollerOptions,
  config: PollerConfig,
  signal?: AbortSignal,
  dependencies: PollerDependencies = {},
) {
  const wait = dependencies.wait || defaultWait
  let attempts = 0
  let failures = 0

  while (!signal?.aborted) {
    const result = await pollTaskEmailQueue(config, signal, dependencies)
    if (result === 'aborted') break
    attempts += 1
    if (result === 'failed') failures += 1
    if (options.once || signal?.aborted) break
    await wait(options.intervalMilliseconds, signal)
  }

  return { attempts, failures }
}

function loadEnvironment() {
  dotenv.config({
    path: [resolve(process.cwd(), '.env.local'), resolve(process.cwd(), '.env')],
    quiet: true,
  })
}

export async function main(argv = process.argv.slice(2)) {
  loadEnvironment()
  const options = parsePollerOptions(argv)
  if (options.help) {
    console.log(pollerHelp)
    return
  }

  const config = resolvePollerConfig()
  const controller = new AbortController()
  const stop = () => {
    if (controller.signal.aborted) return
    console.log('\nStopping email poller…')
    controller.abort()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  try {
    if (!options.once) {
      console.log(`Task and timetable email poller started. Polling every ${formatPollInterval(options.intervalMilliseconds)}; press Ctrl+C to stop.`)
    }
    const result = await runTaskEmailPoller(options, config, controller.signal)
    if (options.once && result.failures) process.exitCode = 1
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === entryPoint) {
  void main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
