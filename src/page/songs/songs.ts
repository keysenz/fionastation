import { Array, Effect, Option, Result, Schema } from 'effect'
import { AsyncData, Command, Dom, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { fetchJson } from '../../api'
import { Songbook, type SongbookSong } from '../../domain.ts'
import { makeFuzzySearch } from '../../fuzzySearch'

// MODEL

export const NOTES_BUTTON_ID = 'songbook-notes-button'
export const NOTES_PANEL_ID = 'songbook-notes-panel'

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
  ClickedOpenNotes: {},
  ClickedCloseNotes: {},
  CompletedFocusNotesPanel: {},
  CompletedFocusNotesButton: {},
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

export const FocusNotesPanel = Command.define('FocusNotesPanel', {
  messages: [Message.CompletedFocusNotesPanel],
  execute: Dom.focus(`#${NOTES_PANEL_ID}`).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedFocusNotesPanel()),
  ),
})

export const FocusNotesButton = Command.define('FocusNotesButton', {
  messages: [Message.CompletedFocusNotesButton],
  execute: Dom.focus(`#${NOTES_BUTTON_ID}`).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedFocusNotesButton()),
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
    ClickedOpenNotes: () => ({
      model: modifyFields(model, { isNotesOpen: () => true }),
      commands: [FocusNotesPanel()],
    }),
    ClickedCloseNotes: () =>
      model.isNotesOpen
        ? {
            model: modifyFields(model, { isNotesOpen: () => false }),
            commands: [FocusNotesButton()],
          }
        : { model },
    CompletedFocusNotesPanel: () => ({ model }),
    CompletedFocusNotesButton: () => ({ model }),
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
