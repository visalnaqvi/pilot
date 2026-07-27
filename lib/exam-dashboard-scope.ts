export type DashboardExamScope = {
  id: string
  name: string
  createdBy?: string
  organisationIds?: string[]
}

export type DashboardTestScope = {
  examId?: string
  exam?: string
}

export function scopeDashboardExams<T extends DashboardExamScope>(
  exams: T[],
  tests: DashboardTestScope[],
  role: 'admin' | 'organisation' | 'user' | undefined,
  organisationId?: string,
) {
  if (role === 'admin') return exams
  if (role !== 'organisation' || !organisationId) return []

  const testExamIds = new Set(tests.map(test => test.examId).filter((id): id is string => Boolean(id)))
  const legacyTestExamNames = new Set(tests
    .filter(test => !test.examId)
    .map(test => test.exam)
    .filter((name): name is string => Boolean(name)))

  return exams.filter(exam =>
    exam.createdBy === organisationId
    || exam.organisationIds?.includes(organisationId)
    || testExamIds.has(exam.id)
    || legacyTestExamNames.has(exam.name),
  )
}
