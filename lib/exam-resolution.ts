import 'server-only'

import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import {
  EXAM_CATALOG_NAMING_INSTRUCTION,
  prepareExamCatalogProposal,
  type ExamCatalogSuggestion,
} from '@/lib/exam-catalog'

const ExamCatalogSuggestionSchema = z.object({
  recognized: z.boolean(),
  canonicalName: z.string().trim().min(2).max(120),
  primaryAlias: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(2).max(120)).max(12),
})

export async function suggestExamCatalogEntry(searchName: string) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OpenAI is not configured.')
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const response = await client.responses.create({
    model: process.env.OPENAI_EXAM_RESOLUTION_MODEL
      || process.env.OPENAI_MODEL
      || 'gpt-5.6-luna',
    reasoning: { effort: 'low' },
    max_output_tokens: 600,
    instructions: [
      'Resolve a user-entered exam name or acronym into a clean exam catalog entry.',
      'Use your knowledge of educational, entrance, recruitment, certification, and eligibility exams.',
      EXAM_CATALOG_NAMING_INSTRUCTION,
      'When the input is a recognized acronym such as CTET, expand it to the official full exam name and preserve the acronym as the primary alias.',
      'Use the stable exam name only. Do not invent a year, session, paper, level, region, or conducting body unless it is essential to distinguish the exam or appears in the input.',
      'Include common spelling, punctuation, abbreviation, and expanded-name variants as aliases.',
      'Set recognized to false when the input does not confidently identify a known official exam, but still provide the best catalog-ready canonical name and concise aliases.',
      'Return only the structured result.',
    ].join(' '),
    input: [{
      role: 'user',
      content: [{ type: 'input_text', text: `Exam search: ${searchName.trim()}` }],
    }],
    text: { format: zodTextFormat(ExamCatalogSuggestionSchema, 'exam_catalog_suggestion') },
  })
  const suggestion = ExamCatalogSuggestionSchema.parse(
    JSON.parse(response.output_text),
  ) as ExamCatalogSuggestion
  return {
    ...prepareExamCatalogProposal(searchName, suggestion),
    recognized: suggestion.recognized,
  }
}
