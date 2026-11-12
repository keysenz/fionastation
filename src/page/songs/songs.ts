import { Array, Effect, Option, Result, Schema } from 'effect'
import { AsyncData, Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { fetchJson } from '../../api'
import { Songbook, type SongbookSong } from '../../domain.ts'
import { makeFuzzySearch } from '../../fuzzySearch'

// MODEL

const SongbookData = AsyncData.Schema(Songbook, Schema.String)

export const Model = Schema.Struct({
  songbook: SongbookData.schema,
  search: Schema.String,
  isNotesOpen: Schema.Boolean,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  songbook: SongbookData.Idle(),
  search: '',
  isNotesOpen: false,
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededFetchSongbook: { songbook: Songbook },
  FailedFetchSongbook: { error: Schema.String },
  ClickedRetryFetch: {},
  UpdatedSearch: { value: Schema.String },
  ToggledNotes: {},
})
export type Message = typeof Message.Type

// COMMAND

export const FetchSongbook = Command.define('FetchSongbook', {
  messages: [Message.SucceededFetchSongbook, Message.FailedFetchSongbook],
  execute: fetchJson('/api/get-songbook', Songbook).pipe(
    Effect.match({
      onFailure: error => Message.FailedFetchSongbook({ error }),
      onSuccess: songbook => Message.SucceededFetchSongbook({ songbook }),
    }),
  ),
})

// UPDATE

export type UpdateReturn = Update.Return<Model, Message>

/** Rereads the sheet on every visit, because the list is edited by hand between streams. */
export const entered = (model: Model): UpdateReturn =>
  Option.match(AsyncData.revalidateOrLoad(model.songbook), {
    onNone: () => ({ model }),
    onSome: songbook => ({
      model: modifyFields(model, { songbook: () => songbook }),
      commands: [FetchSongbook()],
    }),
  })

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    SucceededFetchSongbook: ({ songbook }) => ({
      model: modifyFields(model, {
        songbook: current =>
          AsyncData.settle(current, Result.succeed(songbook)),
      }),
    }),
    FailedFetchSongbook: ({ error }) => ({
      model: modifyFields(model, {
        songbook: current => AsyncData.settle(current, Result.fail(error)),
      }),
    }),
    ClickedRetryFetch: () => entered(model),
    UpdatedSearch: ({ value }) => ({
      model: modifyFields(model, { search: () => value }),
    }),
    ToggledNotes: () => ({
      model: modifyFields(model, { isNotesOpen: isOpen => !isOpen }),
    }),
  })

// QUERIES

export type LanguageGroup = Readonly<{
  language: string
  songs: ReadonlyArray<SongbookSong>
}>

const searchSongs = makeFuzzySearch<SongbookSong>(['title'], 0.3)
const searchTitles = makeFuzzySearch<string>([], 0.3)

/** Groups keep the sheet's column order, so the language Fiona put first stays first. */
export const visibleGroups = (
  songbook: Songbook,
  query: string,
): ReadonlyArray<LanguageGroup> => {
  const shown = searchSongs(songbook.songs, query)
  return Array.dedupe(songbook.songs.map(song => song.language)).map(
    language => ({
      language,
      songs: shown.filter(song => song.language === language),
    }),
  )
}

export const visibleRequests = (
  songbook: Songbook,
  query: string,
): ReadonlyArray<string> => searchTitles(songbook.requests, query)

export const visibleNotes = (
  songbook: Songbook,
  query: string,
): ReadonlyArray<string> => searchTitles(songbook.notes, query)
