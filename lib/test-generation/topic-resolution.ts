import 'server-only'

import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import {
  TopicResolutionSchema,
  type TopicResolution,
} from '@/lib/test-generation/schema'

export async function resolveExamTopic(
  examName: string,
  examAliases: string[],
  requestedTopic: string,
): Promise<TopicResolution> {
  if (!process.env.OPENAI_API_KEY) throw new Error('OpenAI is not configured.')
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const response = await client.responses.create({
    model: process.env.OPENAI_TOPIC_RESOLUTION_MODEL
      || process.env.OPENAI_EXAM_RESOLUTION_MODEL
      || process.env.OPENAI_MODEL
      || 'gpt-5.6-luna',
    reasoning: { effort: 'low' },
    max_output_tokens: 900,
    instructions: [
      'Determine whether a user-entered study topic is specific and recognizable enough to generate a mock test for the selected exam.',
      'Use only your existing model knowledge. Do not use web search and do not claim that the current official syllabus was checked.',
      'Return recognized only when the topic has a coherent educational meaning and a reasonable relationship to the selected exam.',
      'Return needs_clarification when the wording is ambiguous, overly broad, abbreviated in multiple ways, or could refer to different subjects.',
      'Return unsupported when the text is not an educational topic, has no reasonable relationship to the exam, or cannot be identified reliably.',
      'For recognized topics, provide a concise canonicalTopic, its broad subject, a short scope summary, and an affirmative message.',
      'For needs_clarification, leave canonicalTopic and subject empty and provide two to five concise topic rewrites the user can select.',
      'For unsupported, leave canonicalTopic and subject empty; suggestions may be empty or contain safer related topics when appropriate.',
      'Never invent a syllabus code, paper, year, exam authority, or official coverage claim.',
      'Return only the structured result.',
    ].join(' '),
    input: [{
      role: 'user',
      content: [{
        type: 'input_text',
        text: [
          `Selected exam: ${examName}`,
          examAliases.length ? `Known exam aliases: ${examAliases.join(', ')}` : '',
          `Requested topic: ${requestedTopic}`,
        ].filter(Boolean).join('\n'),
      }],
    }],
    text: { format: zodTextFormat(TopicResolutionSchema, 'exam_topic_resolution') },
  })
  return TopicResolutionSchema.parse(JSON.parse(response.output_text))
}
