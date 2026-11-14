import { Array, Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { PlayableSong } from '../../domain.ts'
import { type PlaylistEntry, PlaylistId } from '../../playlist.ts'
import { LoadFailure } from '../../youtube.ts'

const HISTORY_LIMIT = 50

export const PlaybackIntent = Schema.Literals(['Playing', 'Paused'])
export type PlaybackIntent = typeof PlaybackIntent.Type

/** Where one play stands. `MovingOn` and `Gone` both mean YouTube no longer has
 *  the stream: a random other video is on its way, or nothing may follow.
 *  `LoadFailed` is a load that may still work, so the song stays a real song.
 *  `intent` is what the visitor last asked for while no video can honor it. */
export const Phase = defineTaggedUnion({
  Loading: { intent: PlaybackIntent },
  Playing: {},
  Paused: {},
  MovingOn: {},
  Gone: {},
  LoadFailed: { reason: LoadFailure, intent: PlaybackIntent },
})
export type Phase = typeof Phase.Type

/** What the visitor wants from a video that can play, and nothing for one that cannot. */
export const intentOf = (phase: Phase): Option.Option<PlaybackIntent> =>
  Phase.match<Option.Option<PlaybackIntent>>(phase, {
    Loading: ({ intent }) => Option.some(intent),
    Playing: () => Option.some('Playing'),
    Paused: () => Option.some('Paused'),
    MovingOn: () => Option.none(),
    Gone: () => Option.none(),
    LoadFailed: () => Option.none(),
  })

export const isStreamGone = Phase.isAnyOf(['MovingOn', 'Gone'])

export const MAX_AUTO_LOAD_RETRIES = 3

/** The wait before the automatic retry of a failed load: 2, 4, then 8 seconds.
 *  None once the automatic retries are spent, whoever started the attempts. */
export const loadRetryDelaySeconds = (
  attempt: number,
): Option.Option<number> =>
  attempt <= MAX_AUTO_LOAD_RETRIES ? Option.some(2 ** attempt) : Option.none()

export const Repeat = Schema.Literals(['Off', 'All', 'One'])
export type Repeat = typeof Repeat.Type

export const nextRepeat = (repeat: Repeat): Repeat =>
  repeat === 'Off' ? 'All' : repeat === 'All' ? 'One' : 'Off'

export const NowPlaying = Schema.Struct({
  song: PlayableSong,
  // NOTE: tells two plays of one song apart, so replaying it still reloads the video.
  playId: Schema.Number,
  phase: Phase,
  // NOTE: counts the loads of this song since it last played, across the new playId of each retry. It lives beside the phase because a load that got ready or paused can still fail.
  attempt: Schema.Number,
})
export type NowPlaying = typeof NowPlaying.Type

export const Setlist = Schema.Struct({
  queue: Schema.Array(PlayableSong),
  history: Schema.Array(PlayableSong),
  maybeNowPlaying: Schema.Option(NowPlaying),
  playCount: Schema.Number,
  maybeOpenedPlaylistId: Schema.Option(PlaylistId),
})
export type Setlist = typeof Setlist.Type

// NOTE: this is zustand's persist format from the Next site, kept so visitors' saved queues still load.
const PersistedSetlist = Schema.Struct({
  state: Schema.Struct({
    queue: Schema.Array(PlayableSong),
    history: Schema.Array(PlayableSong),
    openedPlaylistId: Schema.optional(PlaylistId),
  }),
  version: Schema.Number,
})

const PersistedSetlistJson = Schema.fromJsonString(PersistedSetlist)

export const emptySetlist: Setlist = {
  queue: [],
  history: [],
  maybeNowPlaying: Option.none(),
  playCount: 0,
  maybeOpenedPlaylistId: Option.none(),
}

const startPlay = (setlist: Setlist, song: PlayableSong): Setlist =>
  modifyFields(setlist, {
    maybeNowPlaying: () =>
      Option.some({
        song,
        playId: setlist.playCount + 1,
        phase: Phase.Loading({ intent: 'Playing' }),
        attempt: 1,
      }),
    playCount: count => count + 1,
  })

/** The song being left, unless its stream is gone. A gone song is neither
 *  history nor queued again. A song whose load failed is still a real song. */
const leftSong = (setlist: Setlist): Option.Option<PlayableSong> =>
  Option.flatMap(setlist.maybeNowPlaying, ({ song, phase }) =>
    isStreamGone(phase) ? Option.none() : Option.some(song),
  )

export const play = (setlist: Setlist, song: PlayableSong): Setlist =>
  startPlay(
    modifyFields(setlist, {
      history: history =>
        Option.match(leftSong(setlist), {
          onNone: () => history,
          onSome: left => Array.take([left, ...history], HISTORY_LIMIT),
        }),
    }),
    song,
  )

const editQueueAndForgetPlaylist = (
  setlist: Setlist,
  change: (queue: Setlist['queue']) => Setlist['queue'],
): Setlist =>
  modifyFields(setlist, {
    queue: change,
    maybeOpenedPlaylistId: () => Option.none(),
  })

const withoutQueued = (queue: Setlist['queue'], index: number) =>
  queue.filter((_, position) => position !== index)

export const enqueue = (setlist: Setlist, song: PlayableSong): Setlist =>
  editQueueAndForgetPlaylist(setlist, queue => [...queue, song])

/** Appends songs to the queue in the order given. */
export const enqueueAll = (
  setlist: Setlist,
  songs: ReadonlyArray<PlayableSong>,
): Setlist =>
  Array.isReadonlyArrayNonEmpty(songs)
    ? editQueueAndForgetPlaylist(setlist, queue => [...queue, ...songs])
    : setlist

export type PlaylistLoadMode = 'Replace' | 'Append'

const archiveSongOf = (
  archive: ReadonlyArray<PlayableSong>,
  entry: PlaylistEntry,
): Option.Option<PlayableSong> =>
  Array.findFirst(archive, song => song.id === entry.songId).pipe(
    Option.orElse(() =>
      Array.findFirst(
        archive,
        song =>
          song.video_url === entry.videoUrl &&
          song.timestamp === entry.timestamp,
      ),
    ),
    Option.orElse(() =>
      Array.findFirst(
        archive,
        song =>
          song.video_url === entry.videoUrl && song.song_title === entry.title,
      ),
    ),
  )

export type ResolvedPlaylist = {
  songs: ReadonlyArray<PlayableSong>
  unavailableCount: number
}

export const resolvePlaylist = (
  entries: ReadonlyArray<PlaylistEntry>,
  archive: ReadonlyArray<PlayableSong>,
  isGone: (song: PlayableSong) => boolean,
): ResolvedPlaylist => {
  const resolved = Array.flatMap(entries, entry =>
    Option.toArray(
      Option.filter(archiveSongOf(archive, entry), song => !isGone(song)),
    ),
  )
  return {
    songs: Array.dedupeWith(
      resolved,
      (first, second) => first.id === second.id,
    ),
    unavailableCount: entries.length - resolved.length,
  }
}

export const loadPlaylist = (
  setlist: Setlist,
  songs: ReadonlyArray<PlayableSong>,
  mode: PlaylistLoadMode,
  id: PlaylistId,
): Setlist => {
  if (!Array.isReadonlyArrayNonEmpty(songs)) {
    return setlist
  }
  const opened = (loaded: Setlist) =>
    modifyFields(loaded, { maybeOpenedPlaylistId: () => Option.some(id) })
  if (mode === 'Replace') {
    return playNext(opened(modifyFields(setlist, { queue: () => songs })))
  }
  const heldIds = new Set([
    ...setlist.queue.map(song => song.id),
    ...Option.toArray(setlist.maybeNowPlaying).map(({ song }) => song.id),
  ])
  return opened(
    enqueueAll(
      setlist,
      Array.filter(songs, song => !heldIds.has(song.id)),
    ),
  )
}

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
    maybeOpenedPlaylistId: () => Option.none(),
  })
}

