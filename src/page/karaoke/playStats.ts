import { Array, Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { PlayOrigin } from './setlist.ts'

export const PlayStat = defineTaggedUnion({
  Clicked: { songId: Schema.String },
  Played: { songId: Schema.String, origin: PlayOrigin },
  Finished: { songId: Schema.String, origin: PlayOrigin },
  Skipped: {
    songId: Schema.String,
    origin: PlayOrigin,
    secondsIntoSong: Schema.Number,
  },
})
export type PlayStat = typeof PlayStat.Type

export const Listen = Schema.Struct({
  playId: Schema.Number,
  songId: Schema.String,
  state: Schema.Literals(['Heard', 'Closed']),
})
export type Listen = typeof Listen.Type

export type Standing = Readonly<{
  playId: number
  origin: PlayOrigin
  isPlaying: boolean
  hasFailedLoad: boolean
  hasGoneStream: boolean
  songId: string
  maybeNextSongId: Option.Option<string>
  secondsIntoSong: number
}>

export const Trigger = defineTaggedUnion({
  PressedNext: {},
  EndedPlay: { playId: Schema.Number },
  MovedPlayhead: {},
  Other: {},
})
export type Trigger = typeof Trigger.Type

const stateOf = (
  listens: ReadonlyArray<Listen>,
  playId: number,
  songId: string,
): Option.Option<Listen['state']> =>
  Option.map(
    Array.findFirst(
      listens,
      listen => listen.playId === playId && listen.songId === songId,
    ),
    ({ state }) => state,
  )

const closed = (
  listens: ReadonlyArray<Listen>,
  playId: number,
  songId: string,
): ReadonlyArray<Listen> =>
  Array.map(listens, listen =>
    listen.playId === playId && listen.songId === songId
      ? { ...listen, state: 'Closed' as const }
      : listen,
  )

const carriedToRetry = (
  listens: ReadonlyArray<Listen>,
  maybeBefore: Option.Option<Standing>,
  maybeAfter: Option.Option<Standing>,
): ReadonlyArray<Listen> =>
  Option.getOrElse(
    Option.zipWith(maybeBefore, maybeAfter, (before, after) =>
      before.hasFailedLoad && before.playId !== after.playId
        ? Array.map(listens, listen =>
            listen.playId === before.playId
              ? { ...listen, playId: after.playId }
              : listen,
          )
        : listens,
    ),
    () => listens,
  )

export type StatStep = Readonly<{
  listens: ReadonlyArray<Listen>
  stats: ReadonlyArray<PlayStat>
}>

export const stepStats = (
  heldListens: ReadonlyArray<Listen>,
  trigger: Trigger,
  maybeBefore: Option.Option<Standing>,
  maybeAfter: Option.Option<Standing>,
): StatStep => {
  const listens = carriedToRetry(heldListens, maybeBefore, maybeAfter)
  const left = Option.match(maybeBefore, {
    onNone: (): StatStep => ({ listens, stats: [] }),
    onSome: (before): StatStep => {
      const unchanged: StatStep = { listens, stats: [] }
      if (
        !Option.contains(
          stateOf(listens, before.playId, before.songId),
          'Heard',
        )
      ) {
        return unchanged
      }
      const leave = (stats: ReadonlyArray<PlayStat>): StatStep => ({
        listens: closed(listens, before.playId, before.songId),
        stats: before.hasGoneStream || before.hasFailedLoad ? [] : stats,
      })
      const finished = PlayStat.Finished({
        songId: before.songId,
        origin: before.origin,
      })
      const movedOn = Option.exists(
        maybeAfter,
        after =>
          after.playId === before.playId && after.songId !== before.songId,
      )
      return Trigger.matchOrElse<StatStep>(
        trigger,
        {
          EndedPlay: ({ playId }) =>
            playId === before.playId ? leave([finished]) : unchanged,
          PressedNext: () =>
            leave([
              PlayStat.Skipped({
                songId: before.songId,
                origin: before.origin,
                secondsIntoSong: before.secondsIntoSong,
              }),
            ]),
          MovedPlayhead: () =>
            movedOn
              ? leave(
                  Option.exists(
                    maybeAfter,
                    after =>
                      after.isPlaying &&
                      Option.contains(before.maybeNextSongId, after.songId),
                  )
                    ? [finished]
                    : [],
                )
              : unchanged,
        },
        () => (movedOn ? leave([]) : unchanged),
      )
    },
  })
  return Option.match(maybeAfter, {
    onNone: (): StatStep => ({ listens: [], stats: left.stats }),
    onSome: (after): StatStep => {
      const current = Array.filter(
        left.listens,
        ({ playId }) => playId === after.playId,
      )
      const isNew =
        after.isPlaying &&
        Option.isNone(stateOf(current, after.playId, after.songId))
      return isNew
        ? {
            listens: [
              ...current,
              { playId: after.playId, songId: after.songId, state: 'Heard' },
            ],
            stats: [
              ...left.stats,
              PlayStat.Played({ songId: after.songId, origin: after.origin }),
            ],
          }
        : { listens: current, stats: left.stats }
    },
  })
}
