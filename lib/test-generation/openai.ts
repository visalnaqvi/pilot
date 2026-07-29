import 'server-only'

import OpenAI, { toFile } from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { Response } from 'openai/resources/responses/responses'
import { adminStorage } from '@/lib/firebase-admin'
import {
  GeneratedMcqTestSchema,
  GenerationConfigSchema,
  isImageSource,
  SourceAnalysisSchema,
  type GeneratedQuestion,
  type GenerationConfig,
  type SourceUpload,
  VerificationSchema,
} from './schema'

const FILE_EXPIRY_SECONDS = 24 * 60 * 60

export type OpenAIFileReference = {
  sourceId: string
  filename: string
  mimeType: string
  fileId: string
}

function client() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for AI test generation.')
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

export function generationModel() {
  return process.env.OPENAI_TEST_GENERATION_MODEL || 'gpt-5.6-terra'
}

export async function uploadSourcesToOpenAI(sources: SourceUpload[]) {
  const bucket = adminStorage.bucket()
  const uploaded: OpenAIFileReference[] = []
  try {
    for (const source of sources) {
      const [buffer] = await bucket.file(source.path).download()
      const result = await client().files.create({
        file: await toFile(buffer, source.name, { type: source.mimeType }),
        purpose: isImageSource(source.mimeType) ? 'vision' : 'user_data',
        expires_after: { anchor: 'created_at', seconds: FILE_EXPIRY_SECONDS },
      })
      uploaded.push({
        sourceId: source.id,
        filename: source.name,
        mimeType: source.mimeType,
        fileId: result.id,
      })
    }
    return uploaded
  } catch (error) {
    await deleteOpenAIFiles(uploaded)
    throw error
  }
}

function sourceContent(files: OpenAIFileReference[]) {
  return files.map(file => isImageSource(file.mimeType)
    ? {
        type: 'input_image' as const,
        file_id: file.fileId,
        detail: 'original' as const,
      }
    : {
        type: 'input_file' as const,
        file_id: file.fileId,
        detail: file.mimeType === 'application/pdf' ? 'high' as const : 'auto' as const,
      })
}

function metadata(jobId: string, stage: 'analysis' | 'generation' | 'verification') {
  return { test_generation_job_id: jobId, test_generation_stage: stage }
}

export async function startAnalysisResponse(jobId: string, files: OpenAIFileReference[]) {
  return client().responses.create({
    model: generationModel(),
    background: true,
    metadata: metadata(jobId, 'analysis'),
    instructions: [
      'Analyse the uploaded educational material without using web search or outside sources.',
      'Determine whether it contains notes, a question paper, both, or insufficient material.',
      'Identify the language, subject, important topics, and any OCR or source-quality warnings.',
      'Rank topics by exam importance using emphasis, repetition, headings, and existing questions in the source.',
      'Every topic must cite at least one uploaded source using its supplied source ID and exact filename.',
      'For PDFs use page numbers when possible. For images use image/region labels. For documents use a heading, paragraph, or section locator.',
      'Use short verbatim excerpts only to help the reviewer locate the evidence.',
      'Do not generate test questions during this stage.',
    ].join(' '),
    input: [{
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: [
            'Analyse these files for mock-test creation.',
            'Available source identifiers:',
            ...files.map(file => `- ${file.sourceId}: ${file.filename}`),
          ].join('\n'),
        },
        ...sourceContent(files),
      ],
    }],
    text: { format: zodTextFormat(SourceAnalysisSchema, 'test_source_analysis') },
  })
}

export async function startGenerationResponse(input: {
  jobId: string
  files: OpenAIFileReference[]
  config: GenerationConfig
}) {
  const config = GenerationConfigSchema.parse(input.config)
  return client().responses.create({
    model: generationModel(),
    background: true,
    metadata: metadata(input.jobId, 'generation'),
    instructions: [
      'Create a rigorous mock test grounded in the uploaded educational material.',
      'Do not use web search. Questions must cover only the selected topics.',
      'Prioritize important concepts, avoid trivia, avoid duplicate or paraphrased questions, and use the requested language.',
      'When the source is a question paper, preserve useful question intent but do not blindly duplicate broken or incomplete wording.',
      'When an answer is explicit in the source, set answerOrigin=source_supported.',
      'When the question is grounded in the source but the answer must be solved or inferred, set answerOrigin=model_inferred.',
      `Return exactly ${config.mcqCount} questions, and make every question an MCQ. Do not create short-answer questions.`,
      'Each MCQ must have exactly four distinct plausible options and exactly one correct answer.',
      'Every question must cite one or more source references using supplied source IDs and exact filenames.',
      'Use stable IDs q-001, q-002, and so on.',
    ].join(' '),
    input: [{
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: [
            `Configuration: ${JSON.stringify(config)}`,
            'Available source identifiers:',
            ...input.files.map(file => `- ${file.sourceId}: ${file.filename}`),
          ].join('\n'),
        },
        ...sourceContent(input.files),
      ],
    }],
    text: { format: zodTextFormat(GeneratedMcqTestSchema, 'generated_mock_test') },
  })
}

export async function startVerificationResponse(input: {
  jobId: string
  files: OpenAIFileReference[]
  questions: GeneratedQuestion[]
}) {
  return client().responses.create({
    model: generationModel(),
    background: true,
    metadata: metadata(input.jobId, 'verification'),
    instructions: [
      'Independently verify every generated educational question against the uploaded material.',
      'Check source grounding, answer correctness, option uniqueness, ambiguity, duplicates, and language quality.',
      'Use supported only when both the question and answer are explicitly supported.',
      'Use answer_inferred when the question is grounded but the answer requires model reasoning or domain knowledge.',
      'Use unsupported when the question is not grounded, the answer is likely wrong, the wording is ambiguous, options duplicate, or the rubric is unusable.',
      'List concise actionable issues and a suggested fix. Do not silently rewrite the questions.',
      'Return exactly one verification item for every supplied question ID.',
    ].join(' '),
    input: [{
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: [
            `Questions to verify: ${JSON.stringify(input.questions)}`,
            'Available source identifiers:',
            ...input.files.map(file => `- ${file.sourceId}: ${file.filename}`),
          ].join('\n'),
        },
        ...sourceContent(input.files),
      ],
    }],
    text: { format: zodTextFormat(VerificationSchema, 'mock_test_verification') },
  })
}

export async function retrieveResponse(responseId: string) {
  return client().responses.retrieve(responseId)
}

export async function cancelResponse(responseId: string) {
  try {
    return await client().responses.cancel(responseId)
  } catch {
    return null
  }
}

export async function deleteOpenAIFiles(files: OpenAIFileReference[]) {
  await Promise.allSettled(files.map(file => client().files.delete(file.fileId)))
}

export function responseUsage(response: Response) {
  return response.usage
    ? {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
      }
    : null
}

export function parseAnalysisResponse(response: Response) {
  return SourceAnalysisSchema.parse(JSON.parse(response.output_text))
}

export function parseGenerationResponse(response: Response) {
  return GeneratedMcqTestSchema.parse(JSON.parse(response.output_text))
}

export function parseVerificationResponse(response: Response) {
  return VerificationSchema.parse(JSON.parse(response.output_text))
}

export function openAIWebhook() {
  const secret = process.env.OPENAI_WEBHOOK_SECRET
  if (!secret) throw new Error('OPENAI_WEBHOOK_SECRET is required to receive OpenAI webhooks.')
  return { client: client(), secret }
}