export const removeFromQueue = (setlist: Setlist, index: number): Setlist =>
  Number.isInteger(index) && index >= 0 && index < setlist.queue.length
    ? editQueueAndForgetPlaylist(setlist, queue => withoutQueued(queue, index))
    : setlist

export const playFromQueue = (setlist: Setlist, index: number): Setlist => {
  const maybeSong = Array.get(setlist.queue, index)
  return Option.match(maybeSong, {
    onNone: () => setlist,
    onSome: song =>
      play(
        modifyFields(setlist, {
          queue: queue => withoutQueued(queue, index),
        }),
        song,
      ),
  })
}

const modifyNowPlaying = (
  setlist: Setlist,
  change: (nowPlaying: NowPlaying) => NowPlaying,
): Setlist =>
  modifyFields(setlist, {
    maybeNowPlaying: maybeNowPlaying => Option.map(maybeNowPlaying, change),
  })

const changePhase = (
  setlist: Setlist,
  change: (phase: Phase) => Phase,
): Setlist =>
  modifyNowPlaying(setlist, nowPlaying =>
    modifyFields(nowPlaying, { phase: change }),
  )

const keep = (phase: Phase): Phase => phase

export const togglePlaying = (setlist: Setlist): Setlist =>
  changePhase(
    setlist,
    Phase.matchOrElse(
      {
        Loading: ({ intent }) =>
          Phase.Loading({
            intent: intent === 'Playing' ? 'Paused' : 'Playing',
          }),
        Playing: () => Phase.Paused(),
        Paused: () => Phase.Playing(),
      },
      keep,
    ),
  )

export const pause = (setlist: Setlist): Setlist =>
  changePhase(
    setlist,
    Phase.matchOrElse(
      {
        Loading: () => Phase.Loading({ intent: 'Paused' }),
        Playing: () => Phase.Paused(),
      },
      keep,
    ),
  )

/** The player loaded the video, which starts or stays paused as the visitor asked. */
export const reportReady = (setlist: Setlist): Setlist =>
  changePhase(
    setlist,
    Phase.matchOrElse(
      {
        Loading: ({ intent }) =>
          intent === 'Playing' ? Phase.Playing() : Phase.Paused(),
      },
      keep,
    ),
  )

