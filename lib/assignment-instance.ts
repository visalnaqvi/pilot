export type AssignmentInstanceCandidate = {
  assignmentBatchId: string
  startAt: Date
  deadline: Date
  attemptsUsed: number
  maxAttempts: number
}

export function assignmentInstanceId(assignmentBatchId: string, userId: string) {
  return `${assignmentBatchId}_${userId}`
}

function priority(candidate: AssignmentInstanceCandidate, now: number) {
  if (candidate.startAt.getTime() <= now
    && candidate.deadline.getTime() >= now
    && candidate.attemptsUsed < candidate.maxAttempts) return 0
  if (candidate.startAt.getTime() > now) return 1
  if (candidate.deadline.getTime() >= now) return 2
  return 3
}

export function selectAssignmentInstance<T extends AssignmentInstanceCandidate>(
  candidates: T[],
  now = Date.now(),
) {
  return candidates.slice().sort((left, right) => {
    const priorityDifference = priority(left, now) - priority(right, now)
    if (priorityDifference) return priorityDifference
    if (priority(left, now) === 1) {
      return left.startAt.getTime() - right.startAt.getTime()
    }
    return right.deadline.getTime() - left.deadline.getTime()
  })[0] || null
}
