export type AssignmentOrganisationFields = {
  organisationId?: unknown
  assignedBy?: unknown
}

/**
 * New assignment batches carry organisationId. Batches created before that
 * field was introduced belong to the institute account that assigned them.
 */
export function assignmentMatchesOrganisation(
  assignment: AssignmentOrganisationFields,
  organisationId: string,
) {
  if (typeof assignment.organisationId === 'string' && assignment.organisationId) {
    return assignment.organisationId === organisationId
  }
  return assignment.assignedBy === organisationId
}
