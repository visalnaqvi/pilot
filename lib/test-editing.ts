export type TestEditingState = {
  origin?: string | null
  published?: boolean
}

export function shouldUseStandardTestEditor(test: TestEditingState) {
  return test.origin !== 'ai_generated' || test.published === true
}
