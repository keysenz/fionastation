import { expect, test } from 'vitest'

import { FetchFailure } from '../../api.ts'
import { playlistFailureOf } from './playlistOpen.ts'

test('a 410 means the playlist was deleted and a 404 means it never existed', () => {
  expect(playlistFailureOf(FetchFailure.Rejected({ status: 410 }))).toBe(
    'Deleted',
  )
  expect(playlistFailureOf(FetchFailure.Rejected({ status: 404 }))).toBe(
    'NotFound',
  )
})

test('any other failure leaves the link worth retrying', () => {
  expect(playlistFailureOf(FetchFailure.Rejected({ status: 503 }))).toBe(
    'Unreachable',
  )
  expect(playlistFailureOf(FetchFailure.Unreachable())).toBe('Unreachable')
  expect(playlistFailureOf(FetchFailure.Unreadable())).toBe('Unreachable')
})
