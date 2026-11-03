import {
  Array,
  Duration,
  Effect,
  Option,
  Queue,
  Random,
  Result,
  Schema,
  Stream,
} from 'effect'
import {
  AsyncData,
  Command,
  Dom,
  Mount,
  Subscription,
  type Update,
} from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { fetchJson } from '../../api'
import {
  KaraokeVideo,
  PlayableSong,
  goneVideoIdsOf,
  toPlayableSongs,
} from '../../domain.ts'
import { PlayerEvent, playerEvents, setPlaying } from '../../youtube'
import {
  Advance,
  type Continuation,
  PickCause,
  Setlist,
  applyAdvance,
  applySkip,
  emptySetlist,
  enqueue,
  failLoad,
  markPlayerReady,
  moveInQueue,
  planAdvance,
  planSkip,
  play,
  playNext,
  playPicked,
  playPrevious,
  restoreSaved,
  setStatus,
  toPersistedJson,
  togglePlaying,
} from './setlist.ts'

const STORAGE_KEY = 'karaoke-storage'
const AUTOPLAY_KEY = 'karaoke-autoplay'
export const STREAM_GONE = 'This stream is gone'
const PLAYER_HOST_ID = 'karaoke'
export const SONG_LIST_ID = 'karaoke-song-list'
export const SETLIST_PANE_ID = 'karaoke-setlist-pane'

// MODEL

const SongsData = AsyncData.Schema(Schema.Array(PlayableSong), Schema.String)

export const SkipToast = Schema.Struct({
  firstSkippedTitle: Schema.String,
  skippedCount: Schema.Number,
  dismissId: Schema.Number,
})
export type SkipToast = typeof SkipToast.Type

export const QueueDrag = Schema.Struct({
  from: Schema.Number,
  over: Schema.Number,
})
export type QueueDrag = typeof QueueDrag.Type

export const queueHandleId = (index: number): string =>
  `karaoke-queue-handle-${index}`

export const Model = Schema.Struct({
  songs: SongsData.schema,
  search: Schema.String,
  setlist: Setlist,
  isExpanded: Schema.Boolean,
  isQueueOpen: Schema.Boolean,
  maybeSkipToast: Schema.Option(SkipToast),
  goneVideoIds: Schema.Array(Schema.String),
  isAutoplay: Schema.Boolean,
  maybeSelectedVideoId: Schema.Option(Schema.String),
  maybeQueueDrag: Schema.Option(QueueDrag),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededFetchSongs: {
    songs: Schema.Array(PlayableSong),
    goneVideoIds: Schema.Array(Schema.String),
  },
  FailedFetchSongs: { error: Schema.String },
  ClickedRetryFetch: {},
  UpdatedSearch: { value: Schema.String },
  ClickedVideo: { videoId: Schema.String },
  ClickedBackToVideos: {},
  ClickedSong: { song: PlayableSong },
  ClickedAddToQueue: { song: PlayableSong },
  ClickedPlayPause: {},
  ClickedNext: {},
  ClickedPrevious: {},
  ClickedToggleExpanded: {},
  ClickedCollapse: {},
  ClickedQueueHandle: {},
  ClickedDismissToast: {},
  ClickedToggleAutoplay: {},
  StartedQueueDrag: { index: Schema.Number },
  DraggedOverQueueSlot: { index: Schema.Number },
  DroppedQueueSong: { index: Schema.Number },
  EndedQueueDrag: {},
  PressedQueueMoveKey: {
    index: Schema.Number,
    by: Schema.Literals([-1, 1]),
  },
  ReceivedPlayerEvent: { playId: Schema.Number, event: PlayerEvent },
  CompletedLoadSavedSetlist: { maybeJson: Schema.Option(Schema.String) },
  CompletedApplyPlayback: {},
  CompletedSaveSetlist: {},
  CompletedLoadAutoplay: { maybeValue: Schema.Option(Schema.String) },
  CompletedSaveAutoplay: {},
  CompletedScrollListToTop: {},
  CompletedScrollSetlistToTop: {},
  CompletedFocusQueueHandle: {},
  CompletedPickRandomVideo: {
    playId: Schema.Number,
    song: PlayableSong,
    cause: PickCause,
  },
  CompletedWaitBeforeDismissToast: { dismissId: Schema.Number },
})
export type Message = typeof Message.Type

// COMMAND

