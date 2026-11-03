import { Array, Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { PlayableSong } from '../../domain.ts'

const HISTORY_LIMIT = 50

export const PlaybackStatus = Schema.Literals(['Playing', 'Paused'])
export type PlaybackStatus = typeof PlaybackStatus.Type

const PLAYING: PlaybackStatus = 'Playing'
const PAUSED: PlaybackStatus = 'Paused'

export const NowPlaying = Schema.Struct({
  song: PlayableSong,
  // NOTE: tells two plays of one song apart, so replaying it still gets a new player.
  playId: Schema.Number,
  status: PlaybackStatus,
  maybeLoadError: Schema.Option(Schema.String),
})
export type NowPlaying = typeof NowPlaying.Type

export const Setlist = Schema.Struct({
  queue: Schema.Array(PlayableSong),
  history: Schema.Array(PlayableSong),
  maybeNowPlaying: Schema.Option(NowPlaying),
  playCount: Schema.Number,
})
export type Setlist = typeof Setlist.Type

// NOTE: this is zustand's persist format from the Next site, kept so visitors' saved queues still load.
const PersistedSetlist = Schema.Struct({
  state: Schema.Struct({
    queue: Schema.Array(PlayableSong),
    history: Schema.Array(PlayableSong),
  }),
  version: Schema.Number,
})

const PersistedSetlistJson = Schema.fromJsonString(PersistedSetlist)

export const emptySetlist: Setlist = {
  queue: [],
  history: [],
  maybeNowPlaying: Option.none(),
  playCount: 0,
}

const startPlay = (setlist: Setlist, song: PlayableSong): Setlist =>
  modifyFields(setlist, {
    maybeNowPlaying: () =>
      Option.some({
        song,
        playId: setlist.playCount + 1,
        status: PLAYING,
        maybeLoadError: Option.none(),
      }),
    playCount: count => count + 1,
  })

export const play = (setlist: Setlist, song: PlayableSong): Setlist =>
  startPlay(
    modifyFields(setlist, {
      history: history =>
        Option.match(setlist.maybeNowPlaying, {
          onNone: () => history,
          onSome: nowPlaying =>
            Array.take([nowPlaying.song, ...history], HISTORY_LIMIT),
        }),
    }),
    song,
  )

export const enqueue = (setlist: Setlist, song: PlayableSong): Setlist =>
  modifyFields(setlist, { queue: queue => [...queue, song] })

const modifyNowPlaying = (
  setlist: Setlist,
  change: (nowPlaying: NowPlaying) => NowPlaying,
): Setlist =>
  modifyFields(setlist, {
    maybeNowPlaying: maybeNowPlaying => Option.map(maybeNowPlaying, change),
  })

export const setStatus = (setlist: Setlist, status: PlaybackStatus): Setlist =>
  modifyNowPlaying(setlist, nowPlaying =>
    modifyFields(nowPlaying, { status: () => status }),
  )

export const failLoad = (setlist: Setlist, reason: string): Setlist =>
  modifyNowPlaying(setlist, nowPlaying =>
    modifyFields(nowPlaying, {
      status: () => PAUSED,
      maybeLoadError: () => Option.some(reason),
    }),
  )

export const togglePlaying = (setlist: Setlist): Setlist =>
  Option.match(setlist.maybeNowPlaying, {
    onNone: () => setlist,
    onSome: ({ status }) =>
      setStatus(setlist, status === 'Playing' ? 'Paused' : 'Playing'),
  })

export const playNext = (setlist: Setlist): Setlist =>
  Option.match(Array.head(setlist.queue), {
    onNone: () => setStatus(setlist, 'Paused'),
    onSome: nextSong =>
      play(
        modifyFields(setlist, { queue: queue => Array.drop(queue, 1) }),
        nextSong,
      ),
  })

export const playPrevious = (setlist: Setlist): Setlist =>
  Option.match(Array.head(setlist.history), {
    onNone: () => setlist,
    onSome: previousSong =>
      startPlay(
        modifyFields(setlist, {
          history: history => Array.drop(history, 1),
          queue: queue => [
            ...Option.match(setlist.maybeNowPlaying, {
              onNone: () => [],
              onSome: ({ song }) => [song],
            }),
            ...queue,
          ],
        }),
        previousSong,
      ),
  })

/** What may start by itself once a song is over: the whole archive in order,
 *  which videos are known to be gone, and whether the visitor allows the archive
 *  to carry on. */
export type Continuation = {
  archive: ReadonlyArray<PlayableSong>
  isGone: (song: PlayableSong) => boolean
  isAutoplay: boolean
}

/** What happens once a song is over. Choosing a random video needs randomness,
 *  which this module cannot call, so the plan carries the candidates (the first
 *  song of each live video) and a Command picks one. */
export const Advance = defineTaggedUnion({
  PlayQueued: {},
  PlaySong: { song: PlayableSong },
  PickRandomVideo: { candidates: Schema.NonEmptyArray(PlayableSong) },
  Stop: {},
})
export type Advance = typeof Advance.Type

/** Why a random video was needed: the video ended, or it cannot be played. */
export const PickCause = Schema.Literals(['Ended', 'Unavailable'])
export type PickCause = typeof PickCause.Type

// NOTE: the index comes from the full archive, because a known-gone song is not in a filtered list.
const nextSongInVideo = (
  { archive, isGone }: Continuation,
  current: PlayableSong,
): Option.Option<PlayableSong> =>
  Option.flatMap(
    Array.findFirstIndex(archive, ({ id }) => id === current.id),
    index =>
      Array.findFirst(
        Array.drop(archive, index + 1),
        song => song.video_url === current.video_url && !isGone(song),
      ),
  )

const firstSongOfEachOtherLiveVideo = (
  { archive, isGone }: Continuation,
  current: PlayableSong,
): ReadonlyArray<PlayableSong> =>
  Array.dedupeWith(
    Array.filter(
      archive,
      song => !isGone(song) && song.video_url !== current.video_url,
    ),
    (first, second) => first.video_url === second.video_url,
  )

/** With autoplay on, the rest of the current video plays, then a random other
 *  live video from its first song. A video that cannot play has no rest. */
const planFromArchive = (
  continuation: Continuation,
  current: PlayableSong,
  isVideoDead: boolean,
): Advance => {
  if (!continuation.isAutoplay) {
    return Advance.Stop()
  }
  const maybeNextInVideo = isVideoDead
    ? Option.none()
    : nextSongInVideo(continuation, current)
  return Option.match(maybeNextInVideo, {
    onSome: song => Advance.PlaySong({ song }),
    onNone: () =>
      Array.match(firstSongOfEachOtherLiveVideo(continuation, current), {
        onEmpty: () => Advance.Stop(),
        onNonEmpty: candidates => Advance.PickRandomVideo({ candidates }),
      }),
  })
}

/** When a video ends the queue plays first. Then, with autoplay on, the next
 *  song of the same video or a random other one. Autoplay off stops. */
export const planAdvance = (
  setlist: Setlist,
  continuation: Continuation,
): Advance =>
  Array.isReadonlyArrayNonEmpty(setlist.queue)
    ? Advance.PlayQueued()
    : Option.match(setlist.maybeNowPlaying, {
        onNone: () => Advance.Stop(),
        onSome: ({ song }) => planFromArchive(continuation, song, false),
      })

/** Applies a plan. A random pick changes nothing yet, because the Command that
 *  picks it comes back through `playPicked`. A stop pauses the same song. */
export const applyAdvance = (setlist: Setlist, advance: Advance): Setlist =>
  Advance.match<Setlist>(advance, {
    PlayQueued: () => playNext(setlist),
    PlaySong: ({ song }) => play(setlist, song),
    PickRandomVideo: () => setlist,
    Stop: () => setStatus(setlist, 'Paused'),
  })

/** A dead video takes every song of it out of the queue and history. The plan
 *  is for the cleaned setlist, so the song that hit it is never a candidate. */
export const planSkip = (
  setlist: Setlist,
  continuation: Continuation,
): { cleaned: Setlist; advance: Advance } =>
  Option.match(setlist.maybeNowPlaying, {
    onNone: () => ({ cleaned: setlist, advance: Advance.Stop() }),
    onSome: ({ song: failedSong }) => {
      const isOtherVideo = (song: PlayableSong): boolean =>
        song.video_url !== failedSong.video_url
      const cleaned = modifyFields(setlist, {
        queue: queue => Array.filter(queue, isOtherVideo),
        history: history => Array.filter(history, isOtherVideo),
      })
      return {
        cleaned,
        advance: Array.isReadonlyArrayNonEmpty(cleaned.queue)
          ? Advance.PlayQueued()
          : planFromArchive(continuation, failedSong, true),
      }
    },
  })

/** The song that hit a dead video is not recorded in history, because Previous
 *  would land on it. With nothing to move to, it pauses with the reason. */
export const applySkip = (
  cleaned: Setlist,
  advance: Advance,
  reason: string,
): Setlist =>
  Advance.match<Setlist>(advance, {
    PlayQueued: () =>
      Option.match(Array.head(cleaned.queue), {
        onNone: () => failLoad(cleaned, reason),
        onSome: nextSong =>
          startPlay(
            modifyFields(cleaned, { queue: queue => Array.drop(queue, 1) }),
            nextSong,
          ),
      }),
    PlaySong: ({ song }) => startPlay(cleaned, song),
    PickRandomVideo: () => cleaned,
    Stop: () => failLoad(cleaned, reason),
  })

/** Plays the song a Command picked. Only a dead video leaves history alone. */
export const playPicked = (
  setlist: Setlist,
  song: PlayableSong,
  cause: PickCause,
): Setlist =>
  cause === 'Ended' ? play(setlist, song) : startPlay(setlist, song)

export const toPersistedJson = (setlist: Setlist): string =>
  Schema.encodeSync(PersistedSetlistJson)({
    state: { queue: setlist.queue, history: setlist.history },
    version: 0,
  })

/** Takes the saved queue and history, and keeps what is playing. With nothing
 *  usable saved, it changes nothing, because storage can be blocked or corrupt. */
export const restoreSaved = (
  setlist: Setlist,
  maybeJson: Option.Option<string>,
): Setlist =>
  Option.match(
    Option.flatMap(maybeJson, Schema.decodeUnknownOption(PersistedSetlistJson)),
    {
      onNone: () => setlist,
      onSome: ({ state }) =>
        modifyFields(setlist, {
          queue: () => state.queue,
          history: () => state.history,
        }),
    },
  )
