import { Option, Schema } from 'effect'
import { expect, test } from 'vitest'

import { FetchFailure } from '../../api.ts'
import { PlaylistId } from '../../playlist.ts'
import {
  Account,
  claimBatches,
  listPlaylist,
  listedOf,
  loginFailureOfSearch,
  noAccountOf,
  reachablePlaylists,
  renameListed,
  unclaimedTokens,
  unlistPlaylist,
} from './account.ts'
import { EditToken, type Owned } from './playlists.ts'

const id = (value: string) => Schema.decodeSync(PlaylistId)(value)
const token = (value: string) => Schema.decodeSync(EditToken)(value)
const owned = (value: string): Owned => ({
  id: id(value),
  name: `name ${value}`,
  editToken: token(`token-${value}`),
})
const connected = (...ids: ReadonlyArray<string>) =>
  Account.Connected({
    name: 'Fan',
    playlists: ids.map(value => ({ id: id(value), name: `name ${value}` })),
  })

test('only a 401 is "no account here"; a 503, a 404 or a dead network hides login', () => {
  expect(noAccountOf(FetchFailure.Rejected({ status: 401 }))).toBe('SignedOut')
  for (const status of [503, 404, 500]) {
    expect(noAccountOf(FetchFailure.Rejected({ status }))).toBe('Unavailable')
  }
  expect(noAccountOf(FetchFailure.Unreachable())).toBe('Unavailable')
  expect(noAccountOf(FetchFailure.Unreadable())).toBe('Unavailable')
})

test('the login reason comes only from the three the server sends', () => {
  expect(loginFailureOfSearch('?login=refused')).toEqual(Option.some('refused'))
  expect(loginFailureOfSearch('?v=x&login=limit')).toEqual(Option.some('limit'))
  expect(loginFailureOfSearch('?login=<img>')).toEqual(Option.none())
  expect(loginFailureOfSearch('')).toEqual(Option.none())
})

test('deleted playlists in the account list are dropped', () => {
  expect(
    listedOf({
      playlists: [
        { id: id('AAAAAAAA'), name: 'a', deleted: false },
        { id: id('BBBBBBBB'), name: 'b', deleted: true },
      ],
    }),
  ).toEqual([{ id: id('AAAAAAAA'), name: 'a' }])
})

test('listing, renaming and unlisting touch only a connected account', () => {
  const entry = { id: id('CCCCCCCC'), name: 'c' }
  const base = connected('AAAAAAAA')
  expect(listPlaylist(base, entry)).toEqual(
    Account.Connected({
      name: 'Fan',
      playlists: [{ id: id('AAAAAAAA'), name: 'name AAAAAAAA' }, entry],
    }),
  )
  expect(renameListed(base, id('AAAAAAAA'), 'new')).toEqual(
    Account.Connected({
      name: 'Fan',
      playlists: [{ id: id('AAAAAAAA'), name: 'new' }],
    }),
  )
  expect(unlistPlaylist(base, id('AAAAAAAA'))).toEqual(connected())
  const signedOut = Account.SignedOut()
  expect(listPlaylist(signedOut, entry)).toBe(signedOut)
  expect(unlistPlaylist(signedOut, entry.id)).toBe(signedOut)
})

test('a browser reaches its tokens and the account playlists once each', () => {
  const reached = reachablePlaylists(connected('AAAAAAAA', 'BBBBBBBB'), [
    owned('BBBBBBBB'),
    owned('CCCCCCCC'),
  ])
  expect(reached.map(entry => entry.id)).toEqual([
    'AAAAAAAA',
    'BBBBBBBB',
    'CCCCCCCC',
  ])
  expect(
    reachablePlaylists(Account.SignedOut(), [owned('CCCCCCCC')]).map(
      entry => entry.id,
    ),
  ).toEqual(['CCCCCCCC'])
})

test('only tokens of playlists the account lacks are claimed', () => {
  const listed = [{ id: id('AAAAAAAA'), name: 'a' }]
  expect(
    unclaimedTokens([owned('AAAAAAAA'), owned('BBBBBBBB')], listed),
  ).toEqual(['token-BBBBBBBB'])
  expect(unclaimedTokens([owned('AAAAAAAA')], listed)).toEqual([])
})

test('claims go out at most 100 tokens at a time', () => {
  const tokens = Array.from({ length: 250 }, (_, index) => `t${index}`)
  expect(claimBatches(tokens).map(batch => batch.length)).toEqual([
    100, 100, 50,
  ])
  expect(claimBatches([])).toEqual([])
})
