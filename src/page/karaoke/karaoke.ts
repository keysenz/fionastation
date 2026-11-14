import {
  Array,
  Duration,
  Effect,
  Option,
  Queue,
  Random,
  Record,
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
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { fetchJson, fetchJsonOrFailure } from '../../api'
import {
  KaraokeVideo,
  PlayableSong,
  goneVideoIdsOf,
  songLabel,
  timestampToSeconds,
  toPlayableSongs,
} from '../../domain.ts'
import {
  type LaterNudgeSteps,
  LyricCursor,
  Lyrics,
  Nudges,
  Playhead,
  type Segment,
  cursorAt,
  endSecondsOf,
  msIntoLyrics,
  nudge,
  nudgeOf,
  parseNudges,
  segmentAt,
  segmentOf,
  songBeside,
  toNudgesJson,
} from '../../lyrics.ts'
import { Playlist, PlaylistId } from '../../playlist.ts'
import {
  type LoadFailure,
  PlayerEvent,
  runPlayer,
  seekTo,
  setPlaying,
  setVolume,
  videoEvents,
} from '../../youtube'
import {
  type Layers,
  OVERLAYS,
  classifyChange,
  layersToUrl,
  parseLayers,
} from './layers.ts'
import {
  PlaylistFailure,
  PlaylistOpen,
  playlistFailureOf,
  playlistIdOf,
} from './playlistOpen.ts'
import {
  Advance,
  type Continuation,
  type NowPlaying,
  type PlaylistLoadMode,
  Repeat,
  Setlist,
  Volume,
  applyAdvance,
  applySkip,
  defaultVolume,
  emptySetlist,
  enqueue,
  enqueueAll,
  failLoad,
  firstSongOfEachOtherLiveVideo,
  intentOf,
  loadPlaylist,
  loadRetryDelaySeconds,
  moveInQueue,
  nextRepeat,
  parseVolume,
  pause,
  planAdvance,
  planSkip,
  play,
  playFromQueue,
  playNext,
  playPrevious,
  removeFromQueue,
  reportPaused,
  reportPlaying,
  reportReady,
  resolvePlaylist,
  restoreSaved,
  retryLoad,
  setLevel,
  settleGone,
  toPersistedJson,
  toVolumeJson,
  toggleMute,
  togglePlaying,
} from './setlist.ts'

const STORAGE_KEY = 'karaoke-storage'
const AUTOPLAY_KEY = 'karaoke-autoplay'
const REPEAT_KEY = 'karaoke-repeat'
const VOLUME_KEY = 'karaoke-volume'
const LYRIC_NUDGES_KEY = 'karaoke-lyric-nudges'
const PLAYER_HOST_ID = 'karaoke'
export const SONG_LIST_ID = 'karaoke-song-list'
export const SETLIST_PANE_ID = 'karaoke-setlist-pane'
export const INFO_PANEL_ID = 'karaoke-info-panel'
export const INFO_BUTTON_ID = 'karaoke-info-button'
export const PLAYLIST_PROMPT_ID = 'karaoke-playlist-prompt'
export const REPLACE_CHOICE = '[data-playlist-choice="Replace"]'
export const CANCEL_CHOICE = '[data-playlist-choice="Cancel"]'

// MODEL

const SongsData = AsyncData.Schema(Schema.Array(PlayableSong), Schema.String)

export const LyricsFetch = defineTaggedUnion({
  Loading: { autoRetriesSpent: Schema.Number },
  Loaded: { lyrics: Lyrics },
  Failed: { autoRetriesSpent: Schema.Number, waitId: Schema.Number },
  GaveUp: {},
})
export type LyricsFetch = typeof LyricsFetch.Type

export const Toast = defineTaggedUnion({
  SkippedSongs: {
    firstSkippedTitle: Schema.String,
    skippedCount: Schema.Number,
    dismissId: Schema.Number,
  },
  PlaylistDeleted: { dismissId: Schema.Number },
  PlaylistNotFound: { dismissId: Schema.Number },
  PlaylistUnreachable: { dismissId: Schema.Number },
  PlaylistSongsUnavailable: { count: Schema.Number, dismissId: Schema.Number },
})
export type Toast = typeof Toast.Type

export const QueueDrag = Schema.Struct({
  from: Schema.Number,
  over: Schema.Number,
  // NOTE: a song can end mid-drag and shift the queue, and the indices would then name another song.
  startQueueIds: Schema.Array(Schema.String),
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
  isInfoOpen: Schema.Boolean,
  maybeSkipToast: Schema.Option(Toast),
  playlistOpen: PlaylistOpen,
  goneVideoIds: Schema.Array(Schema.String),
  isAutoplay: Schema.Boolean,
  repeat: Repeat,
  volume: Volume,
  maybeSelectedVideoId: Schema.Option(Schema.String),
  maybeQueueDrag: Schema.Option(QueueDrag),
  maybePlayhead: Schema.Option(Playhead),
  lyricsBySongId: Schema.Record(Schema.String, LyricsFetch),
  lyricsWaitCount: Schema.Number,
  lyricNudges: Nudges,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededFetchSongs: {
    songs: Schema.Array(PlayableSong),
    goneVideoIds: Schema.Array(Schema.String),
  },
  FailedFetchSongs: { error: Schema.String },
  SucceededFetchPlaylist: { playlist: Playlist },
  FailedFetchPlaylist: { id: PlaylistId, failure: PlaylistFailure },
  OpenedPlaylist: { id: PlaylistId },
  LeftPlaylist: {},
  ClickedReplaceQueueWithPlaylist: {},
  ClickedAddPlaylistToQueue: {},
  ClickedCancelPlaylist: {},
  ClickedRetryFetch: {},
  UpdatedSearch: { value: Schema.String },
  ClickedVideo: { videoId: Schema.String },
  ClickedBackToVideos: {},
  ClickedSong: { song: PlayableSong },
  ClickedAddToQueue: { song: PlayableSong },
  ClickedQueueHistory: {},
  ClickedQueuedSong: { index: Schema.Number },
  ClickedRemoveFromQueue: { index: Schema.Number },
  ClickedPlayPause: {},
  ClickedRetryLoad: {},
  ClickedNext: {},
  ClickedPrevious: {},
  ClickedToggleExpanded: {},
  ClickedCollapse: {},
  ClickedQueueHandle: {},
  ClickedToggleInfo: {},
  ClickedCloseInfo: {},
  ClickedDismissToast: {},
  ClickedToggleAutoplay: {},
  ClickedCycleRepeat: {},
  ChangedVolume: { level: Schema.Number },
  ClickedToggleMute: {},
  CompletedLoadVolume: { maybeValue: Schema.Option(Schema.String) },
  CompletedSaveVolume: {},
  CompletedApplyVolume: {},
  CompletedSeekPlayer: {},
  CompletedMountPlayer: {},
  SucceededFetchLyrics: { songId: Schema.String, lyrics: Lyrics },
  FailedFetchLyrics: { songId: Schema.String, error: Schema.String },
  ClickedRetryLyrics: { songId: Schema.String },
  CompletedWaitBeforeRetryLyrics: {
    songId: Schema.String,
    waitId: Schema.Number,
  },
  ClickedNudgeLyrics: { songId: Schema.String, by: Schema.Literals([-1, 1]) },
  ClickedResetLyricsNudge: { songId: Schema.String },
  CompletedLoadLyricNudges: { maybeJson: Schema.Option(Schema.String) },
  CompletedSaveLyricNudges: {},
  ChangedLayers: { search: Schema.String },
  OpenedFromUrl: { search: Schema.String },
  CompletedSyncUrl: {},
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
  CompletedLoadRepeat: { maybeValue: Schema.Option(Schema.String) },
  CompletedSaveRepeat: {},
  CompletedScrollListToTop: {},
  CompletedScrollSetlistToTop: {},
  CompletedFocusQueueHandle: {},
  CompletedFocusInfoPanel: {},
  CompletedFocusInfoButton: {},
  CompletedFocusPlaylistPrompt: {},
  CompletedPickRandomVideo: {
    playId: Schema.Number,
    song: PlayableSong,
  },
  CompletedWaitBeforeDismissToast: { dismissId: Schema.Number },
  CompletedWaitBeforeLoadTimeout: { playId: Schema.Number },
  CompletedWaitBeforeRetryLoad: { playId: Schema.Number },
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

export const FetchPlaylist = Command.define('FetchPlaylist', {
  args: { id: PlaylistId },
  messages: [Message.SucceededFetchPlaylist, Message.FailedFetchPlaylist],
  execute: ({ id }) =>
    fetchJsonOrFailure(`/api/playlists/${id}`, Playlist).pipe(
      Effect.match({
        onFailure: failure =>
          Message.FailedFetchPlaylist({
            id,
            failure: playlistFailureOf(failure),
          }),
        onSuccess: playlist => Message.SucceededFetchPlaylist({ playlist }),
      }),
    ),
})

export const FetchLyrics = Command.define('FetchLyrics', {
  args: { songId: Schema.String },
  messages: [Message.SucceededFetchLyrics, Message.FailedFetchLyrics],
  execute: ({ songId }) =>
    fetchJson(
      `/api/get-lyrics?song=${encodeURIComponent(songId)}`,
      Lyrics,
    ).pipe(
      Effect.match({
        onFailure: error => Message.FailedFetchLyrics({ songId, error }),
        onSuccess: lyrics => Message.SucceededFetchLyrics({ songId, lyrics }),
      }),
    ),
})

const LYRICS_RETRY_DELAY_SECONDS = 15
export const MAX_AUTO_LYRICS_RETRIES = 3

export const WaitBeforeRetryLyrics = Command.define('WaitBeforeRetryLyrics', {
  args: { songId: Schema.String, waitId: Schema.Number },
  messages: [Message.CompletedWaitBeforeRetryLyrics],
  execute: ({ songId, waitId }) =>
    Effect.sleep(Duration.seconds(LYRICS_RETRY_DELAY_SECONDS)).pipe(
      Effect.as(Message.CompletedWaitBeforeRetryLyrics({ songId, waitId })),
    ),
})

export const LoadLyricNudges = Command.define('LoadLyricNudges', {
  messages: [Message.CompletedLoadLyricNudges],
  execute: Effect.try({
    try: () =>
      Option.fromNullishOr(window.localStorage.getItem(LYRIC_NUDGES_KEY)),
    catch: () => 'storage is blocked',
  }).pipe(
    Effect.orElseSucceed(() => Option.none<string>()),
    Effect.map(maybeJson => Message.CompletedLoadLyricNudges({ maybeJson })),
  ),
})

export const SaveLyricNudges = Command.define('SaveLyricNudges', {
  args: { json: Schema.String },
  messages: [Message.CompletedSaveLyricNudges],
  execute: ({ json }) =>
    Effect.try({
      try: () => window.localStorage.setItem(LYRIC_NUDGES_KEY, json),
      catch: () => 'storage is blocked or full',
    }).pipe(Effect.ignore, Effect.as(Message.CompletedSaveLyricNudges())),
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

export const FocusInfoPanel = Command.define('FocusInfoPanel', {
  messages: [Message.CompletedFocusInfoPanel],
  execute: Dom.focus(`#${INFO_PANEL_ID}`).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedFocusInfoPanel()),
  ),
})

export const FocusInfoButton = Command.define('FocusInfoButton', {
  messages: [Message.CompletedFocusInfoButton],
  execute: Dom.focus(`#${INFO_BUTTON_ID}`).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedFocusInfoButton()),
  ),
})

export const FocusPlaylistPrompt = Command.define('FocusPlaylistPrompt', {
  messages: [Message.CompletedFocusPlaylistPrompt],
  execute: Dom.focus(REPLACE_CHOICE).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedFocusPlaylistPrompt()),
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

export const SyncUrl = Command.define('SyncUrl', {
  args: {
    url: Schema.String,
    change: Schema.Literals(['OpenVideo', 'OpenOverlay', 'Replace', 'Close']),
  },
  messages: [Message.CompletedSyncUrl],
  execute: ({ url, change }) =>
    Effect.sync(() => {
      const { history } = window
      const state: unknown = history.state
      const isOurEntry =
        typeof state === 'object' && state !== null && 'fkLayer' in state
      const push = () => history.pushState({ fkLayer: true }, '', url)
      const replace = () => history.replaceState(state, '', url)
      if (change === 'OpenOverlay') {
        push()
      } else if (change === 'OpenVideo') {
        window.matchMedia('(min-width: 768px)').matches ? replace() : push()
      } else if (change === 'Close' && isOurEntry) {
        history.back()
      } else {
        replace()
      }
      return Message.CompletedSyncUrl()
    }),
})

export const SeekPlayer = Command.define('SeekPlayer', {
  args: { seconds: Schema.Number },
  messages: [Message.CompletedSeekPlayer],
  execute: ({ seconds }) =>
    seekTo(PLAYER_HOST_ID, seconds).pipe(
      Effect.as(Message.CompletedSeekPlayer()),
    ),
})

export const ApplyVolume = Command.define('ApplyVolume', {
  args: { level: Schema.Number, isMuted: Schema.Boolean },
  messages: [Message.CompletedApplyVolume],
  execute: ({ level, isMuted }) =>
    setVolume(PLAYER_HOST_ID, level, isMuted).pipe(
      Effect.as(Message.CompletedApplyVolume()),
    ),
})

export const LoadVolume = Command.define('LoadVolume', {
  messages: [Message.CompletedLoadVolume],
  execute: Effect.try({
    try: () => Option.fromNullishOr(window.localStorage.getItem(VOLUME_KEY)),
    catch: () => 'storage is blocked',
  }).pipe(
    Effect.orElseSucceed(() => Option.none<string>()),
    Effect.map(maybeValue => Message.CompletedLoadVolume({ maybeValue })),
  ),
})

export const SaveVolume = Command.define('SaveVolume', {
  args: { volume: Volume },
  messages: [Message.CompletedSaveVolume],
  execute: ({ volume }) =>
    Effect.try({
      try: () => window.localStorage.setItem(VOLUME_KEY, toVolumeJson(volume)),
      catch: () => 'storage is blocked or full',
    }).pipe(Effect.ignore, Effect.as(Message.CompletedSaveVolume())),
})

export const LoadRepeat = Command.define('LoadRepeat', {
  messages: [Message.CompletedLoadRepeat],
  execute: Effect.try({
    try: () => Option.fromNullishOr(window.localStorage.getItem(REPEAT_KEY)),
    catch: () => 'storage is blocked',
  }).pipe(
    Effect.orElseSucceed(() => Option.none<string>()),
    Effect.map(maybeValue => Message.CompletedLoadRepeat({ maybeValue })),
  ),
})

export const SaveRepeat = Command.define('SaveRepeat', {
  args: { repeat: Repeat },
  messages: [Message.CompletedSaveRepeat],
  execute: ({ repeat }) =>
    Effect.try({
      try: () => window.localStorage.setItem(REPEAT_KEY, repeat),
      catch: () => 'storage is blocked or full',
    }).pipe(Effect.ignore, Effect.as(Message.CompletedSaveRepeat())),
})

export const PickRandomVideo = Command.define('PickRandomVideo', {
  args: {
    playId: Schema.Number,
    candidates: Schema.NonEmptyArray(PlayableSong),
  },
  messages: [Message.CompletedPickRandomVideo],
  execute: ({ playId, candidates }) =>
    Random.choice(candidates).pipe(
      Effect.map(song => Message.CompletedPickRandomVideo({ playId, song })),
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

// NOTE: a player that never appears and a video that never starts loading send no event at all, so a play that is still loading after this long counts as a failed load. The length is a judgment, not a measurement: too short reloads a video that was only slow.
const LOAD_TIMEOUT_SECONDS = 20

export const WaitBeforeLoadTimeout = Command.define('WaitBeforeLoadTimeout', {
  args: { playId: Schema.Number },
  messages: [Message.CompletedWaitBeforeLoadTimeout],
  execute: ({ playId }) =>
    Effect.sleep(Duration.seconds(LOAD_TIMEOUT_SECONDS)).pipe(
      Effect.as(Message.CompletedWaitBeforeLoadTimeout({ playId })),
    ),
})

export const WaitBeforeRetryLoad = Command.define('WaitBeforeRetryLoad', {
  args: { playId: Schema.Number, delaySeconds: Schema.Number },
  messages: [Message.CompletedWaitBeforeRetryLoad],
  execute: ({ playId, delaySeconds }) =>
    Effect.sleep(Duration.seconds(delaySeconds)).pipe(
      Effect.as(Message.CompletedWaitBeforeRetryLoad({ playId })),
    ),
})

export const MountPlayer = Mount.define('MountPlayer', {
  messages: [Message.CompletedMountPlayer],
  execute: ({ element }) =>
    runPlayer(element, {
      hostId: PLAYER_HOST_ID,
      playerVars: { controls: 1, modestbranding: 1 },
    }).pipe(Effect.as(Message.CompletedMountPlayer())),
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

const PlayerLoad = Schema.Struct({
  playId: Schema.Number,
  videoId: Schema.String,
  startSeconds: Schema.Number,
})

export const subscriptions = Subscription.make<Model, Message>()(entry => ({
  nowPlayingVideo: entry(
    { maybeLoad: Schema.Option(PlayerLoad) },
    {
      modelToDependencies: model => ({
        maybeLoad: Option.map(
          model.setlist.maybeNowPlaying,
          ({ playId, song }) => ({
            playId,
            videoId: song.video_url,
            startSeconds: timestampToSeconds(song.timestamp),
          }),
        ),
      }),
      dependenciesToStream: ({ maybeLoad }) =>
        Option.match(maybeLoad, {
          onNone: () => Stream.empty,
          onSome: ({ playId, videoId, startSeconds }) =>
            videoEvents(PLAYER_HOST_ID, { videoId, startSeconds }).pipe(
              Stream.map(event =>
                Message.ReceivedPlayerEvent({ playId, event }),
              ),
            ),
        }),
    },
  ),
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
  isInfoOpen: false,
  maybeSkipToast: Option.none(),
  playlistOpen: PlaylistOpen.Idle(),
  goneVideoIds: [],
  isAutoplay: true,
  repeat: 'Off',
  volume: defaultVolume,
  maybeSelectedVideoId: Option.none(),
  maybeQueueDrag: Option.none(),
  maybePlayhead: Option.none(),
  lyricsBySongId: {},
  lyricsWaitCount: 0,
  lyricNudges: {},
})

export type UpdateReturn = Update.Return<Model, Message>

const queueIds = (model: Model): ReadonlyArray<string> =>
  model.setlist.queue.map(song => song.id)

const fetchIfNeeded = (model: Model): UpdateReturn =>
  Option.match(AsyncData.revalidateOrLoad(model.songs), {
    onNone: () => ({ model }),
    onSome: songs => ({
      model: modifyFields(model, { songs: () => songs }),
      commands: [FetchSongs()],
    }),
  })

export const openedPlaylistNameOf = (model: Model): Option.Option<string> =>
  PlaylistOpen.matchOrElse(
    model.playlistOpen,
    {
      Opened: ({ id, name }) =>
        Option.contains(model.setlist.maybeOpenedPlaylistId, id)
          ? Option.some<string>(name)
          : Option.none(),
    },
    () => Option.none(),
  )

export const openedPlaylist = (model: Model, id: PlaylistId): UpdateReturn =>
  update(model, Message.OpenedPlaylist({ id }))

export const leftPlaylist = (model: Model): UpdateReturn =>
  update(model, Message.LeftPlaylist())

/** Rereads saved data on every visit, because another tab may have changed the queue. */
export const entered = (model: Model): UpdateReturn => {
  const fetched = fetchIfNeeded(model)
  return {
    model: fetched.model,
    commands: [
      LoadSavedSetlist(),
      LoadAutoplay(),
      LoadRepeat(),
      LoadVolume(),
      LoadLyricNudges(),
      ...(fetched.commands ?? []),
    ],
  }
}

// UPDATE

export const allSongs = (model: Model): ReadonlyArray<PlayableSong> =>
  Option.getOrElse(AsyncData.getData(model.songs), () => [])

export type NowSinging = Readonly<{
  segment: Segment
  maybeLyrics: Option.Option<LyricsFetch>
  nudge: LaterNudgeSteps
  maybeCursor: Option.Option<LyricCursor>
}>

const playheadOf = (
  model: Model,
  nowPlaying: NowPlaying,
): Option.Option<Playhead> =>
  Option.filter(
    model.maybePlayhead,
    ({ playId }) => playId === nowPlaying.playId,
  )

/** The song the bar names: the one being sung, or the one that was clicked. */
export const songOnBar = (model: Model, nowPlaying: NowPlaying): PlayableSong =>
  Option.match(nowSingingOf(model), {
    onNone: () => nowPlaying.song,
    onSome: ({ segment }) => segment.song,
  })

export const nowSingingOf = (model: Model): Option.Option<NowSinging> =>
  Option.gen(function* () {
    const nowPlaying = yield* model.setlist.maybeNowPlaying
    const playhead = yield* playheadOf(model, nowPlaying)
    const segment = yield* segmentAt(
      allSongs(model),
      nowPlaying.song,
      playhead.seconds,
    )
    const maybeLyrics = Record.get(model.lyricsBySongId, segment.song.id)
    const nudgeSteps = nudgeOf(model.lyricNudges, segment.song.id)
    const maybeCursor = Option.flatMap(
      Option.flatMap(maybeLyrics, loadedLyricsOf),
      lyrics =>
        Lyrics.match(lyrics, {
          Synced: ({ lines, offsetMs }) =>
            Option.some(
              cursorAt(
                lines,
                msIntoLyrics(playhead.seconds, segment, offsetMs, nudgeSteps),
              ),
            ),
          Missing: () => Option.none(),
        }),
    )
    return { segment, maybeLyrics, nudge: nudgeSteps, maybeCursor }
  })

const seekBeside = (
  model: Model,
  by: 1 | -1,
  otherwise: () => UpdateReturn,
): UpdateReturn =>
  Option.match(
    Option.flatMap(
      Option.filter(model.setlist.maybeNowPlaying, ({ phase }) =>
        Option.isSome(intentOf(phase)),
      ),
      nowPlaying =>
        Option.map(
          songBeside(
            allSongs(model),
            nowPlaying.song,
            Option.map(playheadOf(model, nowPlaying), ({ seconds }) => seconds),
            by,
          ),
          song => ({ song, nowPlaying }),
        ),
    ),
    {
      onNone: otherwise,
      onSome: ({ song, nowPlaying }) => {
        const seconds = timestampToSeconds(song.timestamp)
        const moved = progressed(model, nowPlaying.playId, seconds)
        return {
          model: moved.model,
          commands: [...(moved.commands ?? []), SeekPlayer({ seconds })],
        }
      },
    },
  )

export const loadedLyricsOf = (fetch: LyricsFetch): Option.Option<Lyrics> =>
  LyricsFetch.matchOrElse(
    fetch,
    { Loaded: ({ lyrics }) => Option.some(lyrics) },
    () => Option.none(),
  )

const setLyrics = (model: Model, songId: string, fetch: LyricsFetch): Model =>
  modifyFields(model, {
    lyricsBySongId: known => Record.set(known, songId, fetch),
  })

const fetchLyrics = (
  model: Model,
  songId: string,
  autoRetriesSpent: number,
): UpdateReturn => ({
  model: setLyrics(model, songId, LyricsFetch.Loading({ autoRetriesSpent })),
  commands: [FetchLyrics({ songId })],
})

const isBeforeSongEnd = (model: Model, songId: string): boolean =>
  Option.exists(model.setlist.maybeNowPlaying, nowPlaying =>
    Option.exists(
      segmentOf(allSongs(model), nowPlaying.song, songId),
      segment =>
        Option.match(playheadOf(model, nowPlaying), {
          onNone: () => timestampToSeconds(nowPlaying.song.timestamp),
          onSome: ({ seconds }) => seconds,
        }) < endSecondsOf(segment),
    ),
  )

const failLyrics = (
  model: Model,
  songId: string,
  autoRetriesSpent: number,
): UpdateReturn => {
  if (
    autoRetriesSpent >= MAX_AUTO_LYRICS_RETRIES ||
    !isBeforeSongEnd(model, songId)
  ) {
    return { model: setLyrics(model, songId, LyricsFetch.GaveUp()) }
  }
  const waitId = model.lyricsWaitCount + 1
  return {
    model: modifyFields(
      setLyrics(
        model,
        songId,
        LyricsFetch.Failed({ autoRetriesSpent, waitId }),
      ),
      { lyricsWaitCount: () => waitId },
    ),
    commands: [WaitBeforeRetryLyrics({ songId, waitId })],
  }
}

const giveUpEndedRetries = (model: Model): Model =>
  modifyFields(model, {
    lyricsBySongId: known =>
      Record.map(known, (fetch, songId) =>
        LyricsFetch.guards.Failed(fetch) && !isBeforeSongEnd(model, songId)
          ? LyricsFetch.GaveUp()
          : fetch,
      ),
  })

const ensureLyrics = (
  model: Model,
  previousIds: ReadonlyArray<string>,
): UpdateReturn => {
  const toFetch = currentAndNextSongIds(model).filter(id =>
    Option.match(Record.get(model.lyricsBySongId, id), {
      onNone: () => true,
      onSome: fetch =>
        !previousIds.includes(id) &&
        LyricsFetch.isAnyOf(['Failed', 'GaveUp'])(fetch),
    }),
  )
  return {
    model: toFetch.reduce(
      (fetching, songId) =>
        setLyrics(
          fetching,
          songId,
          LyricsFetch.Loading({ autoRetriesSpent: 0 }),
        ),
      model,
    ),
    commands: toFetch.map(songId => FetchLyrics({ songId })),
  }
}

const currentAndNextSongIds = (model: Model): ReadonlyArray<string> =>
  Option.match(nowSingingOf(model), {
    onNone: () => [],
    onSome: ({ segment }) => [
      segment.song.id,
      ...Option.toArray(
        Option.map(
          songBeside(allSongs(model), segment.song, Option.none(), 1),
          song => song.id,
        ),
      ),
    ],
  })

const progressed = (
  model: Model,
  playId: number,
  seconds: number,
): UpdateReturn => {
  const moved = modifyFields(model, {
    maybePlayhead: () => Option.some({ playId, seconds }),
  })
  return ensureLyrics(moved, currentAndNextSongIds(model))
}

const continuationOf = (model: Model): Continuation => {
  const goneIds = new Set(model.goneVideoIds)
  return {
    archive: allSongs(model),
    isGone: song => goneIds.has(song.video_url),
    isAutoplay: model.isAutoplay,
    repeat: model.repeat,
  }
}

const pickAnotherVideo = (
  model: Model,
  onNoneLeft: () => UpdateReturn,
): UpdateReturn =>
  Option.match(model.setlist.maybeNowPlaying, {
    onNone: () => ({ model }),
    onSome: ({ playId, song }) =>
      Array.match(firstSongOfEachOtherLiveVideo(continuationOf(model), song), {
        onEmpty: onNoneLeft,
        onNonEmpty: candidates => ({
          model,
          commands: [PickRandomVideo({ playId, candidates })],
        }),
      }),
  })

/** Only a saved "false" turns autoplay off, so missing or corrupt data keeps it on. */
const parseAutoplay = (maybeValue: Option.Option<string>): boolean =>
  !Option.contains(maybeValue, 'false')

export const layersOf = (model: Model): Layers => ({
  maybeVideoId: model.maybeSelectedVideoId,
  overlays: OVERLAYS.filter(overlay =>
    overlay === 'queue'
      ? model.isQueueOpen
      : overlay === 'player'
        ? model.isExpanded
        : model.isInfoOpen,
  ),
})

const applyLayers = ({ maybeVideoId, overlays }: Layers) => ({
  maybeSelectedVideoId: () => maybeVideoId,
  isQueueOpen: () => overlays.includes('queue'),
  isExpanded: () => overlays.includes('player'),
  isInfoOpen: () => overlays.includes('info'),
})

const changeNudges = (model: Model, nudges: Nudges): UpdateReturn => ({
  model: modifyFields(model, { lyricNudges: () => nudges }),
  commands: [SaveLyricNudges({ json: toNudgesJson(nudges) })],
})

const changeVolume = (model: Model, volume: Volume): UpdateReturn => ({
  model: modifyFields(model, { volume: () => volume }),
  commands: [ApplyVolume(volume), SaveVolume({ volume })],
})

/** Anything but a saved mode name means Off, so corrupt data repeats nothing. */
const parseRepeat = (maybeValue: Option.Option<string>): Repeat =>
  Option.getOrElse(
    Option.flatMap(maybeValue, Schema.decodeUnknownOption(Repeat)),
    () => 'Off',
  )

/** What the visitor asks for goes through here, which saves it and tells the
 *  player. A player's own reports must not, because telling a player what it
 *  just reported would echo. A new play needs no player Command, because the
 *  `nowPlayingVideo` subscription loads its video. */
const changeSetlist = (model: Model, setlist: Setlist): UpdateReturn => {
  const playbackCommand = Option.flatMap(
    Option.all({
      before: model.setlist.maybeNowPlaying,
      after: setlist.maybeNowPlaying,
    }),
    ({ before, after }) =>
      before.playId === after.playId
        ? Option.flatMap(intentOf(after.phase), intent =>
            Option.contains(intentOf(before.phase), intent)
              ? Option.none()
              : Option.some(ApplyPlayback({ isPlaying: intent === 'Playing' })),
          )
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
  maybeToast: Option.Option<Toast>,
  failedTitle: string,
  dismissId: number,
): Toast =>
  Option.match(Option.filter(maybeToast, Toast.guards.SkippedSongs), {
    onNone: () =>
      Toast.SkippedSongs({
        firstSkippedTitle: failedTitle,
        skippedCount: 1,
        dismissId,
      }),
    onSome: toast =>
      Toast.SkippedSongs({
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

const withToast = (
  result: UpdateReturn,
  makeToast: (dismissId: number) => Toast,
): UpdateReturn => {
  const dismissId = result.model.setlist.playCount
  return {
    model: modifyFields(result.model, {
      maybeSkipToast: () => Option.some(makeToast(dismissId)),
    }),
    commands: [
      ...(result.commands ?? []),
      WaitBeforeDismissToast({ dismissId }),
    ],
  }
}

/** The load of the current play failed. It is tried again by itself after a
 *  wait, while automatic retries are left. */
const failCurrentLoad = (
  model: Model,
  { playId, attempt }: NowPlaying,
  reason: LoadFailure,
): UpdateReturn => ({
  model: modifyFields(model, {
    setlist: setlist => failLoad(setlist, reason),
  }),
  commands: Option.toArray(
    Option.map(loadRetryDelaySeconds(attempt), delaySeconds =>
      WaitBeforeRetryLoad({ playId, delaySeconds }),
    ),
  ),
})

/** Loads the song on the bar again, which only a failed load allows. The new
 *  playId makes the older retry timer stale. */
const retryCurrentLoad = (
  model: Model,
  by: 'Visitor' | 'Timer',
): UpdateReturn =>
  Option.match(model.setlist.maybeNowPlaying, {
    onNone: () => ({ model }),
    onSome: nowPlaying => ({
      model: modifyFields(model, {
        setlist: setlist =>
          retryLoad(setlist, songOnBar(model, nowPlaying), by),
      }),
    }),
  })

const currentPlay = (model: Model, playId: number): Option.Option<NowPlaying> =>
  Option.filter(
    model.setlist.maybeNowPlaying,
    nowPlaying => nowPlaying.playId === playId,
  )

/** YouTube no longer has the video, so it is remembered as gone and the radio
 *  moves on: to the queue head, to a random other video, or nowhere. */
const skipGoneVideo = (
  model: Model,
  { playId, song: goneSong }: NowPlaying,
): UpdateReturn => {
  const goneModel = modifyFields(model, {
    goneVideoIds: known => Array.dedupe([...known, goneSong.video_url]),
  })
  const { cleaned, advance } = planSkip(
    goneModel.setlist,
    continuationOf(goneModel),
  )
  const setlist = applySkip(cleaned, advance)
  const skipped = modifyFields(goneModel, { setlist: () => setlist })
  const saveSetlist = SaveSetlist({ json: toPersistedJson(setlist) })
  return Advance.matchOrElse(
    advance,
    {
      PickRandomVideo: ({ candidates }) => ({
        model: skipped,
        commands: [saveSetlist, PickRandomVideo({ playId, candidates })],
      }),
    },
    () =>
      Option.match(
        Option.filter(
          setlist.maybeNowPlaying,
          after => after.playId !== playId,
        ),
        {
          onNone: () => ({ model: skipped, commands: [saveSetlist] }),
          onSome: ({ playId: dismissId }) => ({
            model: withSkipToast(skipped, songLabel(goneSong), dismissId),
            commands: [saveSetlist, WaitBeforeDismissToast({ dismissId })],
          }),
        },
      ),
  )
}

const failureToasts: Record<PlaylistFailure, (dismissId: number) => Toast> = {
  Deleted: dismissId => Toast.PlaylistDeleted({ dismissId }),
  NotFound: dismissId => Toast.PlaylistNotFound({ dismissId }),
  Unreachable: dismissId => Toast.PlaylistUnreachable({ dismissId }),
}

const failPlaylist = (model: Model, failure: PlaylistFailure): UpdateReturn => {
  const idle = modifyFields(model, { playlistOpen: () => PlaylistOpen.Idle() })
  return withToast(
    failure === 'Unreachable'
      ? { model: idle }
      : {
          model: idle,
          commands: [
            SyncUrl({ url: layersToUrl(layersOf(idle)), change: 'Replace' }),
          ],
        },
    failureToasts[failure],
  )
}

const startPlaylist = (
  model: Model,
  open: Extract<PlaylistOpen, { _tag: 'Asking' }>,
  mode: PlaylistLoadMode,
): UpdateReturn => {
  const opened = modifyFields(model, {
    playlistOpen: () => PlaylistOpen.Opened({ id: open.id, name: open.name }),
  })
  const loaded = changeSetlist(
    opened,
    loadPlaylist(opened.setlist, open.songs, mode, open.id),
  )
  return open.unavailableCount > 0
    ? withToast(loaded, dismissId =>
        Toast.PlaylistSongsUnavailable({
          count: open.unavailableCount,
          dismissId,
        }),
      )
    : loaded
}

const isBusy = (setlist: Setlist): boolean =>
  setlist.queue.length > 0 || Option.isSome(setlist.maybeNowPlaying)

const closePlaylistQuestion = (result: UpdateReturn): UpdateReturn => ({
  model: result.model,
  commands: [...(result.commands ?? []), FocusInfoButton()],
})

const settlePlaylist = (model: Model): UpdateReturn =>
  PlaylistOpen.matchOrElse(
    model.playlistOpen,
    {
      Fetched: ({ playlist }) =>
        Option.match(AsyncData.getData(model.songs), {
          onNone: () => ({ model }),
          onSome: archive => {
            const { songs, unavailableCount } = resolvePlaylist(
              playlist.entries,
              archive,
              continuationOf(model).isGone,
            )
            return Array.match(songs, {
              onEmpty: () =>
                withToast(
                  {
                    model: modifyFields(model, {
                      playlistOpen: () => PlaylistOpen.Idle(),
                    }),
                  },
                  dismissId =>
                    Toast.PlaylistSongsUnavailable({
                      count: unavailableCount,
                      dismissId,
                    }),
                ),
              onNonEmpty: nonEmptySongs => {
                const asking = PlaylistOpen.Asking({
                  id: playlist.id,
                  name: playlist.name,
                  songs: nonEmptySongs,
                  unavailableCount,
                })
                if (!isBusy(model.setlist)) {
                  return startPlaylist(model, asking, 'Replace')
                }
                return Option.contains(
                  model.setlist.maybeOpenedPlaylistId,
                  playlist.id,
                )
                  ? {
                      model: modifyFields(model, {
                        playlistOpen: () =>
                          PlaylistOpen.Opened({
                            id: playlist.id,
                            name: playlist.name,
                          }),
                      }),
                    }
                  : {
                      model: modifyFields(model, {
                        playlistOpen: () => asking,
                      }),
                      commands: [FocusPlaylistPrompt()],
                    }
              },
            })
          },
        }),
    },
    () => ({ model }),
  )

const answerPlaylist = (model: Model, mode: PlaylistLoadMode): UpdateReturn =>
  PlaylistOpen.matchOrElse(
    model.playlistOpen,
    {
      Asking: asking =>
        closePlaylistQuestion(startPlaylist(model, asking, mode)),
    },
    () => ({ model }),
  )

const updateModel = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    SucceededFetchSongs: ({ songs, goneVideoIds }) =>
      settlePlaylist(
        modifyFields(model, {
          songs: current => AsyncData.settle(current, Result.succeed(songs)),
          goneVideoIds: known => Array.dedupe([...known, ...goneVideoIds]),
        }),
      ),

    FailedFetchSongs: ({ error }) => ({
      model: modifyFields(model, {
        songs: current => AsyncData.settle(current, Result.fail(error)),
      }),
    }),

    OpenedPlaylist: ({ id }) =>
      Option.contains(playlistIdOf(model.playlistOpen), id) &&
      (!PlaylistOpen.guards.Opened(model.playlistOpen) ||
        Option.contains(model.setlist.maybeOpenedPlaylistId, id))
        ? { model }
        : {
            model: modifyFields(model, {
              playlistOpen: () => PlaylistOpen.AwaitingSavedSetlist({ id }),
            }),
          },

    LeftPlaylist: () =>
      PlaylistOpen.guards.Opened(model.playlistOpen)
        ? { model }
        : {
            model: modifyFields(model, {
              playlistOpen: () => PlaylistOpen.Idle(),
            }),
          },

    SucceededFetchPlaylist: ({ playlist }) =>
      PlaylistOpen.matchOrElse(
        model.playlistOpen,
        {
          Fetching: ({ id }) =>
            id === playlist.id
              ? settlePlaylist(
                  modifyFields(model, {
                    playlistOpen: () => PlaylistOpen.Fetched({ playlist }),
                  }),
                )
              : { model },
        },
        () => ({ model }),
      ),

    FailedFetchPlaylist: ({ id, failure }) =>
      PlaylistOpen.matchOrElse(
        model.playlistOpen,
        {
          Fetching: fetching =>
            fetching.id === id ? failPlaylist(model, failure) : { model },
        },
        () => ({ model }),
      ),

    ClickedReplaceQueueWithPlaylist: () => answerPlaylist(model, 'Replace'),

    ClickedAddPlaylistToQueue: () => answerPlaylist(model, 'Append'),

    ClickedCancelPlaylist: () =>
      PlaylistOpen.guards.Asking(model.playlistOpen)
        ? closePlaylistQuestion({
            model: modifyFields(model, {
              playlistOpen: () => PlaylistOpen.Idle(),
            }),
          })
        : { model },

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

    ClickedSong: ({ song }) =>
      Option.match(
        Option.filter(
          model.setlist.maybeNowPlaying,
          nowPlaying => nowPlaying.song.id === song.id,
        ),
        {
          onNone: () => changeSetlist(model, play(model.setlist, song)),
          onSome: ({ phase }) =>
            phase._tag === 'LoadFailed'
              ? {
                  model: modifyFields(model, {
                    setlist: setlist => retryLoad(setlist, song, 'Visitor'),
                  }),
                }
              : changeSetlist(model, togglePlaying(model.setlist)),
        },
      ),

    ClickedAddToQueue: ({ song }) =>
      changeSetlist(model, enqueue(model.setlist, song)),

    ClickedQueueHistory: () => {
      const queued = enqueueAll(
        model.setlist,
        Array.reverse(model.setlist.history),
      )
      return queued === model.setlist ? { model } : changeSetlist(model, queued)
    },

    ClickedQueuedSong: ({ index }) => {
      const played = playFromQueue(model.setlist, index)
      return played === model.setlist ? { model } : changeSetlist(model, played)
    },

    ClickedRemoveFromQueue: ({ index }) => {
      const removed = removeFromQueue(model.setlist, index)
      return removed === model.setlist
        ? { model }
        : changeSetlist(model, removed)
    },

    StartedQueueDrag: ({ index }) => ({
      model: modifyFields(model, {
        maybeQueueDrag: () =>
          Option.some({
            from: index,
            over: index,
            startQueueIds: queueIds(model),
          }),
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
        onSome: ({ from, startQueueIds }) => {
          const cleared = modifyFields(model, {
            maybeQueueDrag: () => Option.none(),
          })
          const moved = Array.makeEquivalence(
            (x: string, y: string) => x === y,
          )(startQueueIds, queueIds(model))
            ? moveInQueue(model.setlist, from, index)
            : model.setlist
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
    ClickedRetryLoad: () => retryCurrentLoad(model, 'Visitor'),
    ClickedNext: () =>
      Array.isReadonlyArrayNonEmpty(model.setlist.queue)
        ? changeSetlist(model, playNext(model.setlist, model.repeat))
        : seekBeside(model, 1, () =>
            pickAnotherVideo(model, () => ({ model })),
          ),
    ClickedPrevious: () =>
      seekBeside(model, -1, () =>
        changeSetlist(model, playPrevious(model.setlist)),
      ),

    ClickedToggleExpanded: () => ({
      model: modifyFields(model, { isExpanded: isExpanded => !isExpanded }),
    }),
    ClickedCollapse: () => ({
      model: modifyFields(model, { isExpanded: () => false }),
    }),
    ClickedQueueHandle: () => ({
      model: modifyFields(model, { isQueueOpen: isOpen => !isOpen }),
    }),
    ClickedToggleInfo: () =>
      model.isInfoOpen
        ? {
            model: modifyFields(model, { isInfoOpen: () => false }),
            commands: [FocusInfoButton()],
          }
        : {
            model: modifyFields(model, { isInfoOpen: () => true }),
            commands: [FocusInfoPanel()],
          },
    ClickedCloseInfo: () =>
      model.isInfoOpen
        ? {
            model: modifyFields(model, { isInfoOpen: () => false }),
            commands: [FocusInfoButton()],
          }
        : { model },

    // NOTE: the previous play's video can still have events on their way, and acting on a late end would skip a song.
    // A video that failed keeps reporting too, so a play that cannot sound hears only that its stream is gone.
    ReceivedPlayerEvent: ({ playId, event }) =>
      Option.match(
        Option.filter(
          model.setlist.maybeNowPlaying,
          nowPlaying => nowPlaying.playId === playId,
        ),
        {
          onNone: () => ({ model }),
          onSome: nowPlaying =>
            Option.match(intentOf(nowPlaying.phase), {
              onNone: () =>
                nowPlaying.phase._tag === 'LoadFailed'
                  ? PlayerEvent.matchOrElse<UpdateReturn>(
                      event,
                      {
                        VideoGone: () => skipGoneVideo(model, nowPlaying),
                        Playing: () =>
                          recordFromPlayer(model, reportPlaying(model.setlist)),
                      },
                      () => ({ model }),
                    )
                  : { model },
              onSome: intent =>
                PlayerEvent.match<UpdateReturn>(event, {
                  Ready: () => ({
                    model: modifyFields(model, { setlist: reportReady }),
                    // NOTE: loading a video starts it, and a play call while it seeks to the song's start can start it from 0.
                    commands:
                      intent === 'Paused'
                        ? [
                            ApplyPlayback({ isPlaying: false }),
                            ApplyVolume(model.volume),
                          ]
                        : [ApplyVolume(model.volume)],
                  }),
                  Playing: () =>
                    recordFromPlayer(model, reportPlaying(model.setlist)),
                  Paused: () =>
                    recordFromPlayer(model, reportPaused(model.setlist)),
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
                          commands: [PickRandomVideo({ playId, candidates })],
                        }),
                      },
                      () =>
                        changeSetlist(
                          model,
                          applyAdvance(model.setlist, advance, model.repeat),
                        ),
                    )
                  },
                  VideoGone: () => skipGoneVideo(model, nowPlaying),
                  LoadFailed: ({ reason }) =>
                    failCurrentLoad(model, nowPlaying, reason),
                  Progressed: ({ seconds }) =>
                    progressed(model, playId, seconds),
                }),
            }),
        },
      ),

    // NOTE: a click while the pick was pending changed the playId, and the visitor's choice wins.
    // A refetch can report the picked video gone after the pick was asked for, so it is drawn again.
    CompletedPickRandomVideo: ({ playId, song }) =>
      Option.match(
        Option.filter(
          model.setlist.maybeNowPlaying,
          nowPlaying => nowPlaying.playId === playId,
        ),
        {
          onNone: () => ({ model }),
          onSome: ({ song: previousSong, phase }) => {
            if (continuationOf(model).isGone(song)) {
              return pickAnotherVideo(model, () =>
                Option.isSome(intentOf(phase))
                  ? changeSetlist(model, pause(model.setlist))
                  : { model: modifyFields(model, { setlist: settleGone }) },
              )
            }
            const setlist = play(model.setlist, song)
            const saveSetlist = SaveSetlist({ json: toPersistedJson(setlist) })
            const dismissId = setlist.playCount
            return phase._tag === 'MovingOn'
              ? {
                  model: withSkipToast(
                    modifyFields(model, { setlist: () => setlist }),
                    songLabel(previousSong),
                    dismissId,
                  ),
                  commands: [
                    saveSetlist,
                    WaitBeforeDismissToast({ dismissId }),
                  ],
                }
              : {
                  model: modifyFields(model, { setlist: () => setlist }),
                  commands: [saveSetlist],
                }
          },
        },
      ),

    // NOTE: a retry or a click since the timer started changed the playId, so a late timer does nothing.
    CompletedWaitBeforeRetryLoad: ({ playId }) =>
      Option.match(currentPlay(model, playId), {
        onNone: () => ({ model }),
        onSome: () => retryCurrentLoad(model, 'Timer'),
      }),

    CompletedWaitBeforeLoadTimeout: ({ playId }) =>
      Option.match(currentPlay(model, playId), {
        onNone: () => ({ model }),
        onSome: nowPlaying =>
          nowPlaying.phase._tag === 'Loading'
            ? failCurrentLoad(model, nowPlaying, 'PlayerUnavailable')
            : { model },
      }),

    CompletedLoadSavedSetlist: ({ maybeJson }) => {
      const restored = modifyFields(model, {
        setlist: setlist => restoreSaved(setlist, maybeJson),
      })
      return PlaylistOpen.matchOrElse(
        model.playlistOpen,
        {
          AwaitingSavedSetlist: ({ id }) => ({
            model: modifyFields(restored, {
              playlistOpen: () => PlaylistOpen.Fetching({ id }),
            }),
            commands: [FetchPlaylist({ id })],
          }),
        },
        () => ({ model: restored }),
      )
    },

    ClickedToggleAutoplay: () => ({
      model: modifyFields(model, { isAutoplay: isAutoplay => !isAutoplay }),
      commands: [SaveAutoplay({ isAutoplay: !model.isAutoplay })],
    }),

    CompletedLoadAutoplay: ({ maybeValue }) => ({
      model: modifyFields(model, {
        isAutoplay: () => parseAutoplay(maybeValue),
      }),
    }),

    ClickedCycleRepeat: () => ({
      model: modifyFields(model, { repeat: nextRepeat }),
      commands: [SaveRepeat({ repeat: nextRepeat(model.repeat) })],
    }),

    ChangedVolume: ({ level }) =>
      changeVolume(model, setLevel(model.volume, level)),

    ClickedToggleMute: () => changeVolume(model, toggleMute(model.volume)),

    CompletedLoadVolume: ({ maybeValue }) => ({
      model: modifyFields(model, { volume: () => parseVolume(maybeValue) }),
      commands: [ApplyVolume(parseVolume(maybeValue))],
    }),

    CompletedSaveVolume: () => ({ model }),
    CompletedApplyVolume: () => ({ model }),
    CompletedSeekPlayer: () => ({ model }),
    CompletedMountPlayer: () => ({ model }),

    SucceededFetchLyrics: ({ songId, lyrics }) => ({
      model: setLyrics(model, songId, LyricsFetch.Loaded({ lyrics })),
    }),

    FailedFetchLyrics: ({ songId }) =>
      Option.match(
        Option.filter(
          Record.get(model.lyricsBySongId, songId),
          LyricsFetch.guards.Loading,
        ),
        {
          onNone: () => ({ model }),
          onSome: ({ autoRetriesSpent }) =>
            failLyrics(model, songId, autoRetriesSpent),
        },
      ),

    CompletedWaitBeforeRetryLyrics: ({ songId, waitId }) =>
      Option.match(
        Option.filter(
          Option.filter(
            Record.get(model.lyricsBySongId, songId),
            LyricsFetch.guards.Failed,
          ),
          failed => failed.waitId === waitId,
        ),
        {
          onNone: () => ({ model }),
          onSome: ({ autoRetriesSpent }) =>
            fetchLyrics(model, songId, autoRetriesSpent + 1),
        },
      ),

    ClickedRetryLyrics: ({ songId }) =>
      Option.exists(
        Record.get(model.lyricsBySongId, songId),
        LyricsFetch.isAnyOf(['Failed', 'GaveUp']),
      )
        ? fetchLyrics(model, songId, 0)
        : { model },

    ClickedNudgeLyrics: ({ songId, by }) =>
      changeNudges(model, nudge(model.lyricNudges, songId, by)),

    ClickedResetLyricsNudge: ({ songId }) =>
      changeNudges(model, Record.remove(model.lyricNudges, songId)),

    CompletedLoadLyricNudges: ({ maybeJson }) => ({
      model: modifyFields(model, { lyricNudges: () => parseNudges(maybeJson) }),
    }),

    CompletedSaveLyricNudges: () => ({ model }),

    CompletedLoadRepeat: ({ maybeValue }) => ({
      model: modifyFields(model, { repeat: () => parseRepeat(maybeValue) }),
    }),

    ChangedLayers: ({ search }) => ({
      model: modifyFields(model, applyLayers(parseLayers(search))),
    }),

    OpenedFromUrl: ({ search }) => ({
      model: modifyFields(model, {
        maybeSelectedVideoId: () => parseLayers(search).maybeVideoId,
      }),
    }),

    CompletedSyncUrl: () => ({ model }),

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
    CompletedSaveRepeat: () => ({ model }),
    CompletedScrollListToTop: () => ({ model }),
    CompletedScrollSetlistToTop: () => ({ model }),
    CompletedFocusQueueHandle: () => ({ model }),
    CompletedFocusInfoPanel: () => ({ model }),
    CompletedFocusInfoButton: () => ({ model }),
    CompletedFocusPlaylistPrompt: () => ({ model }),
  })

/** Every new play starts its own load timeout, whatever started the play, so a
 *  load that never reports anything still ends. */
const withLoadTimeout = (before: Model, result: UpdateReturn): UpdateReturn =>
  Option.match(
    Option.filter(result.model.setlist.maybeNowPlaying, ({ playId }) =>
      Option.isNone(currentPlay(before, playId)),
    ),
    {
      onNone: () => result,
      onSome: ({ playId }) => ({
        ...result,
        commands: [
          ...(result.commands ?? []),
          WaitBeforeLoadTimeout({ playId }),
        ],
      }),
    },
  )

/** The address bar follows the open layers, so the browser's Back button closes
 *  the topmost one. A change that came from the address bar already has its
 *  entry, so it only repairs a URL that says something the model does not. */
export const update = (model: Model, message: Message): UpdateReturn => {
  const updated = withLoadTimeout(model, updateModel(model, message))
  const result = {
    ...updated,
    model: giveUpEndedRetries(updated.model),
  }
  const sync = (change: 'OpenVideo' | 'OpenOverlay' | 'Replace' | 'Close') =>
    SyncUrl({ url: layersToUrl(layersOf(result.model)), change })
  const fromUrl =
    message._tag === 'ChangedLayers' || message._tag === 'OpenedFromUrl'
  const change = fromUrl
    ? layersToUrl(parseLayers(message.search)) ===
      layersToUrl(layersOf(result.model))
      ? 'Unchanged'
      : 'Replace'
    : classifyChange(layersOf(model), layersOf(result.model))
  return change === 'Unchanged'
    ? result
    : { ...result, commands: [...(result.commands ?? []), sync(change)] }
}

/** The address bar moved, for example by the Back button. */
export const changedLayers = (model: Model, search: string): UpdateReturn =>
  update(model, Message.ChangedLayers({ search }))

/** The page was opened on an address, maybe a link to one video. */
export const openedFromUrl = (model: Model, search: string): UpdateReturn =>
  update(model, Message.OpenedFromUrl({ search }))
