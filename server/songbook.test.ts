// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

import { parseCsv, toSongbook } from './songbook.ts'

const fixture = readFileSync(
  join(import.meta.dirname, 'fixtures/songbook.csv'),
  'utf8',
)

test('quoted cells keep their commas and doubled quotes', () => {
  expect(parseCsv('a,"b, c","say ""hi"""\r\nd,,e')).toEqual([
    ['a', 'b, c', 'say "hi"'],
    ['d', '', 'e'],
  ])
})

test('the real sheet splits into JP and ID songs and viewer requests', () => {
  const songbook = toSongbook(parseCsv(fixture))
  const titlesIn = (language: string) =>
    songbook.songs
      .filter(song => song.language === language)
      .map(song => song.title)

  expect(titlesIn('JP')[0]).toBe('Dakara, Hitori ja Nai')
  expect(titlesIn('JP')).toContain('Shiawase')
  expect(titlesIn('JP').at(-1)).toBe('Dry Flower')
  expect(titlesIn('ID')[0]).toBe('Perahu kertas')
  expect(titlesIn('ID').at(-1)).toBe('raksa')
  expect(new Set(songbook.songs.map(song => song.language))).toEqual(
    new Set(['JP', 'ID']),
  )
  expect(songbook.requests[0]).toBe('phoebe - crown')
  expect(songbook.requests.at(-1)).toBe('Lagu nikah')
})

test('a column labelled Request counts as requests, not a language', () => {
  expect(toSongbook(parseCsv('JP,Request\nHomura,Crown\n'))).toEqual({
    songs: [{ title: 'Homura', language: 'JP' }],
    requests: ['Crown'],
  })
})

test('an empty sheet is an empty songbook', () => {
  expect(toSongbook(parseCsv(''))).toEqual({ songs: [], requests: [] })
})
