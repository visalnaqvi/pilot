type TimestampLike = {
  toDate: () => Date
}

export type AssignmentWindow = {
  startAt?: TimestampLike
  endAt?: TimestampLike
  deadline?: TimestampLike
  attemptsUsed?: number
  maxAttempts?: number
}

export type AssignmentWindowStatus = 'open' | 'not_started' | 'ended' | 'attempts_exhausted' | 'invalid'

export function assignmentWindowStatus(assignment: AssignmentWindow, now = Date.now()): AssignmentWindowStatus {
  const startAt = assignment.startAt?.toDate().getTime() ?? 0
  const deadline = (assignment.endAt || assignment.deadline)?.toDate().getTime()
  const attemptsUsed = assignment.attemptsUsed ?? 0
  const maxAttempts = assignment.maxAttempts ?? 1

  if (deadline === undefined) return 'invalid'
  if (startAt > now) return 'not_started'
  if (deadline < now) return 'ended'
  if (attemptsUsed >= maxAttempts) return 'attempts_exhausted'
  return 'open'
}

export function isAssignmentWindowOpen(assignment: AssignmentWindow, now = Date.now()) {
  return assignmentWindowStatus(assignment, now) === 'open'
}
