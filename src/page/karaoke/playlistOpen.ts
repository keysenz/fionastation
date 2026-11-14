import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import type { FetchFailure } from '../../api.ts'
import { PlayableSong } from '../../domain.ts'
import { Playlist, PlaylistId, PlaylistName } from '../../playlist.ts'

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

export const PlaylistOpen = defineTaggedUnion({
  Idle: {},
  AwaitingSavedSetlist: { id: PlaylistId },
  Fetching: { id: PlaylistId },
  Fetched: { playlist: Playlist },
  Asking: {
    name: PlaylistName,
    songs: Schema.NonEmptyArray(PlayableSong),
    unavailableCount: Schema.Number,
  },
  Opened: { name: PlaylistName },
})
export type PlaylistOpen = typeof PlaylistOpen.Type
