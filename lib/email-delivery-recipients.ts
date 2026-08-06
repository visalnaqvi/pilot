export type EmailDeliveryRecipient = {
  id: string | null
  email: string
  name: string
}

export function organizationNotificationRecipients(organization?: {
  name: string
  notificationEmails: string[]
}): EmailDeliveryRecipient[] {
  return (organization?.notificationEmails || []).map(email => ({
    id: null,
    email,
    name: organization?.name || 'Institute',
  }))
}

export function studentNotificationRecipients(student: {
  id: string
  name: string
}, notificationEmails: string[]): EmailDeliveryRecipient[] {
  return notificationEmails.map(email => ({
    id: student.id,
    email,
    name: student.name,
  }))
}

export function uniqueByRecipientEmail<T extends { recipient: { email: string } }>(deliveries: T[]) {
  const byEmail = new Map<string, T>()
  for (const delivery of deliveries) {
    const key = delivery.recipient.email.trim().toLowerCase()
    if (key && !byEmail.has(key)) byEmail.set(key, delivery)
  }
  return [...byEmail.values()]
}
