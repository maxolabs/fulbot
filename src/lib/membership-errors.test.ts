import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLastAdminOfGroupError, isRemovedByAdminError } from './membership-errors'

// PostgREST returns the RAISE message as `message` and the DETAIL as `details`.

test('removed_by_admin from join_group_via_invite is recognised', () => {
  assert.equal(isRemovedByAdminError({ message: 'removed_by_admin', details: 'Un admin te sacó de este grupo' }), true)
})

test('other join errors are not a removal', () => {
  assert.equal(isRemovedByAdminError({ message: 'Invalid invite code', details: null }), false)
  assert.equal(isRemovedByAdminError(null), false)
  assert.equal(isRemovedByAdminError(new Error('Failed to fetch')), false)
})

test('last_admin_of_group from delete_my_account is recognised', () => {
  assert.equal(isLastAdminOfGroupError({ message: 'last_admin_of_group', details: 'Fútbol Lunes' }), true)
  assert.equal(isLastAdminOfGroupError({ message: 'last_admin', details: '' }), false)
})
