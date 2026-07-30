export type MemberRole = 'student' | 'teacher'

export function memberRole(value: unknown): MemberRole {
  return value === 'teacher' ? 'teacher' : 'student'
}

export function isAcceptedMember(
  value: { status?: unknown; memberRole?: unknown } | undefined,
  expectedRole?: MemberRole,
) {
  if (value?.status !== 'accepted') return false
  return expectedRole ? memberRole(value.memberRole) === expectedRole : true
}
