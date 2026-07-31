export type MemberRole = 'student' | 'teacher'
export type OrganizationMembershipRole = 'owner' | MemberRole

export function memberRole(value: unknown): MemberRole | null {
  if (value === 'owner') return null
  return value === 'teacher' ? 'teacher' : 'student'
}

export function isAcceptedMember(
  value: { status?: unknown; memberRole?: unknown } | undefined,
  expectedRole?: MemberRole,
) {
  if (value?.status !== 'accepted') return false
  return expectedRole ? memberRole(value.memberRole) === expectedRole : true
}
