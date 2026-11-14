import { Schema } from 'effect'

import { cleanPlaylistName } from './playlistName.ts'

export const PLAYLIST_ID_LENGTH = 8
export const MAX_PLAYLIST_ENTRIES = 100

export const PlaylistId = Schema.String.check(
  Schema.isPattern(new RegExp(`^[0-9A-Za-z]{${PLAYLIST_ID_LENGTH}}$`)),
).pipe(Schema.brand('PlaylistId'))
export type PlaylistId = typeof PlaylistId.Type

export const PlaylistName = Schema.String.check(
  Schema.makeFilter(name => {
    const cleaned = cleanPlaylistName(name)
    return cleaned.kind === 'Cleaned' && cleaned.name === name
  }),
).pipe(Schema.brand('PlaylistName'))
export type PlaylistName = typeof PlaylistName.Type

export const PlaylistEntry = Schema.Struct({
  songId: Schema.String,
  videoUrl: Schema.String,
  timestamp: Schema.String,
  title: Schema.String,
})
export type PlaylistEntry = typeof PlaylistEntry.Type

export const Playlist = Schema.Struct({
  id: PlaylistId,
  name: PlaylistName,
  entries: Schema.NonEmptyArray(PlaylistEntry).check(
    Schema.isMaxLength(MAX_PLAYLIST_ENTRIES),
    Schema.makeFilter(
      entries =>
        new Set(entries.map(entry => entry.songId)).size === entries.length,
    ),
  ),
  version: Schema.Int,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export type Playlist = typeof Playlist.Type
export type PlaylistJson = typeof Playlist.Encoded
