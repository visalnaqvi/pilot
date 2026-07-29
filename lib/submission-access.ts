type SubmissionAccessActor = {
  uid: string
  role: string
}

type SubmissionAccessData = {
  userId?: unknown
  gradingOwnerId?: unknown
  organisationIds?: unknown
}

export function resolveSubmissionAccess(
  actor: SubmissionAccessActor,
  submission: SubmissionAccessData,
) {
  const organisationIds = Array.isArray(submission.organisationIds)
    ? submission.organisationIds.filter((value): value is string => typeof value === 'string')
    : []
  const ownsTest = actor.role === 'organisation'
    && submission.gradingOwnerId === actor.uid
  const reviewer = actor.role === 'admin' || ownsTest
  const organisationViewer = actor.role === 'organisation'
    && organisationIds.includes(actor.uid)

  return {
    reviewer,
    canView: submission.userId === actor.uid || reviewer || organisationViewer,
  }
}
