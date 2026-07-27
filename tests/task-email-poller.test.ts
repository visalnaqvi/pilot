import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parsePollerOptions,
  parsePollInterval,
  resolvePollerConfig,
  runTaskEmailPoller,
  type PollerConfig,
} from '../scripts/task-email-poller'

const config: PollerConfig = {
  cronSecret: 'test-cron-secret',
  cronUrl: 'https://example.com/api/cron/task-emails',
}

test('poll interval parser accepts supported units and enforces limits', () => {
  assert.equal(parsePollInterval('30s'), 30_000)
  assert.equal(parsePollInterval('5m'), 300_000)
  assert.equal(parsePollInterval('1h'), 3_600_000)
  assert.equal(parsePollInterval('24h'), 86_400_000)
  assert.throws(() => parsePollInterval('29s'), /between 30s and 24h/)
  assert.throws(() => parsePollInterval('25h'), /between 30s and 24h/)
  assert.throws(() => parsePollInterval('5'), /followed by s, m, or h/)
})

test('poller options use a 15-minute default and let the CLI override the environment', () => {
  assert.equal(parsePollerOptions([], {}).intervalMilliseconds, 15 * 60_000)
  assert.equal(
    parsePollerOptions([], { TASK_EMAIL_POLL_INTERVAL: '30m' }).intervalMilliseconds,
    30 * 60_000,
  )
  assert.equal(
    parsePollerOptions(['--interval', '5m'], { TASK_EMAIL_POLL_INTERVAL: '30m' }).intervalMilliseconds,
    5 * 60_000,
  )
  assert.equal(parsePollerOptions(['--interval=1h'], {}).intervalMilliseconds, 60 * 60_000)
  assert.equal(parsePollerOptions(['--once'], {}).once, true)
  assert.equal(parsePollerOptions(['--help'], { TASK_EMAIL_POLL_INTERVAL: 'invalid' }).help, true)
  assert.throws(() => parsePollerOptions(['--interval']), /Provide a duration/)
  assert.throws(() => parsePollerOptions(['--unknown']), /Unknown option/)
})

test('poller configuration requires the protected task-email endpoint', () => {
  assert.deepEqual(resolvePollerConfig({
    TASK_EMAIL_CRON_URL: 'https://example.com/api/cron/task-emails',
    CRON_SECRET: 'test-cron-secret',
  }), config)
  assert.throws(() => resolvePollerConfig({ CRON_SECRET: 'secret' }), /TASK_EMAIL_CRON_URL/)
  assert.throws(() => resolvePollerConfig({
    TASK_EMAIL_CRON_URL: 'http://example.com/api/cron/task-emails',
    CRON_SECRET: 'secret',
  }), /must use HTTPS/)
  assert.throws(() => resolvePollerConfig({
    TASK_EMAIL_CRON_URL: 'https://example.com/api/other',
    CRON_SECRET: 'secret',
  }), /must point to/)
})

test('--once makes one authenticated request without waiting', async () => {
  const requests: Array<{ input: string; init: RequestInit }> = []
  const logs: string[] = []
  const result = await runTaskEmailPoller(
    { help: false, intervalMilliseconds: 15 * 60_000, once: true },
    config,
    undefined,
    {
      fetch: async (input, init) => {
        requests.push({ input, init })
        return new Response('{"jobsProcessed":1}', { status: 200 })
      },
      log: message => logs.push(message),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      wait: async () => {
        throw new Error('Once mode must not wait.')
      },
    },
  )

  assert.deepEqual(result, { attempts: 1, failures: 0 })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].input, config.cronUrl)
  assert.equal(new Headers(requests[0].init.headers).get('authorization'), `Bearer ${config.cronSecret}`)
  assert.match(logs[0], /jobsProcessed/)
})

test('continuous polling starts immediately, survives failures, and stops without overlap', async () => {
  const controller = new AbortController()
  const events: string[] = []
  const errors: string[] = []
  let requestCount = 0
  const result = await runTaskEmailPoller(
    { help: false, intervalMilliseconds: 5 * 60_000, once: false },
    config,
    controller.signal,
    {
      fetch: async () => {
        requestCount += 1
        events.push(`request-${requestCount}`)
        return requestCount === 1
          ? new Response(`temporary failure ${config.cronSecret}`, { status: 503 })
          : new Response('{"jobsProcessed":0}', { status: 200 })
      },
      error: message => errors.push(message),
      log: message => events.push(message),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      wait: async milliseconds => {
        events.push(`wait-${milliseconds}`)
        if (requestCount === 2) controller.abort()
      },
    },
  )

  assert.deepEqual(result, { attempts: 2, failures: 1 })
  assert.equal(requestCount, 2)
  assert.equal(events[0], 'request-1')
  assert.equal(events.filter(event => event.startsWith('wait-')).length, 2)
  assert.match(errors[0], /HTTP 503/)
  assert.doesNotMatch(errors[0], new RegExp(config.cronSecret))
  assert.match(errors[0], /\[redacted\]/)
})
