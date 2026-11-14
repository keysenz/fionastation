import { Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import type { FetchFailure } from '../../api.ts'
import { PlayableSong } from '../../domain.ts'
import { Playlist, PlaylistId } from '../../playlist.ts'
import { EditToken } from './playlists.ts'

export const PlaylistFailure = Schema.Literals([
  'Deleted',
  'NotFound',
  'Unreachable',
])
export type PlaylistFailure = typeof PlaylistFailure.Type

export const playlistFailureOf = (failure: FetchFailure): PlaylistFailure =>
  failure._tag === 'Rejected' && failure.status === 410
    ? 'Deleted'
    : failure._tag === 'Rejected' && failure.status === 404
      ? 'NotFound'
      : 'Unreachable'

export const OpenedPlaylist = Schema.Struct({
  id: PlaylistId,
  name: Schema.String,
  version: Schema.Int,
  songIds: Schema.NonEmptyArray(Schema.String),
})
export type OpenedPlaylist = typeof OpenedPlaylist.Type

export const PlaylistOpen = defineTaggedUnion({
  Idle: {},
  AwaitingSavedSetlist: {
    id: PlaylistId,
    maybeEditToken: Schema.Option(EditToken),
  },
  Fetching: { id: PlaylistId, maybeEditToken: Schema.Option(EditToken) },
  Fetched: { playlist: Playlist },
  Asking: {
    opened: OpenedPlaylist,
    songs: Schema.NonEmptyArray(PlayableSong),
    unavailableCount: Schema.Number,
  },
  Opened: { opened: OpenedPlaylist },
})
export type PlaylistOpen = typeof PlaylistOpen.Type

export const playlistIdOf = (open: PlaylistOpen): Option.Option<PlaylistId> =>
  PlaylistOpen.match(open, {
    Idle: () => Option.none(),
    AwaitingSavedSetlist: ({ id }) => Option.some(id),
    Fetching: ({ id }) => Option.some(id),
    Fetched: ({ playlist }) => Option.some(playlist.id),
    Asking: ({ opened }) => Option.some(opened.id),
    Opened: ({ opened }) => Option.some(opened.id),
  })