/** Only sound proves a load worked, so only this starts the attempts again.
 *  It also ends a failed load, whose video can still start late. */
export const reportPlaying = (setlist: Setlist): Setlist =>
  modifyNowPlaying(setlist, nowPlaying =>
    isStreamGone(nowPlaying.phase)
      ? nowPlaying
      : modifyFields(nowPlaying, {
          phase: () => Phase.Playing(),
          attempt: () => 1,
        }),
  )

export const reportPaused = (setlist: Setlist): Setlist =>
  changePhase(setlist, phase =>
    Option.isSome(intentOf(phase)) ? Phase.Paused() : phase,
  )

export const failLoad = (setlist: Setlist, reason: LoadFailure): Setlist =>
  changePhase(setlist, phase =>
    Option.match(intentOf(phase), {
      onNone: () => phase,
      onSome: intent => Phase.LoadFailed({ reason, intent }),
    }),
  )

/** Loads `song` again as the next attempt of the failed play, with a new playId
 *  so the video reloads. The queue and history stay as they are. `Visitor` asks
 *  to hear it, and `Timer` keeps what the visitor asked before the failure. */
export const retryLoad = (
  setlist: Setlist,
  song: PlayableSong,
  by: 'Visitor' | 'Timer',
): Setlist =>
  Option.match(setlist.maybeNowPlaying, {
    onNone: () => setlist,
    onSome: ({ phase, attempt }) =>
      Phase.matchOrElse(
        phase,
        {
          LoadFailed: ({ intent }) =>
            modifyFields(setlist, {
              maybeNowPlaying: () =>
                Option.some({
                  song,
                  playId: setlist.playCount + 1,
                  phase: Phase.Loading({
                    intent: by === 'Visitor' ? 'Playing' : intent,
                  }),
                  attempt: attempt + 1,
                }),
              playCount: count => count + 1,
            }),
        },
        () => setlist,
      ),
  })

/** The pick for a gone stream found no live video, so the stream stays, gone. */
export const settleGone = (setlist: Setlist): Setlist =>
  changePhase(
    setlist,
    Phase.matchOrElse({ MovingOn: () => Phase.Gone() }, keep),
  )

/** With repeat All, leaving a song puts it at the end of the queue first, so
 *  the queue loops, and an empty queue replays the song. */
export const playNext = (setlist: Setlist, repeat: Repeat = 'Off'): Setlist => {
  const looped =
    repeat === 'All'
      ? Option.match(leftSong(setlist), {
          onNone: () => setlist,
          onSome: left => enqueue(setlist, left),
        })
      : setlist
  return Option.match(Array.head(looped.queue), {
    onNone: () => pause(looped),
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
          queue: queue => [...Option.toArray(leftSong(setlist)), ...queue],
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
 *  picks it comes back through `play`. A stop pauses the same song. */
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
    Stop: () => pause(setlist),
  })

/** A gone video takes every song of it out of the queue and history, and its
 *  play is marked gone, so nothing records it later. The plan is for the cleaned
 *  setlist, so the song that hit it is never a candidate. */
export const planSkip = (
  setlist: Setlist,
  continuation: Continuation,
): { cleaned: Setlist; advance: Advance } =>
  Option.match(setlist.maybeNowPlaying, {
    onNone: () => ({ cleaned: setlist, advance: Advance.Stop() }),
    onSome: ({ song: goneSong }) => {
      const isOtherVideo = (song: PlayableSong): boolean =>
        song.video_url !== goneSong.video_url
      const cleaned = changePhase(
        modifyFields(setlist, {
          queue: queue => Array.filter(queue, isOtherVideo),
          history: history => Array.filter(history, isOtherVideo),
        }),
        () => Phase.Gone(),
      )
      return {
        cleaned,
        advance: Array.isReadonlyArrayNonEmpty(cleaned.queue)
          ? Advance.PlayQueued()
          : planFromArchive(continuation, goneSong),
      }
    },
  })

/** The queue head plays. A random pick is on its way, so the gone song waits
 *  for it. With nothing to move to, the gone song stays. */
export const applySkip = (cleaned: Setlist, advance: Advance): Setlist =>
  Advance.matchOrElse(
    advance,
    {
      PlayQueued: () => playNext(cleaned),
      PickRandomVideo: () => changePhase(cleaned, () => Phase.MovingOn()),
    },
    () => cleaned,
  )

export const toPersistedJson = (setlist: Setlist): string =>
  Schema.encodeSync(PersistedSetlistJson)({
    state: {
      queue: setlist.queue,
      history: setlist.history,
      openedPlaylistId: Option.getOrUndefined(setlist.maybeOpenedPlaylistId),
    },
    version: 0,
  })

/** Takes the saved queue, history and opened playlist, and keeps what is playing. With nothing
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
          maybeOpenedPlaylistId: () =>
            Option.fromUndefinedOr(state.openedPlaylistId),
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
