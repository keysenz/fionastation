import { Option, Schema } from 'effect'
import { expect, test } from 'vitest'

import type { PlayableSong } from './domain.ts'
import {
  LaterNudgeSteps,
  LyricCursor,
  type LyricLine,
  NUDGE_LIMIT,
  Nudges,
  cursorAt,
  msIntoLyrics,
  nextSegmentSong,
  nudge,
  nudgeOf,
  parseNudges,
  segmentAt,
  toNudgesJson,
} from './lyrics.ts'

const song = (
  id: string,
  timestamp: string,
  video = 'v1',
  title = `Song ${id}`,
): PlayableSong => ({
  id,
  song_title: title,
  timestamp,
  created_at: 'x',
  video_url: video,
  title_text: 'Stream',
  membership: false,
  kind: 'karaoke',
})

const first = song('a', '00:01:00')
const second = song('b', '00:05:00')
const repeat = song('c', '00:09:00', 'v1', 'Song a')
const elsewhere = song('z', '00:00:30', 'v2')
const archive = [first, second, repeat, elsewhere]

const idAt = (seconds: number, playing = first) =>
  Option.map(segmentAt(archive, playing, seconds), ({ song }) => song.id)

test('a position before the first song of the stream has no segment', () => {
  expect(idAt(59)).toEqual(Option.none())
})

test('the song being sung is the later one, not the clicked one', () => {
  expect(idAt(60)).toEqual(Option.some('a'))
  expect(idAt(299)).toEqual(Option.some('a'))
  expect(idAt(300)).toEqual(Option.some('b'))
  expect(idAt(4000)).toEqual(Option.some('c'))
})

test('a repeated title is two segments with their own ids, told apart by position', () => {
  expect(idAt(100)).toEqual(Option.some('a'))
  expect(idAt(600)).toEqual(Option.some('c'))
})

test('seeking back before the clicked song gives the earlier song', () => {
  expect(idAt(310, second)).toEqual(Option.some('b'))
  expect(idAt(100, second)).toEqual(Option.some('a'))
})

test('a segment ends where the next song in the same video starts', () => {
  const segment = segmentAt(archive, first, 100)
  expect(Option.map(segment, s => s.maybeEndSeconds)).toEqual(
    Option.some(Option.some(300)),
  )
  expect(
    Option.map(segmentAt(archive, first, 4000), s => s.maybeEndSeconds),
  ).toEqual(Option.some(Option.none()))
})

test('a video missing from the archive falls back to the clicked song alone', () => {
  const orphan = song('o', '00:02:00', 'gone')
  expect(Option.map(segmentAt(archive, orphan, 500), s => s.song.id)).toEqual(
    Option.some('o'),
  )
  expect(segmentAt(archive, orphan, 10)).toEqual(Option.none())
})

test('the next segment song is the following one in the same video', () => {
  const segment = Option.getOrThrow(segmentAt(archive, first, 100))
  expect(Option.map(nextSegmentSong(archive, segment), ({ id }) => id)).toEqual(
    Option.some('b'),
  )
  const last = Option.getOrThrow(segmentAt(archive, first, 4000))
  expect(nextSegmentSong(archive, last)).toEqual(Option.none())
})

const lines = (...times: number[]): [LyricLine, ...LyricLine[]] => {
  const [head = 0, ...rest] = times
  return [
    { atMs: head, text: 'line 0' },
    ...rest.map((atMs, i) => ({ atMs, text: `line ${i + 1}` })),
  ]
}

test('the cursor is Before, on a line, or After the last line plus 8 seconds', () => {
  const song = lines(1000, 5000, 9000)
  expect(cursorAt(song, 999)).toEqual(LyricCursor.Before())
  expect(cursorAt(song, 1000)).toEqual(LyricCursor.OnLine({ index: 0 }))
  expect(cursorAt(song, 4999)).toEqual(LyricCursor.OnLine({ index: 0 }))
  expect(cursorAt(song, 5000)).toEqual(LyricCursor.OnLine({ index: 1 }))
  expect(cursorAt(song, 17000)).toEqual(LyricCursor.OnLine({ index: 2 }))
  expect(cursorAt(song, 17001)).toEqual(LyricCursor.After())
})

test('the cursor matches a linear scan for random sorted lines and times', () => {
  let seed = 12345
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  for (let round = 0; round < 300; round++) {
    const count = 1 + Math.floor(next() * 30)
    const times = Array.from({ length: count }, () =>
      Math.floor(next() * 60000),
    ).toSorted((a, b) => a - b)
    const song = lines(...times)
    const ms = Math.floor(next() * 80000) - 5000
    const lastIndex = song.findLastIndex(line => line.atMs <= ms)
    const lastAt = song[song.length - 1]?.atMs ?? 0
    const expected =
      lastIndex === -1
        ? LyricCursor.Before()
        : lastIndex === song.length - 1 && ms > lastAt + 8000
          ? LyricCursor.After()
          : LyricCursor.OnLine({ index: lastIndex })
    expect(cursorAt(song, ms)).toEqual(expected)
  }
})

test('a positive nudge moves the lyrics later and an offset likewise', () => {
  const segment = Option.getOrThrow(segmentAt(archive, first, 100))
  const none = LaterNudgeSteps.make(0)
  expect(msIntoLyrics(70, segment, 0, none)).toBe(10000)
  expect(msIntoLyrics(70, segment, 800, none)).toBe(9200)
  expect(msIntoLyrics(70, segment, 0, LaterNudgeSteps.make(3))).toBe(8500)
  expect(msIntoLyrics(70, segment, 0, LaterNudgeSteps.make(-2))).toBe(11000)
})

test('nudging steps by half a second, clamps, and drops an entry that returns to zero', () => {
  const once = nudge({}, 'a', 1)
  expect(nudgeOf(once, 'a')).toBe(1)
  expect(nudge(once, 'a', -1)).toEqual({})
  const maxed = Array.from({ length: NUDGE_LIMIT + 5 }).reduce<
    ReturnType<typeof nudge>
  >(nudges => nudge(nudges, 'a', 1), {})
  expect(nudgeOf(maxed, 'a')).toBe(NUDGE_LIMIT)
  expect(nudgeOf({}, 'unknown')).toBe(0)
})

test('nudges round trip through JSON', () => {
  const nudges = nudge(nudge(nudge({}, 'a', 1), 'a', 1), 'b', -1)
  expect(parseNudges(Option.some(toNudgesJson(nudges)))).toEqual(nudges)
})

test('garbage nudge data gives none, and a corrupt entry is dropped without losing the rest', () => {
  expect(parseNudges(Option.none())).toEqual({})
  expect(parseNudges(Option.some('not json'))).toEqual({})
  expect(parseNudges(Option.some('[1,2]'))).toEqual({})
  expect(
    parseNudges(
      Option.some(
        '{"a":3,"b":1.5,"c":"2","d":0,"e":null,"f":999,"g":-999,"h":-2}',
      ),
    ),
  ).toEqual({ a: 3, f: NUDGE_LIMIT, g: -NUDGE_LIMIT, h: -2 })
})

test('the nudge schemas reject a zero entry and a step past the limit', () => {
  const decode = Schema.decodeUnknownOption(Nudges)
  expect(Option.isSome(decode({ a: 3 }))).toBe(true)
  expect(Option.isNone(decode({ a: 0 }))).toBe(true)
  expect(Option.isNone(decode({ a: NUDGE_LIMIT + 1 }))).toBe(true)
})
