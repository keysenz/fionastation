// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

import {
  type LocalSong,
  localLyricsFor,
  parseLocalLyrics,
} from './localLyrics.ts'
import type { AlignedSong } from './lyricsMatch.ts'

const gentari: LocalSong = {
  id: '9800e03e',
  songTitle: 'Gentari Hariku',
  track: 'Gentari Hariku',
  artist: 'Rumah Kewinci',
  source: "the original video's description",
  lines: ['Waktu berlalu tanpa kusadari', 'Hingga tibalah hari ini'],
}

const timed = (over: Partial<AlignedSong> = {}): AlignedSong => ({
  songTitle: 'Gentari Hariku',
  lrclibId: 0,
  source: 'Local',
  lines: [
    { atMs: 0, text: 'Waktu berlalu tanpa kusadari' },
    { atMs: 4000, text: 'Hingga tibalah hari ini' },
  ],
  ...over,
})

test('the real local file parses and holds Gentari Hariku', () => {
  const local = parseLocalLyrics(
    JSON.parse(
      readFileSync(new URL('./lyrics-local.json', import.meta.url), 'utf8'),
    ),
  )
  const entry = local.get('9800e03e-f8a7-530f-8ea1-2b3c39244da1')
  expect(entry?.songTitle).toBe('Gentari Hariku')
  expect(entry?.artist).toBe('Rumah Kewinci')
  expect(entry?.lines.length).toBe(31)
})

test('timed local text is served with its credit and offset', () => {
  expect(
    localLyricsFor({ id: '9800e03e', title: 'Gentari Hariku' }, gentari, timed(), -500),
  ).toEqual({
    _tag: 'Synced',
    lines: timed().lines,
    offsetMs: -500,
    credit: {
      source: "the original video's description",
      track: 'Gentari Hariku',
      artist: 'Rumah Kewinci',
    },
  })
})

test('nothing is served before the batch has timed the text', () => {
  expect(
    localLyricsFor({ id: '9800e03e', title: 'Gentari Hariku' }, gentari, undefined, 0),
  ).toBeUndefined()
})

test('an LRCLIB alignment does not time local text', () => {
  const lrclibTimed = timed({ source: 'LRCLIB', lrclibId: 42 })
  expect(
    localLyricsFor({ id: '9800e03e', title: 'Gentari Hariku' }, gentari, lrclibTimed, 0),
  ).toBeUndefined()
})

test('a local alignment is ignored once the song has been renamed', () => {
  expect(
    localLyricsFor({ id: '9800e03e', title: 'Gentari Hariku (short)' }, gentari, timed(), 0),
  ).toBeUndefined()
})

test('a song with no local entry is left to LRCLIB', () => {
  expect(
    localLyricsFor({ id: 'x', title: 'Gentari Hariku' }, undefined, timed(), 0),
  ).toBeUndefined()
})

test('parseLocalLyrics rejects bad files with a path', () => {
  const { id: _, ...fields } = gentari
  const entry = { ...fields, lines: ['a'] }
  expect(() =>
    parseLocalLyrics({ a: { ...entry, extra: true } }),
  ).toThrow(/\$\["a"\]\.extra: unknown field/)
  expect(() => parseLocalLyrics({ a: { ...entry, lines: [] } })).toThrow(
    /lines: expected at least one line/,
  )
  expect(() => parseLocalLyrics({ a: { ...entry, lines: ['a', ''] } })).toThrow(
    /lines\[1\]/,
  )
  expect(() => parseLocalLyrics({ a: { ...entry, source: '' } })).toThrow(
    /source/,
  )
})
