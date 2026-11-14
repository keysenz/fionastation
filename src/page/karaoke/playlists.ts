import { Array, Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { WriteFailure } from '../../api.ts'
import { PlaylistId } from '../../playlist.ts'
import {
  MAX_PLAYLIST_NAME_GRAPHEMES,
  cleanPlaylistName,
} from '../../playlistName.ts'
import { SaveSource } from './setlist.ts'

export const EditToken = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/),
).pipe(Schema.brand('EditToken'))
export type EditToken = typeof EditToken.Type

export const Owned = Schema.Struct({
  id: PlaylistId,
  name: Schema.String,
  editToken: EditToken,
})
export type Owned = typeof Owned.Type

const OwnedListJson = Schema.fromJsonString(Schema.Array(Owned))

export const parseOwned = (
  maybeJson: Option.Option<string>,
): ReadonlyArray<Owned> =>
  Option.getOrElse(
    Option.flatMap(maybeJson, Schema.decodeUnknownOption(OwnedListJson)),
    () => [],
  )

export const ownedToJson = (owned: ReadonlyArray<Owned>): string =>
  Schema.encodeSync(OwnedListJson)(owned)

export const remember = (
  owned: ReadonlyArray<Owned>,
  entry: Owned,
): ReadonlyArray<Owned> => [
  ...Array.filter(owned, ({ id }) => id !== entry.id),
  entry,
]

export const forget = (
  owned: ReadonlyArray<Owned>,
  id: PlaylistId,
): ReadonlyArray<Owned> => Array.filter(owned, entry => entry.id !== id)

export const rename = (
  owned: ReadonlyArray<Owned>,
  id: PlaylistId,
  name: string,
): ReadonlyArray<Owned> =>
  Array.map(owned, entry => (entry.id === id ? { ...entry, name } : entry))

export const OwnedChange = defineTaggedUnion({
  Remember: { entry: Owned },
  Rename: { id: PlaylistId, name: Schema.String },
  Forget: { id: PlaylistId },
})
export type OwnedChange = typeof OwnedChange.Type

export const applyChange = (
  owned: ReadonlyArray<Owned>,
  change: OwnedChange,
): ReadonlyArray<Owned> =>
  OwnedChange.match<ReadonlyArray<Owned>>(change, {
    Remember: ({ entry }) => remember(owned, entry),
    Rename: ({ id, name }) => rename(owned, id, name),
    Forget: ({ id }) => forget(owned, id),
  })

export const Candidate = Schema.Struct({ id: PlaylistId, editToken: EditToken })
export type Candidate = typeof Candidate.Type

export const isUnproven = (
  owned: ReadonlyArray<Owned>,
  id: PlaylistId,
  editToken: EditToken,
): boolean =>
  Option.exists(editTokenOf(owned, id), stored => stored !== editToken)

export const mergeOwned = (
  loaded: ReadonlyArray<Owned>,
  current: ReadonlyArray<Owned>,
): ReadonlyArray<Owned> =>
  Array.reduce(current, loaded, (merged, entry) => remember(merged, entry))

export const editTokenOf = (
  owned: ReadonlyArray<Owned>,
  id: PlaylistId,
): Option.Option<EditToken> =>
  Option.map(
    Array.findFirst(owned, entry => entry.id === id),
    ({ editToken }) => editToken,
  )

export const editTokenOfHash = (
  maybeHash: Option.Option<string>,
): Option.Option<EditToken> =>
  Option.flatMap(maybeHash, hash =>
    Option.flatMap(
      Option.fromNullishOr(new URLSearchParams(hash).get('edit')),
      Schema.decodeUnknownOption(EditToken),
    ),
  )

export const playlistPath = (id: PlaylistId): string => `/p/${id}`

export const SAVE_SOURCES: ReadonlyArray<SaveSource> = [
  'Queue',
  'History',
  'Session',
]

export const PlaylistForm = defineTaggedUnion({
  Save: { source: SaveSource, name: Schema.String },
  Copy: { name: Schema.String },
  Rename: { name: Schema.String },
  Update: {},
  Delete: {},
})
export type PlaylistForm = typeof PlaylistForm.Type

export const CopyTarget = Schema.Literals(['View', 'Edit'])
export type CopyTarget = typeof CopyTarget.Type

export const CopyResult = defineTaggedUnion({
  Copied: { target: CopyTarget },
  CopyFailed: { target: CopyTarget },
})
export type CopyResult = typeof CopyResult.Type

export const Remembered = Schema.Literals(['Pending', 'Yes', 'No'])
export type Remembered = typeof Remembered.Type

export const PlaylistDialog = defineTaggedUnion({
  Closed: {},
  Editing: { form: PlaylistForm, maybeFailure: Schema.Option(WriteFailure) },
  Sending: { form: PlaylistForm },
  Shared: {
    id: PlaylistId,
    name: Schema.String,
    maybeEditToken: Schema.Option(EditToken),
    remembered: Remembered,
    maybeCopyResult: Schema.Option(CopyResult),
  },
})
export type PlaylistDialog = typeof PlaylistDialog.Type

export const nameOfForm = (form: PlaylistForm): Option.Option<string> =>
  PlaylistForm.matchOrElse(
    form,
    {
      Save: ({ name }) => Option.some(name),
      Copy: ({ name }) => Option.some(name),
      Rename: ({ name }) => Option.some(name),
    },
    () => Option.none(),
  )

export type WrittenName =
  | Readonly<{ kind: 'Valid'; name: string }>
  | Readonly<{ kind: 'TooLong' }>

export const writtenName = (raw: string): WrittenName => {
  const cleaned = cleanPlaylistName(raw)
  return cleaned.kind === 'Cleaned'
    ? { kind: 'Valid', name: cleaned.name }
    : { kind: 'TooLong' }
}

const COPY_SUFFIX = ' (copy)'
const graphemes = new Intl.Segmenter()

export const copyName = (name: string): string => {
  const room = MAX_PLAYLIST_NAME_GRAPHEMES - [...COPY_SUFFIX].length
  const kept = Array.take([...graphemes.segment(name)], room)
    .map(({ segment }) => segment)
    .join('')
  return `${kept.trimEnd()}${COPY_SUFFIX}`
}
