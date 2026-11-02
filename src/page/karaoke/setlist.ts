import { Array, Option, Schema } from 'effect'
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

/** When a video ends the queue plays first, then the next song in the archive. */
export const advanceAfterEnd = (
  setlist: Setlist,
  allSongs: ReadonlyArray<PlayableSong>,
): Setlist => {
  if (Array.isReadonlyArrayNonEmpty(setlist.queue)) {
    return playNext(setlist)
  }
  const maybeNextSong = Option.flatMap(setlist.maybeNowPlaying, ({ song }) =>
    Option.flatMap(
      Array.findFirstIndex(allSongs, ({ id }) => id === song.id),
      index => Array.get(allSongs, index + 1),
    ),
  )
  return Option.match(maybeNextSong, {
    onNone: () => setStatus(setlist, 'Paused'),
    onSome: nextSong => play(setlist, nextSong),
  })
}

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