export const FetchSongs = Command.define('FetchSongs', {
  messages: [Message.SucceededFetchSongs, Message.FailedFetchSongs],
  execute: fetchJson('/api/get-karaoke', Schema.Array(KaraokeVideo)).pipe(
    Effect.match({
      onFailure: error => Message.FailedFetchSongs({ error }),
      onSuccess: videos =>
        Message.SucceededFetchSongs({
          songs: toPlayableSongs(videos),
          goneVideoIds: goneVideoIdsOf(videos),
        }),
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

export const LoadAutoplay = Command.define('LoadAutoplay', {
  messages: [Message.CompletedLoadAutoplay],
  execute: Effect.try({
    try: () => Option.fromNullishOr(window.localStorage.getItem(AUTOPLAY_KEY)),
    catch: () => 'storage is blocked',
  }).pipe(
    Effect.orElseSucceed(() => Option.none<string>()),
    Effect.map(maybeValue => Message.CompletedLoadAutoplay({ maybeValue })),
  ),
})

// NOTE: a search swaps the list under the reader, so it starts again from its first video.
export const ScrollListToTop = Command.define('ScrollListToTop', {
  messages: [Message.CompletedScrollListToTop],
  execute: Dom.scrollIntoViewAfterPaint(`#${SONG_LIST_ID}`, {
    block: 'start',
  }).pipe(Effect.ignore, Effect.as(Message.CompletedScrollListToTop())),
})

export const ScrollSetlistToTop = Command.define('ScrollSetlistToTop', {
  messages: [Message.CompletedScrollSetlistToTop],
  execute: Dom.scrollIntoViewAfterPaint(`#${SETLIST_PANE_ID}`, {
    block: 'start',
  }).pipe(Effect.ignore, Effect.as(Message.CompletedScrollSetlistToTop())),
})

export const FocusQueueHandle = Command.define('FocusQueueHandle', {
  args: { index: Schema.Number },
  messages: [Message.CompletedFocusQueueHandle],
  execute: ({ index }) =>
    Dom.focus(`#${queueHandleId(index)}`).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusQueueHandle()),
    ),
})

export const SaveAutoplay = Command.define('SaveAutoplay', {
  args: { isAutoplay: Schema.Boolean },
  messages: [Message.CompletedSaveAutoplay],
  execute: ({ isAutoplay }) =>
    Effect.try({
      try: () => window.localStorage.setItem(AUTOPLAY_KEY, String(isAutoplay)),
      catch: () => 'storage is blocked or full',
    }).pipe(Effect.ignore, Effect.as(Message.CompletedSaveAutoplay())),
})

export const PickRandomVideo = Command.define('PickRandomVideo', {
  args: {
    playId: Schema.Number,
    candidates: Schema.NonEmptyArray(PlayableSong),
    cause: PickCause,
  },
  messages: [Message.CompletedPickRandomVideo],
  execute: ({ playId, candidates, cause }) =>
    Random.choice(candidates).pipe(
      Effect.map(song =>
        Message.CompletedPickRandomVideo({ playId, song, cause }),
      ),
    ),
})

const TOAST_SECONDS = 6

export const WaitBeforeDismissToast = Command.define('WaitBeforeDismissToast', {
  args: { dismissId: Schema.Number },
  messages: [Message.CompletedWaitBeforeDismissToast],
  execute: ({ dismissId }) =>
    Effect.sleep(Duration.seconds(TOAST_SECONDS)).pipe(
      Effect.as(Message.CompletedWaitBeforeDismissToast({ dismissId })),
    ),
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

// SUBSCRIPTION

const QUEUE_INDEX_ATTRIBUTE = 'data-queue-index'

const queueSlotAt = (clientX: number, clientY: number): Option.Option<number> =>
  Option.map(
    Option.fromNullishOr(
      document
        .elementFromPoint(clientX, clientY)
        ?.closest(`[${QUEUE_INDEX_ATTRIBUTE}]`)
        ?.getAttribute(QUEUE_INDEX_ATTRIBUTE),
    ),
    Number,
  )

const queueDragStream = Stream.callback<Message>(queue =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const state = { maybeOver: Option.none<number>() }
      const onMove = (event: PointerEvent) => {
        const maybeSlot = queueSlotAt(event.clientX, event.clientY)
        if (
          Option.isSome(maybeSlot) &&
          !Option.contains(state.maybeOver, maybeSlot.value)
        ) {
          state.maybeOver = maybeSlot
          Queue.offerUnsafe(
            queue,
            Message.DraggedOverQueueSlot({ index: maybeSlot.value }),
          )
        }
      }
      const onUp = (event: PointerEvent) => {
        Queue.offerUnsafe(
          queue,
          Option.match(queueSlotAt(event.clientX, event.clientY), {
            onNone: () => Message.EndedQueueDrag(),
            onSome: index => Message.DroppedQueueSong({ index }),
          }),
        )
      }
      const onCancel = () => Queue.offerUnsafe(queue, Message.EndedQueueDrag())
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      return { onMove, onUp, onCancel }
    }),
    ({ onMove, onUp, onCancel }) =>
      Effect.sync(() => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
      }),
  ).pipe(Effect.flatMap(() => Effect.never)),
)

export const subscriptions = Subscription.make<Model, Message>()(entry => ({
  queueDrag: entry(
    { isDragging: Schema.Boolean },
    {
      modelToDependencies: model => ({
        isDragging: Option.isSome(model.maybeQueueDrag),
      }),
      dependenciesToStream: ({ isDragging }) =>
        Stream.when(
          queueDragStream,
          Effect.sync(() => isDragging),
        ),
    },
  ),
}))

// INIT

export const init = (): Model => ({
  songs: SongsData.Idle(),
  search: '',
  setlist: emptySetlist,
  isExpanded: false,
  isQueueOpen: false,
  maybeSkipToast: Option.none(),
  goneVideoIds: [],
  isAutoplay: true,
  maybeSelectedVideoId: Option.none(),
  maybeQueueDrag: Option.none(),
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
    commands: [LoadSavedSetlist(), LoadAutoplay(), ...(fetched.commands ?? [])],
  }
}

// UPDATE

export const allSongs = (model: Model): ReadonlyArray<PlayableSong> =>
  Option.getOrElse(AsyncData.getData(model.songs), () => [])

const continuationOf = (model: Model): Continuation => {
  const goneIds = new Set(model.goneVideoIds)
  return {
    archive: allSongs(model),
    isGone: song => goneIds.has(song.video_url),
    isAutoplay: model.isAutoplay,
  }
}

/** Only a saved "false" turns autoplay off, so missing or corrupt data keeps it on. */
const parseAutoplay = (maybeValue: Option.Option<string>): boolean =>
  !Option.contains(maybeValue, 'false')

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

const addSkip = (
  maybeToast: Option.Option<SkipToast>,
  failedTitle: string,
  dismissId: number,
): SkipToast =>
  Option.match(maybeToast, {
    onNone: () => ({
      firstSkippedTitle: failedTitle,
      skippedCount: 1,
      dismissId,
    }),
    onSome: toast => ({
      firstSkippedTitle: toast.firstSkippedTitle,
      skippedCount: toast.skippedCount + 1,
      dismissId,
    }),
  })

const withSkipToast = (
  model: Model,
  failedTitle: string,
  dismissId: number,
): Model =>
  modifyFields(model, {
    maybeSkipToast: maybeToast =>
      Option.some(addSkip(maybeToast, failedTitle, dismissId)),
  })

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    SucceededFetchSongs: ({ songs, goneVideoIds }) => ({
      model: modifyFields(model, {
        songs: current => AsyncData.settle(current, Result.succeed(songs)),
        goneVideoIds: known => Array.dedupe([...known, ...goneVideoIds]),
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
      commands:
        value.trim() === '' ? [] : [ScrollListToTop(), ScrollSetlistToTop()],
    }),

    ClickedVideo: ({ videoId }) => ({
      model: modifyFields(model, {
        maybeSelectedVideoId: () => Option.some(videoId),
      }),
      commands: [ScrollSetlistToTop()],
    }),

    ClickedBackToVideos: () => ({
      model: modifyFields(model, { maybeSelectedVideoId: () => Option.none() }),
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

    StartedQueueDrag: ({ index }) => ({
      model: modifyFields(model, {
        maybeQueueDrag: () => Option.some({ from: index, over: index }),
      }),
    }),

    DraggedOverQueueSlot: ({ index }) => ({
      model: modifyFields(model, {
        maybeQueueDrag: maybeDrag =>
          Option.map(maybeDrag, drag => ({ ...drag, over: index })),
      }),
    }),

    DroppedQueueSong: ({ index }) =>
      Option.match(model.maybeQueueDrag, {
        onNone: () => ({ model }),
        onSome: ({ from }) => {
          const cleared = modifyFields(model, {
            maybeQueueDrag: () => Option.none(),
          })
          const moved = moveInQueue(model.setlist, from, index)
          return moved === model.setlist
            ? { model: cleared }
            : changeSetlist(cleared, moved)
        },
      }),

    EndedQueueDrag: () => ({
      model: modifyFields(model, { maybeQueueDrag: () => Option.none() }),
    }),

    PressedQueueMoveKey: ({ index, by }) => {
      const moved = moveInQueue(model.setlist, index, index + by)
      if (moved === model.setlist) {
        return { model }
      }
      const changed = changeSetlist(model, moved)
      return {
        model: changed.model,
        commands: [
          ...(changed.commands ?? []),
          FocusQueueHandle({ index: index + by }),
        ],
      }
    },

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
          onSome: ({ status, song: nowPlayingSong }) =>
            PlayerEvent.match<UpdateReturn>(event, {
              Ready: () => ({
                model: modifyFields(model, {
                  setlist: markPlayerReady,
                }),
                commands: [ApplyPlayback({ isPlaying: status === 'Playing' })],
              }),
              Playing: () =>
                recordFromPlayer(model, setStatus(model.setlist, 'Playing')),
              Paused: () =>
                recordFromPlayer(model, setStatus(model.setlist, 'Paused')),
              Ended: () => {
                const advance = planAdvance(
                  model.setlist,
                  continuationOf(model),
                )
                return Advance.matchOrElse(
                  advance,
                  {
                    PickRandomVideo: ({ candidates }) => ({
                      model,
                      commands: [
                        PickRandomVideo({
                          playId,
                          candidates,
                          cause: 'Ended',
                        }),
                      ],
                    }),
                  },
                  () =>
                    changeSetlist(model, applyAdvance(model.setlist, advance)),
                )
              },
              VideoFailed: () => {
                const goneModel = modifyFields(model, {
                  goneVideoIds: known =>
                    Array.dedupe([...known, nowPlayingSong.video_url]),
                })
                const { cleaned, advance } = planSkip(
                  goneModel.setlist,
                  continuationOf(goneModel),
                )
                return Advance.matchOrElse(
                  advance,
                  {
                    PickRandomVideo: ({ candidates }) => ({
                      model: modifyFields(goneModel, {
                        setlist: () => cleaned,
                      }),
                      commands: [
                        SaveSetlist({ json: toPersistedJson(cleaned) }),
                        PickRandomVideo({
                          playId,
                          candidates,
                          cause: 'Unavailable',
                        }),
                      ],
                    }),
                  },
                  () => {
                    const setlist = applySkip(cleaned, advance, STREAM_GONE)
                    const saveSetlist = SaveSetlist({
                      json: toPersistedJson(setlist),
                    })
                    const maybeSkippedTo = Option.filter(
                      setlist.maybeNowPlaying,
                      after => after.playId !== playId,
                    )
                    return Option.match(maybeSkippedTo, {
                      onNone: () => ({
                        model: modifyFields(goneModel, {
                          setlist: () => setlist,
                        }),
                        commands: [saveSetlist],
                      }),
                      onSome: ({ playId: dismissId }) => ({
                        model: withSkipToast(
                          modifyFields(goneModel, { setlist: () => setlist }),
                          nowPlayingSong.song_title,
                          dismissId,
                        ),
                        commands: [
                          saveSetlist,
                          WaitBeforeDismissToast({ dismissId }),
                        ],
                      }),
                    })
                  },
                )
              },
              PlayerFailed: ({ reason }) =>
                recordFromPlayer(model, failLoad(model.setlist, reason)),
            }),
        },
      ),

    // NOTE: a click while the pick was pending changed the playId, and the visitor's choice wins.
    CompletedPickRandomVideo: ({ playId, song, cause }) =>
      Option.match(
        Option.filter(
          model.setlist.maybeNowPlaying,
          nowPlaying => nowPlaying.playId === playId,
        ),
        {
          onNone: () => ({ model }),
          onSome: ({ song: previousSong }) => {
            const setlist = playPicked(model.setlist, song, cause)
            const saveSetlist = SaveSetlist({ json: toPersistedJson(setlist) })
            const dismissId = setlist.playCount
            return cause === 'Ended'
              ? {
                  model: modifyFields(model, { setlist: () => setlist }),
                  commands: [saveSetlist],
                }
              : {
                  model: withSkipToast(
                    modifyFields(model, { setlist: () => setlist }),
                    previousSong.song_title,
                    dismissId,
                  ),
                  commands: [
                    saveSetlist,
                    WaitBeforeDismissToast({ dismissId }),
                  ],
                }
          },
        },
      ),

    CompletedLoadSavedSetlist: ({ maybeJson }) => ({
      model: modifyFields(model, {
        setlist: setlist => restoreSaved(setlist, maybeJson),
      }),
    }),

    ClickedToggleAutoplay: () => ({
      model: modifyFields(model, { isAutoplay: isAutoplay => !isAutoplay }),
      commands: [SaveAutoplay({ isAutoplay: !model.isAutoplay })],
    }),

    CompletedLoadAutoplay: ({ maybeValue }) => ({
      model: modifyFields(model, {
        isAutoplay: () => parseAutoplay(maybeValue),
      }),
    }),

    ClickedDismissToast: () => ({
      model: modifyFields(model, { maybeSkipToast: () => Option.none() }),
    }),

    CompletedWaitBeforeDismissToast: ({ dismissId }) => ({
      model: modifyFields(model, {
        maybeSkipToast: maybeToast =>
          Option.filter(maybeToast, toast => toast.dismissId !== dismissId),
      }),
    }),

    CompletedApplyPlayback: () => ({ model }),
    CompletedSaveSetlist: () => ({ model }),
    CompletedSaveAutoplay: () => ({ model }),
    CompletedScrollListToTop: () => ({ model }),
    CompletedScrollSetlistToTop: () => ({ model }),
    CompletedFocusQueueHandle: () => ({ model }),
  })
