import assert from 'node:assert/strict'
import test from 'node:test'
import { profileDisplayName } from '../lib/profile-display-name'

test('student profiles keep the user name when they belong to an organization', () => {
  assert.equal(profileDisplayName('user', 'Navneet', 'Padae Partner'), 'Navneet')
})

test('organization profiles use the organization name', () => {
  assert.equal(profileDisplayName('organisation', 'Navneet', 'Padae Partner'), 'Padae Partner')
})

test('organization profiles fall back to the user name', () => {
  assert.equal(profileDisplayName('organisation', 'Navneet'), 'Navneet')
})
