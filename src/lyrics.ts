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

/** Where the video is, tied to the play that reported it so another play never reads it. */
export const Playhead = Schema.Struct({
  playId: Schema.Number,
  seconds: Schema.Number,
})
export type Playhead = typeof Playhead.Type

export const NUDGE_LIMIT = 40
export const NUDGE_STEP_MS = 500

/** Half-second steps. Positive means the lyrics run later. Always within the limit. */
export const NudgeSteps = Schema.Int.pipe(Schema.brand('NudgeSteps'))
export type NudgeSteps = typeof NudgeSteps.Type

export const noNudge = NudgeSteps.make(0)

const toSteps = (steps: number): NudgeSteps =>
  NudgeSteps.make(Math.max(-NUDGE_LIMIT, Math.min(NUDGE_LIMIT, steps)))

/** Keyed by song id, since a rough timestamp belongs to one occurrence in one stream. Never holds a zero. */
export const Nudges = Schema.Record(Schema.String, NudgeSteps)
export type Nudges = typeof Nudges.Type

export const nudgeOf = (nudges: Nudges, songId: string): NudgeSteps =>
  Option.getOrElse(Record.get(nudges, songId), () => noNudge)

/** Clamps to the limit and removes the entry when it reaches zero. */
export const nudge = (nudges: Nudges, songId: string, by: -1 | 1): Nudges => {
  const next = toSteps(nudgeOf(nudges, songId) + by)
  return next === 0
    ? Record.remove(nudges, songId)
    : { ...nudges, [songId]: next }
}

const NudgesJson = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Unknown),
)

/** Missing or corrupt data gives no nudges. A corrupt entry is dropped and the valid ones stay. */
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

/** A song's span in its video: from its timestamp to the next song's. */
export type Segment = Readonly<{
  song: PlayableSong
  startSeconds: number
  maybeEndSeconds: Option.Option<number>
}>

const spansOf = (
  archive: ReadonlyArray<PlayableSong>,
  playing: PlayableSong,
): ReadonlyArray<Segment> => {
  const inVideo = archive.filter(song => song.video_url === playing.video_url)
  const songs = inVideo.length === 0 ? [playing] : inVideo
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

/** The song being sung at `seconds` in the video of `playing`, which is only the song that
 *  was clicked and that the stream then moves past. Falls back to `playing` alone when the
 *  archive lacks its video. None before the first song of the stream. */
export const segmentAt = (
  archive: ReadonlyArray<PlayableSong>,
  playing: PlayableSong,
  seconds: number,
): Option.Option<Segment> =>
  Array.findLast(
    spansOf(archive, playing),
    segment => segment.startSeconds <= seconds,
  )

/** The song after `segment` in its video, whose lyrics are fetched ahead of time. */
export const nextSegmentSong = (
  archive: ReadonlyArray<PlayableSong>,
  segment: Segment,
): Option.Option<PlayableSong> => {
  const spans = spansOf(archive, segment.song)
  return Option.map(
    Option.flatMap(
      Array.findFirstIndex(spans, span => span.song.id === segment.song.id),
      index => Array.get(spans, index + 1),
    ),
    span => span.song,
  )
}

export const msIntoLyrics = (
  playheadSeconds: number,
  segment: Segment,
  offsetMs: number,
  steps: NudgeSteps,
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

/** The last line stays lit this long, then the song counts as over. */
const AFTER_LAST_LINE_MS = 8000

/** The last line starting at or before `ms`, found by binary search. */
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
