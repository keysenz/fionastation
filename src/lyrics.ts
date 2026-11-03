import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

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
