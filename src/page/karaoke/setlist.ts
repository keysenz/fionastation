import { Array, Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { PlayableSong } from '../../domain.ts'

const HISTORY_LIMIT = 50

export const PlaybackStatus = Schema.Literals(['Playing', 'Paused'])
export type PlaybackStatus = typeof PlaybackStatus.Type

export const PlayerState = Schema.Literals(['Loading', 'Ready'])
export type PlayerState = typeof PlayerState.Type

export const Repeat = Schema.Literals(['Off', 'All', 'One'])
export type Repeat = typeof Repeat.Type

export const nextRepeat = (repeat: Repeat): Repeat =>
  repeat === 'Off' ? 'All' : repeat === 'All' ? 'One' : 'Off'

const PLAYING: PlaybackStatus = 'Playing'
const PAUSED: PlaybackStatus = 'Paused'

export const NowPlaying = Schema.Struct({
  song: PlayableSong,
  // NOTE: tells two plays of one song apart, so replaying it still reloads the video.
  playId: Schema.Number,
  status: PlaybackStatus,
  player: PlayerState,
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
        player: 'Loading',
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

/** Appends songs to the queue in the order given. */
export const enqueueAll = (
  setlist: Setlist,
  songs: ReadonlyArray<PlayableSong>,
): Setlist =>
  Array.isReadonlyArrayNonEmpty(songs)
    ? modifyFields(setlist, { queue: queue => [...queue, ...songs] })
    : setlist

export const moveInQueue = (
  setlist: Setlist,
  from: number,
  to: number,
): Setlist => {
  const { queue } = setlist
  const isInRange = (index: number) =>
    Number.isInteger(index) && index >= 0 && index < queue.length
  if (from === to || !isInRange(from) || !isInRange(to)) {
    return setlist
  }
  const without = queue.filter((_, index) => index !== from)
  return modifyFields(setlist, {
    queue: () => [...without.slice(0, to), queue[from]!, ...without.slice(to)],
  })
}

export const removeFromQueue = (setlist: Setlist, index: number): Setlist =>
  Number.isInteger(index) && index >= 0 && index < setlist.queue.length
    ? modifyFields(setlist, {
        queue: queue => queue.filter((_, position) => position !== index),
      })
    : setlist

export const playFromQueue = (setlist: Setlist, index: number): Setlist => {
  const maybeSong = Array.get(setlist.queue, index)
  return Option.match(maybeSong, {
    onNone: () => setlist,
    onSome: song => play(removeFromQueue(setlist, index), song),
  })
}

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

export const markPlayerReady = (setlist: Setlist): Setlist =>
  modifyNowPlaying(setlist, nowPlaying =>
    modifyFields(nowPlaying, { player: () => 'Ready' }),
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

/** With repeat All, leaving a song puts it at the end of the queue first, so
 *  the queue loops, and an empty queue replays the song. */
export const playNext = (setlist: Setlist, repeat: Repeat = 'Off'): Setlist => {
  const looped =
    repeat === 'All'
      ? Option.match(setlist.maybeNowPlaying, {
          onNone: () => setlist,
          onSome: ({ song }) => enqueue(setlist, song),
        })
      : setlist
  return Option.match(Array.head(looped.queue), {
    onNone: () => setStatus(looped, 'Paused'),
    onSome: nextSong =>
      play(
        modifyFields(looped, { queue: queue => Array.drop(queue, 1) }),
        nextSong,
      ),
  })
}

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
  repeat: Repeat
}

/** What happens once a song is over. Choosing a random video needs randomness,
 *  which this module cannot call, so the plan carries the candidates (the first
 *  song of each live video) and a Command picks one. */
export const Advance = defineTaggedUnion({
  PlayQueued: {},
  Replay: {},
  PickRandomVideo: { candidates: Schema.NonEmptyArray(PlayableSong) },
  Stop: {},
})
export type Advance = typeof Advance.Type

/** Why a random video was needed: the video ended, or it cannot be played. */
export const PickCause = Schema.Literals(['Ended', 'Unavailable'])
export type PickCause = typeof PickCause.Type

export const firstSongOfEachOtherLiveVideo = (
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

/** Nothing of the current video is left: YouTube ends a video only at its end,
 *  and a dead one cannot play. With autoplay on, a random other live video plays
 *  from its first song. */
const planFromArchive = (
  continuation: Continuation,
  current: PlayableSong,
): Advance =>
  continuation.isAutoplay
    ? Array.match(firstSongOfEachOtherLiveVideo(continuation, current), {
        onEmpty: () => Advance.Stop(),
        onNonEmpty: candidates => Advance.PickRandomVideo({ candidates }),
      })
    : Advance.Stop()

/** When a song ends, repeat One replays it and repeat All sends it to the end
 *  of the queue and plays the head. Otherwise the queue plays first. Then, with
 *  autoplay on, a random other video. Autoplay off stops. */
export const planAdvance = (
  setlist: Setlist,
  continuation: Continuation,
): Advance => {
  const hasSong = Option.isSome(setlist.maybeNowPlaying)
  if (hasSong && continuation.repeat === 'One') {
    return Advance.Replay()
  }
  if (hasSong && continuation.repeat === 'All') {
    return Advance.PlayQueued()
  }
  return Array.isReadonlyArrayNonEmpty(setlist.queue)
    ? Advance.PlayQueued()
    : Option.match(setlist.maybeNowPlaying, {
        onNone: () => Advance.Stop(),
        onSome: ({ song }) => planFromArchive(continuation, song),
      })
}

/** Applies a plan. A random pick changes nothing yet, because the Command that
 *  picks it comes back through `playPicked`. A stop pauses the same song. */
export const applyAdvance = (
  setlist: Setlist,
  advance: Advance,
  repeat: Repeat,
): Setlist =>
  Advance.match<Setlist>(advance, {
    PlayQueued: () => playNext(setlist, repeat),
    Replay: () =>
      Option.match(setlist.maybeNowPlaying, {
        onNone: () => setlist,
        onSome: ({ song }) => startPlay(setlist, song),
      }),
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
          : planFromArchive(continuation, failedSong),
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
    Replay: () => failLoad(cleaned, reason),
    PlayQueued: () =>
      Option.match(Array.head(cleaned.queue), {
        onNone: () => failLoad(cleaned, reason),
        onSome: nextSong =>
          startPlay(
            modifyFields(cleaned, { queue: queue => Array.drop(queue, 1) }),
            nextSong,
          ),
      }),
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

export const Volume = Schema.Struct({
  level: Schema.Number,
  isMuted: Schema.Boolean,
})
export type Volume = typeof Volume.Type

export const defaultVolume: Volume = { level: 100, isMuted: false }

const VolumeJson = Schema.fromJsonString(Volume)

const clampLevel = (level: number): number =>
  Number.isFinite(level) ? Math.min(100, Math.max(0, Math.round(level))) : 100

/** A slider above 0 unmutes, and 0 keeps whatever mute state there was. */
export const setLevel = (volume: Volume, level: number): Volume => {
  const clamped = clampLevel(level)
  return { level: clamped, isMuted: clamped > 0 ? false : volume.isMuted }
}

export const isSilent = ({ level, isMuted }: Volume): boolean =>
  isMuted || level === 0

/** Unmuting from level 0 would stay silent, so it goes to a middle level. */
export const toggleMute = (volume: Volume): Volume =>
  isSilent(volume)
    ? { level: volume.level === 0 ? 50 : volume.level, isMuted: false }
    : { ...volume, isMuted: true }

export const toVolumeJson = (volume: Volume): string =>
  Schema.encodeSync(VolumeJson)(volume)

/** Missing or corrupt saved data is full volume, and a saved level is clamped. */
export const parseVolume = (maybeJson: Option.Option<string>): Volume =>
  Option.match(
    Option.flatMap(maybeJson, Schema.decodeUnknownOption(VolumeJson)),
    {
      onNone: () => defaultVolume,
      onSome: ({ level, isMuted }) => ({ level: clampLevel(level), isMuted }),
    },
  )
