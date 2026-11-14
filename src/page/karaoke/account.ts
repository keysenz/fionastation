import { Array, Option, Record, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import type { FetchFailure } from '../../api.ts'
import { PlaylistId } from '../../playlist.ts'
import type { Owned } from './playlists.ts'

export const MAX_CLAIM_TOKENS = 100

export const Listed = Schema.Struct({ id: PlaylistId, name: Schema.String })
export type Listed = typeof Listed.Type

export const Account = defineTaggedUnion({
  Loading: {},
  Unavailable: {},
  SignedOut: {},
  Connected: { name: Schema.String, playlists: Schema.Array(Listed) },
})
export type Account = typeof Account.Type

export const NoAccount = Schema.Literals(['SignedOut', 'Unavailable'])
export type NoAccount = typeof NoAccount.Type

export const noAccountOf = (failure: FetchFailure): NoAccount =>
  failure._tag === 'Rejected' && failure.status === 401
    ? 'SignedOut'
    : 'Unavailable'

export const LoginFailure = Schema.Literals(['state', 'limit', 'refused'])
export type LoginFailure = typeof LoginFailure.Type

export const loginFailureOfSearch = (
  search: string,
): Option.Option<LoginFailure> =>
  Option.flatMap(
    Option.fromNullishOr(new URLSearchParams(search).get('login')),
    Schema.decodeUnknownOption(LoginFailure),
  )

export const MeReply = Schema.Struct({
  discordId: Schema.String,
  name: Schema.String,
})

export const MineReply = Schema.Struct({
  playlists: Schema.Array(
    Schema.Struct({
      id: PlaylistId,
      name: Schema.String,
      deleted: Schema.Boolean,
    }),
  ),
})

export const listedOf = (reply: typeof MineReply.Type): ReadonlyArray<Listed> =>
  Array.flatMap(reply.playlists, ({ id, name, deleted }) =>
    deleted ? [] : [{ id, name }],
  )

export const ClaimReply = Schema.Struct({
  claimed: Schema.Array(Schema.String),
})

export const accountOwns = (account: Account, id: PlaylistId): boolean =>
  Account.matchOrElse(
    account,
    {
      Connected: ({ playlists }) => playlists.some(entry => entry.id === id),
    },
    () => false,
  )

const modifyPlaylists = (
  account: Account,
  change: (playlists: ReadonlyArray<Listed>) => ReadonlyArray<Listed>,
): Account =>
  Account.matchOrElse(
    account,
    {
      Connected: connected =>
        Account.Connected({
          name: connected.name,
          playlists: change(connected.playlists),
        }),
    },
    () => account,
  )

export const listPlaylist = (account: Account, entry: Listed): Account =>
  modifyPlaylists(account, playlists => [
    ...Array.filter(playlists, ({ id }) => id !== entry.id),
    entry,
  ])

export const renameListed = (
  account: Account,
  id: PlaylistId,
  name: string,
): Account =>
  modifyPlaylists(account, playlists =>
    Array.map(playlists, entry => (entry.id === id ? { id, name } : entry)),
  )

export const unlistPlaylist = (account: Account, id: PlaylistId): Account =>
  modifyPlaylists(account, playlists =>
    Array.filter(playlists, entry => entry.id !== id),
  )

export const withPlaylists = (
  account: Account,
  playlists: ReadonlyArray<Listed>,
): Account => modifyPlaylists(account, () => playlists)

export const reachablePlaylists = (
  account: Account,
  mine: ReadonlyArray<Owned>,
): ReadonlyArray<Listed> => {
  const fromAccount = Account.matchOrElse(
    account,
    { Connected: ({ playlists }) => playlists },
    () => [],
  )
  return [
    ...fromAccount,
    ...Array.filter(
      Array.map(mine, ({ id, name }) => ({ id, name })),
      ({ id }) => !fromAccount.some(entry => entry.id === id),
    ),
  ]
}

export const claimable = (
  mine: ReadonlyArray<Owned>,
  listed: ReadonlyArray<Listed>,
  attempted: ReadonlyArray<PlaylistId>,
): ReadonlyArray<Owned> =>
  Array.filter(
    mine,
    ({ id, origin }) =>
      origin === 'Created' &&
      !listed.some(entry => entry.id === id) &&
      !attempted.includes(id),
  )

export const claimBatches = <A>(
  items: ReadonlyArray<A>,
): ReadonlyArray<ReadonlyArray<A>> => Array.chunksOf(items, MAX_CLAIM_TOKENS)

export const Attempts = Schema.Record(Schema.String, Schema.Array(PlaylistId))
export type Attempts = typeof Attempts.Type

const AttemptsJson = Schema.fromJsonString(Attempts)

export const parseAttempts = (maybeJson: Option.Option<string>): Attempts =>
  Option.getOrElse(
    Option.flatMap(maybeJson, Schema.decodeUnknownOption(AttemptsJson)),
    () => ({}),
  )

export const attemptsToJson = (attempts: Attempts): string =>
  Schema.encodeSync(AttemptsJson)(attempts)

export const attemptedBy = (
  attempts: Attempts,
  accountId: string,
): ReadonlyArray<PlaylistId> => attempts[accountId] ?? []

export const markAttempted = (
  attempts: Attempts,
  accountId: string,
  ids: ReadonlyArray<PlaylistId>,
): Attempts => ({
  ...attempts,
  [accountId]: Array.dedupe([...attemptedBy(attempts, accountId), ...ids]),
})

export const mergeAttempts = (loaded: Attempts, current: Attempts): Attempts =>
  Record.reduce(current, loaded, (merged, ids, accountId) =>
    markAttempted(merged, accountId, ids),
  )
