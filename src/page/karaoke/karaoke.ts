import { Effect, Option, Result, Schema, Stream } from 'effect'
import { AsyncData, Command, Mount, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { fetchJson } from '../../api'
import { KaraokeVideo, PlayableSong, toPlayableSongs } from '../../domain.ts'
import { PlayerEvent, playerEvents, setPlaying } from '../../youtube'
import {
  Setlist,
  advanceAfterEnd,
  emptySetlist,
  enqueue,
  failLoad,
  play,
  playNext,
  playPrevious,
  restoreSaved,
  setStatus,
  toPersistedJson,
  togglePlaying,
} from './setlist.ts'

const STORAGE_KEY = 'karaoke-storage'
const PLAYER_HOST_ID = 'karaoke'

// MODEL

const SongsData = AsyncData.Schema(Schema.Array(PlayableSong), Schema.String)

export const Model = Schema.Struct({
  songs: SongsData.schema,
  search: Schema.String,
  maybeCategory: Schema.Option(Schema.String),
  setlist: Setlist,
  isExpanded: Schema.Boolean,
  isQueueOpen: Schema.Boolean,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededFetchSongs: { songs: Schema.Array(PlayableSong) },
  FailedFetchSongs: { error: Schema.String },
  ClickedRetryFetch: {},
  UpdatedSearch: { value: Schema.String },
  ClickedCategory: { category: Schema.String },
  ClickedSong: { song: PlayableSong },
  ClickedAddToQueue: { song: PlayableSong },
  ClickedPlayPause: {},
  ClickedNext: {},
  ClickedPrevious: {},
  ClickedToggleExpanded: {},
  ClickedCollapse: {},
  ClickedQueueHandle: {},
  ReceivedPlayerEvent: { playId: Schema.Number, event: PlayerEvent },
  CompletedLoadSavedSetlist: { maybeJson: Schema.Option(Schema.String) },
  CompletedApplyPlayback: {},
  CompletedSaveSetlist: {},
})
export type Message = typeof Message.Type

// COMMAND

export const FetchSongs = Command.define('FetchSongs', {
  messages: [Message.SucceededFetchSongs, Message.FailedFetchSongs],
  execute: fetchJson('/api/get-karaoke', Schema.Array(KaraokeVideo)).pipe(
    Effect.match({
      onFailure: error => Message.FailedFetchSongs({ error }),
      onSuccess: videos =>
        Message.SucceededFetchSongs({ songs: toPlayableSongs(videos) }),
    }),
  ),
})

export const ApplyPlayback = Command.define('ApplyPlayback', {
  args: { isPlaying: Schema.Boolean },
  messages: [Message.CompletedApplyPlayback],
  execute: ({ isPlaying }) =>
    setPlaying(PLAYER_HOST_ID, isPlaying).pipe(
      Effect.as(Message.CompletedApplyPlayback()),
    ),
})

// NOTE: browsers throw on any localStorage access when site data is blocked, so both Commands catch it.
export const LoadSavedSetlist = Command.define('LoadSavedSetlist', {
  messages: [Message.CompletedLoadSavedSetlist],
  execute: Effect.try({
    try: () => Option.fromNullishOr(window.localStorage.getItem(STORAGE_KEY)),
    catch: () => 'storage is blocked',
  }).pipe(
    Effect.orElseSucceed(() => Option.none<string>()),
    Effect.map(maybeJson => Message.CompletedLoadSavedSetlist({ maybeJson })),
  ),
})

export const SaveSetlist = Command.define('SaveSetlist', {
  args: { json: Schema.String },
  messages: [Message.CompletedSaveSetlist],
  execute: ({ json }) =>
    Effect.try({
      try: () => window.localStorage.setItem(STORAGE_KEY, json),
      catch: () => 'storage is blocked or full',
    }).pipe(Effect.ignore, Effect.as(Message.CompletedSaveSetlist())),
})

export const MountPlayer = Mount.defineStream('MountPlayer', {
  args: {
    playId: Schema.Number,
    videoId: Schema.String,
    startSeconds: Schema.Number,
  },
  messages: [Message.ReceivedPlayerEvent],
  execute: ({ element, playId, videoId, startSeconds }) =>
    playerEvents(element, {
      hostId: PLAYER_HOST_ID,
      videoId,
      playerVars: {
        autoplay: 1,
        controls: 1,
        modestbranding: 1,
        start: startSeconds,
      },
    }).pipe(
      Stream.map(event => Message.ReceivedPlayerEvent({ playId, event })),
    ),
})

// INIT

export const init = (): Model => ({
  songs: SongsData.Idle(),
  search: '',
  maybeCategory: Option.none(),
  setlist: emptySetlist,
  isExpanded: false,
  isQueueOpen: false,
})

export type UpdateReturn = Update.Return<Model, Message>

const fetchIfNeeded = (model: Model): UpdateReturn =>
  Option.match(AsyncData.revalidateOrLoad(model.songs), {
    onNone: () => ({ model }),
    onSome: songs => ({
      model: modifyFields(model, { songs: () => songs }),
      commands: [FetchSongs()],
    }),
  })

/** Rereads saved data on every visit, because another tab may have changed the queue. */
export const entered = (model: Model): UpdateReturn => {
  const fetched = fetchIfNeeded(model)
  return {
    model: fetched.model,
    commands: [LoadSavedSetlist(), ...(fetched.commands ?? [])],
  }
}

// UPDATE

export const allSongs = (model: Model): ReadonlyArray<PlayableSong> =>
  Option.getOrElse(AsyncData.getData(model.songs), () => [])

/** What the visitor asks for goes through here, which saves it and tells the
 *  player. A player's own reports must not, because telling a player what it
 *  just reported would echo. A new play needs no player Command, because it
 *  mounts a new player that autoplays. */
const changeSetlist = (model: Model, setlist: Setlist): UpdateReturn => {
  const playbackCommand = Option.flatMap(
    Option.all({
      before: model.setlist.maybeNowPlaying,
      after: setlist.maybeNowPlaying,
    }),
    ({ before, after }) =>
      before.playId === after.playId && before.status !== after.status
        ? Option.some(ApplyPlayback({ isPlaying: after.status === 'Playing' }))
        : Option.none(),
  )
  return {
    model: modifyFields(model, { setlist: () => setlist }),
    commands: [
      SaveSetlist({ json: toPersistedJson(setlist) }),
      ...Option.toArray(playbackCommand),
    ],
  }
}

const recordFromPlayer = (model: Model, setlist: Setlist): UpdateReturn => ({
  model: modifyFields(model, { setlist: () => setlist }),
})

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    SucceededFetchSongs: ({ songs }) => ({
      model: modifyFields(model, {
        songs: current => AsyncData.settle(current, Result.succeed(songs)),
      }),
    }),

    FailedFetchSongs: ({ error }) => ({
      model: modifyFields(model, {
        songs: current => AsyncData.settle(current, Result.fail(error)),
      }),
    }),

    ClickedRetryFetch: () => fetchIfNeeded(model),

    UpdatedSearch: ({ value }) => ({
      model: modifyFields(model, { search: () => value }),
    }),

    ClickedCategory: ({ category }) => ({
      model: modifyFields(model, {
        maybeCategory: () => Option.some(category),
      }),
    }),

    ClickedSong: ({ song }) => {
      const isCurrentSong = Option.exists(
        model.setlist.maybeNowPlaying,
        nowPlaying => nowPlaying.song.id === song.id,
      )
      return changeSetlist(
        model,
        isCurrentSong
          ? togglePlaying(model.setlist)
          : play(model.setlist, song),
      )
    },

    ClickedAddToQueue: ({ song }) =>
      changeSetlist(model, enqueue(model.setlist, song)),

    ClickedPlayPause: () => changeSetlist(model, togglePlaying(model.setlist)),
    ClickedNext: () => changeSetlist(model, playNext(model.setlist)),
    ClickedPrevious: () => changeSetlist(model, playPrevious(model.setlist)),

    ClickedToggleExpanded: () => ({
      model: modifyFields(model, { isExpanded: isExpanded => !isExpanded }),
    }),
    ClickedCollapse: () => ({
      model: modifyFields(model, { isExpanded: () => false }),
    }),
    ClickedQueueHandle: () => ({
      model: modifyFields(model, { isQueueOpen: isOpen => !isOpen }),
    }),

    // NOTE: a replaced player can still have events on their way, and acting on a late end would skip a song.
    ReceivedPlayerEvent: ({ playId, event }) =>
      Option.match(
        Option.filter(
          model.setlist.maybeNowPlaying,
          nowPlaying => nowPlaying.playId === playId,
        ),
        {
          onNone: () => ({ model }),
          onSome: ({ status }) =>
            PlayerEvent.match<UpdateReturn>(event, {
              Ready: () => ({
                model,
                commands: [ApplyPlayback({ isPlaying: status === 'Playing' })],
              }),
              Playing: () =>
                recordFromPlayer(model, setStatus(model.setlist, 'Playing')),
              Paused: () =>
                recordFromPlayer(model, setStatus(model.setlist, 'Paused')),
              Ended: () =>
                changeSetlist(
                  model,
                  advanceAfterEnd(model.setlist, allSongs(model)),
                ),
              Failed: ({ reason }) =>
                recordFromPlayer(model, failLoad(model.setlist, reason)),
            }),
        },
      ),

    CompletedLoadSavedSetlist: ({ maybeJson }) => ({
      model: modifyFields(model, {
        setlist: setlist => restoreSaved(setlist, maybeJson),
      }),
    }),

    CompletedApplyPlayback: () => ({ model }),
    CompletedSaveSetlist: () => ({ model }),
  })
