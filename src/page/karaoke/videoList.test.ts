import { Option } from 'effect'
import { expect, test } from 'vitest'

import type { PlayableSong } from '../../domain.ts'
import { groupByVideo, resolveSelection, searchVideos } from './videoList.ts'

const song = (
  id: string,
  songTitle: string,
  video: string,
  videoTitle: string,
  artist = '',
  originalTitle = songTitle,
  version = '',
  note = '',
): PlayableSong => ({
  id,
  song_title: songTitle,
  artist,
  original_title: originalTitle,
  version,
  note,
  timestamp: '00:01:00',
  created_at: 'x',
  video_url: video,
  title_text: videoTitle,
  membership: false,
  kind: 'karaoke',
})

const songs = [
  song('1', 'Satu Bulan', 'new', 'Karaoke Night'),
  song('2', 'Tabako', 'new', 'Karaoke Night', 'Kobasolo'),
  song('3', 'Satu Bulan', 'gone', 'Lost Stream'),
  song('4', 'Satu Bulan (Short)', 'mid', 'Stream Bentar'),
  song('5', 'Tabako', 'mid', 'Stream Bentar'),
  song('6', 'Hello', 'mid', 'Stream Bentar', 'Adele', 'Adele - Hello ft. Ren'),
  song(
    '7',
    'Tabako',
    'old',
    'Old Karaoke',
    '',
    'Tabako',
    'acapella',
    'DAZBEE cover',
  ),
]
const groups = groupByVideo(songs, ['gone'])
const shapeOf = (shown: ReturnType<typeof searchVideos>) =>
  shown.map(group => [group.videoId, group.songs.map(({ id }) => id)])

test('groups keep archive order and song order, and gone videos go last', () => {
  expect(groups.map(group => group.videoId)).toEqual([
    'new',
    'mid',
    'old',
    'gone',
  ])
  expect(groups[1]?.songs.map(({ id }) => id)).toEqual(['4', '5', '6'])
  expect(groups.map(group => group.isGone)).toEqual([false, false, false, true])
  expect(groups[0]?.title).toBe('Karaoke Night')
})

test('a blank query returns every group unchanged', () => {
  expect(searchVideos(groups, '')).toBe(groups)
  expect(searchVideos(groups, '   ')).toBe(groups)
})

test('a search keeps only matching songs and drops videos without one', () => {
  expect(shapeOf(searchVideos(groups, 'satu bulan'))).toEqual([
    ['new', ['1']],
    ['mid', ['4']],
    ['gone', ['3']],
  ])
})

test('matching is case-insensitive and also reads the video title', () => {
  expect(shapeOf(searchVideos(groups, 'TABAKO'))).toEqual([
    ['new', ['2']],
    ['mid', ['5']],
    ['old', ['7']],
  ])
  expect(shapeOf(searchVideos(groups, 'stream bentar'))).toEqual([
    ['mid', ['4', '5', '6']],
  ])
})

test('a search matches the artist and names kept only in the original title', () => {
  expect(shapeOf(searchVideos(groups, 'kobasolo'))).toEqual([['new', ['2']]])
  expect(shapeOf(searchVideos(groups, 'ADELE'))).toEqual([['mid', ['6']]])
  expect(shapeOf(searchVideos(groups, 'ren'))).toEqual([['mid', ['6']]])
})

test('a search matches the version and the note, like the bot', () => {
  expect(shapeOf(searchVideos(groups, 'dazbee'))).toEqual([['old', ['7']]])
  expect(shapeOf(searchVideos(groups, 'Acapella'))).toEqual([['old', ['7']]])
})

test('a misspelled artist falls back to fuzzy matching', () => {
  expect(shapeOf(searchVideos(groups, 'kobasolp'))).toEqual([['new', ['2']]])
})

test('a matching gone video still appears, after the live ones', () => {
  const shown = searchVideos(groups, 'satu bulan')
  expect(shown.at(-1)?.isGone).toBe(true)
})

test('a typo falls back to fuzzy song matching and still follows archive order', () => {
  expect(shapeOf(searchVideos(groups, 'satu bulam'))).toEqual([
    ['new', ['1']],
    ['mid', ['4']],
    ['gone', ['3']],
  ])
})

test('fuzzy matching is not used when a literal match exists', () => {
  expect(shapeOf(searchVideos(groups, 'hello'))).toEqual([['mid', ['6']]])
})

test('a query that matches nothing shows nothing', () => {
  expect(searchVideos(groups, 'xyzzy')).toEqual([])
})

test('a chosen video the search hides falls back to the first match, and returns when the search clears', () => {
  const chosen = Option.some('old')
  const hidden = resolveSelection(searchVideos(groups, 'satu bulan'), chosen)
  expect(Option.map(hidden.maybeVideo, video => video.videoId)).toEqual(
    Option.some('new'),
  )
  expect(hidden.isChosen).toBe(false)
  const cleared = resolveSelection(groups, chosen)
  expect(Option.map(cleared.maybeVideo, video => video.videoId)).toEqual(
    Option.some('old'),
  )
  expect(cleared.isChosen).toBe(true)
})

test('with nothing chosen the first video shows, and an empty search shows none', () => {
  expect(
    Option.map(
      resolveSelection(groups, Option.none()).maybeVideo,
      video => video.videoId,
    ),
  ).toEqual(Option.some('new'))
  expect(
    Option.isNone(resolveSelection([], Option.some('new')).maybeVideo),
  ).toBe(true)
})
