export type ProfileRole = 'user' | 'organisation' | 'admin'

export function profileDisplayName(
  role: ProfileRole,
  userName: string,
  organizationName?: string | null,
) {
  return role === 'organisation' ? organizationName || userName : userName
}
