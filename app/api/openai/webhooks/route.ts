import OpenAI from 'openai'
import { eq } from 'drizzle-orm'
import { openaiWebhookEvents } from '@/db/schema'
import { database } from '@/lib/db'
import { processGenerationResponse } from '@/lib/test-generation/service'

export async function POST(request: Request) {
  let event: Awaited<ReturnType<OpenAI['webhooks']['unwrap']>>
  try {
    const secret = process.env.OPENAI_WEBHOOK_SECRET
    if (!secret || !process.env.OPENAI_API_KEY) return Response.json({ error: 'Webhook is not configured.' }, { status: 503 })
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    event = await client.webhooks.unwrap(await request.text(), request.headers, secret)
  } catch (error) {
    console.error('OpenAI webhook rejected:', error)
    return Response.json({ error: 'Invalid webhook.' }, { status: 400 })
  }

  const responseId = 'id' in event.data && typeof event.data.id === 'string' ? event.data.id : event.id
  try {
    const db = database()
    await db.insert(openaiWebhookEvents).values({
      id: event.id,
      responseId,
      type: event.type,
    }).onConflictDoNothing()
    const stored = (await db.select().from(openaiWebhookEvents).where(eq(openaiWebhookEvents.id, event.id)).limit(1))[0]
    if (stored?.processedAt) return Response.json({ received: true, duplicate: true })

    if (event.type === 'response.completed'
      || event.type === 'response.failed'
      || event.type === 'response.incomplete'
      || event.type === 'response.cancelled') {
      await processGenerationResponse(responseId)
    }
    await db.update(openaiWebhookEvents).set({
      processedAt: new Date(),
      error: null,
    }).where(eq(openaiWebhookEvents.id, event.id))
    return Response.json({ received: true })
  } catch (error) {
    await database().update(openaiWebhookEvents).set({
      error: sanitizeWebhookError(error),
    }).where(eq(openaiWebhookEvents.id, event.id)).catch(() => null)
    console.error('OpenAI webhook processing failed:', error)
    return Response.json({ error: 'Webhook processing failed.' }, { status: 500 })
  }
}

function sanitizeWebhookError(error: unknown) {
  return (error instanceof Error ? error.message : 'Webhook processing failed.')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .slice(0, 1000)
}
