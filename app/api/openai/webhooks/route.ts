import { openAIWebhook } from '@/lib/test-generation/openai'
import { processGenerationResponse } from '@/lib/test-generation/service'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const payload = await request.text()
    const { client, secret } = openAIWebhook()
    const event = await client.webhooks.unwrap(payload, request.headers, secret)
    if (event.type === 'response.completed'
      || event.type === 'response.failed'
      || event.type === 'response.incomplete'
      || event.type === 'response.cancelled') {
      await processGenerationResponse(event.data.id)
    }
    return Response.json({ received: true })
  } catch (error) {
    console.error('OpenAI webhook rejected:', error)
    return Response.json({ error: 'Invalid webhook.' }, { status: 400 })
  }
}
