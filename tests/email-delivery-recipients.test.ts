import assert from 'node:assert/strict'
import test from 'node:test'
import {
  organizationNotificationRecipients,
  uniqueByRecipientEmail,
} from '../lib/email-delivery-recipients'

test('organization notification addresses become non-user email recipients', () => {
  assert.deepEqual(organizationNotificationRecipients({
    name: 'Example Institute',
    notificationEmails: ['office@example.com', 'admin@example.com'],
  }), [
    { id: null, email: 'office@example.com', name: 'Example Institute' },
    { id: null, email: 'admin@example.com', name: 'Example Institute' },
  ])
})

test('email deliveries are de-duplicated case-insensitively', () => {
  const deliveries = uniqueByRecipientEmail([
    { recipient: { email: 'Student@Example.com' }, source: 'student' },
    { recipient: { email: ' student@example.com ' }, source: 'notification' },
    { recipient: { email: 'office@example.com' }, source: 'notification' },
  ])
  assert.deepEqual(deliveries.map(item => item.source), ['student', 'notification'])
})
