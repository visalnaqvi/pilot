import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { ExamCycleDetails } from '@/lib/exam-information'
import { canonicalSourceUrl, ExamWebRefreshSchema, type ExamWebRefresh } from './schema'

function client() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for exam refresh.')
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

function model() {
  return process.env.OPENAI_EXAM_REFRESH_MODEL || 'gpt-5.6-terra'
}

export async function requestExamWebRefresh(input: {
  examId: string
  examName: string
  aliases: string[]
  currentCycle: ExamCycleDetails | null
}): Promise<{ document: ExamWebRefresh; consultedUrls: Set<string> }> {
  const response = await client().responses.parse({
    model: model(),
    tools: [{
      type: 'web_search',
      search_context_size: 'high',
      user_location: { type: 'approximate', country: 'IN' },
    }],
    tool_choice: 'required',
    include: ['web_search_call.action.sources'],
    instructions: [
      'Search the live web and return the latest reliable information for the requested examination.',
      'Prefer conducting-authority pages, official notices, application portals, official syllabi, and official pattern documents.',
      'Use reputable secondary education sources only when official information is unavailable, and label them secondary.',
      'Use only information supported by sources consulted in this request; never rely on model memory or construct URLs.',
      'Compare the findings with the current database record supplied by the application.',
      'CRITICAL: For every claim, the sourceUrl MUST be an exact URL string returned by the web_search tool in this request. Do not infer, construct, or cite URLs from memory. If you cannot find a URL in search results for a piece of information, either preserve the current value or mark the section insufficient_evidence.',
      'Return status=unchanged only when the current record remains accurate.',
      'Return status=insufficient_evidence when reliable sources do not support a safe answer or when you cannot find web_search-returned URLs for proposed changes.',
      'Use stable lowercase cycle IDs such as "2026" or "2026-notification".',
      'Use ISO YYYY-MM-DD only for exact dates. Put vague, expected, or unannounced dates in dateText with the correct precision.',
      'For every section, return a complete candidate section, preserving current facts not contradicted or updated by reliable sources.',
      'Every changed scalar, array item, or removal must be covered by a claim with a web_search-returned sourceUrl.',
      'Each claim must use a fieldPath beginning with /overview, /schedule, /eligibility, /pattern, /syllabus, or /resources.',
      'For a newly added or removed array object, cite the array-item root such as /schedule/events/0 or /pattern/stages/0.',
      'For sourceUrl in each claim: copy the exact URL string as returned by the web_search tool. Do not modify, rewrite, or add query parameters. Verify the URL appears in the web_search results before citing it.',
      'If a URL you found in web search results does not appear in the tool output, do not cite it.',
      'Briefly state in the claim field what the cited URL supports.',
      'For a new cycle, use empty arrays and nulls where information has not been announced.',
    ].join(' '),
    input: [
      `Catalog exam ID: ${input.examId}`,
      `Exam: ${input.examName}`,
      `Known aliases: ${input.aliases.join(', ') || 'none'}`,
      'Requested details: overview, notification status, application opening and closing dates, correction window, admit card, exam dates, answer key, results, application method and links, fees, eligibility, exam pattern, syllabus, and official resources.',
      `Current database record:\n${input.currentCycle ? JSON.stringify(input.currentCycle) : 'No published cycle exists.'}`,
    ].join('\n\n'),
    text: { format: zodTextFormat(ExamWebRefreshSchema, 'exam_web_refresh') },
  })
  if (!response.output_parsed) throw new Error('OpenAI returned no structured exam refresh.')

  const consultedUrls = new Set<string>()
  for (const item of response.output) {
    if (item.type === 'web_search_call') {
      const action = item.action
      if (!action) continue
      if (action.type === 'search') {
        for (const source of action.sources || []) consultedUrls.add(canonicalSourceUrl(source.url))
      } else if (action.url) {
        consultedUrls.add(canonicalSourceUrl(action.url))
      }
    }
    if (item.type === 'message') {
      for (const content of item.content) {
        if (content.type !== 'output_text') continue
        for (const annotation of content.annotations) {
          if (annotation.type === 'url_citation') consultedUrls.add(canonicalSourceUrl(annotation.url))
        }
      }
    }
  }
  if (!consultedUrls.size) throw new Error('Web search returned no consulted source URLs.')
  return { document: response.output_parsed, consultedUrls }
}
