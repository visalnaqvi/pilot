import 'server-only'

import { adminDb } from './firebase-admin'

export type ResolvedAssignee = {
  userId: string
  userName: string
  userEmail: string
}

type MemberData = {
  userId?: string
  userName?: string
  userEmail?: string
}

function unique(values: string[]) {
  return [...new Set(values)]
}

async function userProfiles(userIds: string[]) {
  const ids = unique(userIds)
  if (!ids.length) return new Map<string, FirebaseFirestore.DocumentData>()
  const snapshots = await adminDb.getAll(...ids.map(id => adminDb.collection('users').doc(id)))
  return new Map(snapshots
    .filter(snapshot => snapshot.exists)
    .map(snapshot => [snapshot.id, snapshot.data()!]))
}

async function assertAcceptedMembers(organisationId: string, userIds: string[]) {
  const ids = unique(userIds)
  if (!ids.length) return
  const invitations = await adminDb.getAll(...ids.map(userId => (
    adminDb.collection('organisationInvites').doc(`${organisationId}_${userId}`)
  )))
  if (invitations.some(invitation => !invitation.exists || invitation.data()?.status !== 'accepted')) {
    throw new Error('Every selected assignee must be an accepted member of your institute.')
  }
}

export async function resolveOrganisationTaskAudience(input: {
  organisationId: string
  selectedUserIds: string[]
  selectedGroupIds: string[]
}) {
  const selectedGroups = await Promise.all(unique(input.selectedGroupIds).map(async groupId => {
    const group = await adminDb.collection('organisationGroups').doc(groupId).get()
    if (!group.exists || group.data()?.organisationId !== input.organisationId) {
      throw new Error('One or more selected groups do not belong to your institute.')
    }
    const members = await group.ref.collection('members').get()
    return {
      id: group.id,
      name: String(group.data()?.name || 'Group'),
      members: members.docs.map(document => document.data() as MemberData),
    }
  }))

  const groupMemberIds = selectedGroups.flatMap(group => group.members
    .map(member => member.userId)
    .filter((value): value is string => Boolean(value)))
  const allUserIds = unique([...input.selectedUserIds, ...groupMemberIds])
  if (!allUserIds.length) throw new Error('Select at least one assigned user or group.')

  await assertAcceptedMembers(input.organisationId, allUserIds)
  const profiles = await userProfiles(allUserIds)
  const assignees = allUserIds.map(userId => {
    const profile = profiles.get(userId)
    if (!profile || profile.role !== 'user' || typeof profile.email !== 'string') {
      throw new Error('One or more selected assignees is not a valid user account.')
    }
    const member = selectedGroups.flatMap(group => group.members).find(item => item.userId === userId)
    return {
      userId,
      userName: String(profile.name || member?.userName || profile.email),
      userEmail: String(profile.email),
    }
  })
  const groupedIds = new Set(groupMemberIds)
  const directNames = assignees
    .filter(assignee => input.selectedUserIds.includes(assignee.userId) && !groupedIds.has(assignee.userId))
    .map(assignee => assignee.userName)

  return {
    assignees,
    groupIds: selectedGroups.map(group => group.id),
    audienceNames: [...selectedGroups.map(group => group.name), ...directNames],
  }
}

export async function resolveAssignmentAudience(input: {
  actorId: string
  actorRole: 'organisation' | 'admin'
  targetType: 'group' | 'user'
  targetId: string
}) {
  let audienceName = ''
  let userIds: string[] = []
  if (input.targetType === 'group') {
    const group = await adminDb.collection('organisationGroups').doc(input.targetId).get()
    if (!group.exists) throw new Error('The selected group does not exist.')
    if (input.actorRole === 'organisation' && group.data()?.organisationId !== input.actorId) {
      throw new Error('The selected group does not belong to your institute.')
    }
    const members = await group.ref.collection('members').get()
    userIds = members.docs
      .map(document => document.data().userId)
      .filter((value): value is string => typeof value === 'string')
    audienceName = String(group.data()?.name || 'Group')
  } else {
    userIds = [input.targetId]
  }
  userIds = unique(userIds)
  if (!userIds.length) throw new Error('The selected audience has no users.')
  if (input.actorRole === 'organisation') await assertAcceptedMembers(input.actorId, userIds)
  const profiles = await userProfiles(userIds)
  const assignees = userIds.map(userId => {
    const profile = profiles.get(userId)
    if (!profile || profile.role !== 'user' || typeof profile.email !== 'string') {
      throw new Error('One or more selected assignees is not a valid user account.')
    }
    return {
      userId,
      userName: String(profile.name || profile.email),
      userEmail: String(profile.email),
    }
  })
  if (input.targetType === 'user') audienceName = assignees[0].userName
  return { assignees, audienceName }
}

