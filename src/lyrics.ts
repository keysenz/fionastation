import { Array, Option, Record, Result, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { type PlayableSong, timestampToSeconds } from './domain.ts'

export const LyricLine = Schema.Struct({
  atMs: Schema.Int,
  text: Schema.String,
})
export type LyricLine = typeof LyricLine.Type

export const LyricsCredit = Schema.Struct({
  lrclibId: Schema.Int,
  track: Schema.String,
  artist: Schema.String,
})
export type LyricsCredit = typeof LyricsCredit.Type

export const MissingReason = Schema.Literals(['NotFound', 'Unsure', 'Hidden'])
export type MissingReason = typeof MissingReason.Type

/** The body of a 200 from /api/get-lyrics. Lines are sorted by atMs. A transient
 *  LRCLIB failure is a 503 and never a value of this type. */
export const Lyrics = defineTaggedUnion({
  Synced: {
    lines: Schema.NonEmptyArray(LyricLine),
    offsetMs: Schema.Int,
    credit: LyricsCredit,
  },
  Missing: { reason: MissingReason },
})
export type Lyrics = typeof Lyrics.Type

export const Playhead = Schema.Struct({
  playId: Schema.Number,
  seconds: Schema.Number,
})
export type Playhead = typeof Playhead.Type

export const NUDGE_LIMIT = 40
export const NUDGE_STEP_MS = 500

/** Half-second steps by which a viewer shifts a song's lyrics. Positive means the lyrics come later. */
export const LaterNudgeSteps = Schema.Int.check(
  Schema.isBetween({ minimum: -NUDGE_LIMIT, maximum: NUDGE_LIMIT }),
).pipe(Schema.brand('LaterNudgeSteps'))
export type LaterNudgeSteps = typeof LaterNudgeSteps.Type

export const noNudge = LaterNudgeSteps.make(0)

const toSteps = (steps: number): LaterNudgeSteps =>
  LaterNudgeSteps.make(Math.max(-NUDGE_LIMIT, Math.min(NUDGE_LIMIT, steps)))

const NonZero = Schema.makeFilter<number>(steps => steps !== 0)

export const Nudges = Schema.Record(
  Schema.String,
  LaterNudgeSteps.check(NonZero),
)
export type Nudges = typeof Nudges.Type

export const nudgeOf = (nudges: Nudges, songId: string): LaterNudgeSteps =>
  Option.getOrElse(Record.get(nudges, songId), () => noNudge)

export const nudge = (nudges: Nudges, songId: string, by: -1 | 1): Nudges => {
  const next = toSteps(nudgeOf(nudges, songId) + by)
  return next === 0
    ? Record.remove(nudges, songId)
    : { ...nudges, [songId]: next }
}

const NudgesJson = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Unknown),
)

export const parseNudges = (maybeJson: Option.Option<string>): Nudges =>
  Option.match(
    Option.flatMap(maybeJson, Schema.decodeUnknownOption(NudgesJson)),
    {
      onNone: () => ({}),
      onSome: record =>
        Record.filterMap(record, value => {
          const steps =
            typeof value === 'number' && Number.isInteger(value)
              ? toSteps(value)
              : noNudge
          return steps === 0 ? Result.failVoid : Result.succeed(steps)
        }),
    },
  )

export const toNudgesJson = (nudges: Nudges): string => JSON.stringify(nudges)

export type Segment = Readonly<{
  song: PlayableSong
  startSeconds: number
  maybeEndSeconds: Option.Option<number>
}>

const spansOf = (
  archive: ReadonlyArray<PlayableSong>,
  clicked: PlayableSong,
): ReadonlyArray<Segment> => {
  const inVideo = archive.filter(song => song.video_url === clicked.video_url)
  const songs = inVideo.length === 0 ? [clicked] : inVideo
  const sorted = songs.toSorted(
    (a, b) => timestampToSeconds(a.timestamp) - timestampToSeconds(b.timestamp),
  )
  return sorted.map((song, index) => ({
    song,
    startSeconds: timestampToSeconds(song.timestamp),
    maybeEndSeconds: Option.map(Array.get(sorted, index + 1), next =>
      timestampToSeconds(next.timestamp),
    ),
  }))
}

export const segmentAt = (
  archive: ReadonlyArray<PlayableSong>,
  clicked: PlayableSong,
  seconds: number,
): Option.Option<Segment> =>
  Array.findLast(
    spansOf(archive, clicked),
    segment => segment.startSeconds <= seconds,
  )

/** The song `by` places from the one sung at `maybeSeconds` in the video of
 *  `playing`. With no position, the play is at the start of `playing` itself,
 *  where it began. Before the first song, the next song is the first. */
export const songBeside = (
  archive: ReadonlyArray<PlayableSong>,
  playing: PlayableSong,
  maybeSeconds: Option.Option<number>,
  by: 1 | -1,
): Option.Option<PlayableSong> => {
  const spans = spansOf(archive, playing)
  const maybeIndex = Option.match(maybeSeconds, {
    onNone: () =>
      Array.findFirstIndex(spans, ({ song }) => song.id === playing.id),
    onSome: seconds =>
      Option.orElseSome(
        Array.findLastIndex(
          spans,
          ({ startSeconds }) => startSeconds <= seconds,
        ),
        () => -1,
      ),
  })
  return Option.map(
    Option.flatMap(maybeIndex, index => Array.get(spans, index + by)),
    ({ song }) => song,
  )
}

export const msIntoLyrics = (
  playheadSeconds: number,
  segment: Segment,
  offsetMs: number,
  steps: LaterNudgeSteps,
): number =>
  (playheadSeconds - segment.startSeconds) * 1000 -
  offsetMs -
  steps * NUDGE_STEP_MS

export const LyricCursor = defineTaggedUnion({
  Before: {},
  OnLine: { index: Schema.Int },
  After: {},
})
export type LyricCursor = typeof LyricCursor.Type

const AFTER_LAST_LINE_MS = 8000

export const cursorAt = (
  lines: Array.NonEmptyReadonlyArray<LyricLine>,
  ms: number,
): LyricCursor => {
  if (ms < lines[0].atMs) {
    return LyricCursor.Before()
  }
  const search = (low: number, high: number): number => {
    if (low >= high) {
      return low
    }
    const middle = Math.ceil((low + high) / 2)
    return (lines[middle]?.atMs ?? Infinity) <= ms
      ? search(middle, high)
      : search(low, middle - 1)
  }
  const index = search(0, lines.length - 1)
  const isLast = index === lines.length - 1
  return isLast && ms > (lines[index]?.atMs ?? 0) + AFTER_LAST_LINE_MS
    ? LyricCursor.After()
    : LyricCursor.OnLine({ index })
}
