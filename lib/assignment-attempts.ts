export type AssignmentAttemptScope = {
  id: string
  testId: string
  assignedUserIds: string[]
}

export type AssignmentScopedSubmission = {
  testId: string
  userId: string
  assignmentBatchId?: string
  testVisibility?: 'public' | 'private' | 'assigned'
}

/**
 * Assignment reports must use the immutable batch ID written on an assigned
 * submission. Test/user/date matching is ambiguous when a test changes between
 * public, private, and assigned access modes.
 */
export function attemptsForAssignment<T extends AssignmentScopedSubmission>(
  assignment: AssignmentAttemptScope,
  submissions: T[],
) {
  const assignedUsers = new Set(assignment.assignedUserIds)
  return submissions.filter((submission) =>
    submission.assignmentBatchId === assignment.id
    && submission.testVisibility === 'assigned'
    && submission.testId === assignment.testId
    && assignedUsers.has(submission.userId))
}
