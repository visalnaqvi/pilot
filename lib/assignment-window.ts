type TimestampLike = {
  toDate: () => Date
}

export type AssignmentWindow = {
  startAt?: TimestampLike
  deadline?: TimestampLike
  attemptsUsed?: number
  maxAttempts?: number
}

export function isAssignmentWindowOpen(assignment: AssignmentWindow, now = Date.now()) {
  const startAt = assignment.startAt?.toDate().getTime() ?? 0
  const deadline = assignment.deadline?.toDate().getTime()
  const attemptsUsed = assignment.attemptsUsed ?? 0
  const maxAttempts = assignment.maxAttempts ?? 1

  return deadline !== undefined
    && startAt <= now
    && deadline >= now
    && attemptsUsed < maxAttempts
}
