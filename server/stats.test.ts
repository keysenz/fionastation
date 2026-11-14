// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { SongForStats } from './db.ts'
import { MOODS as PAGE_MOODS } from '../src/page/karaoke/moodPrompt.ts'
import {
  MOODS,
  type StatEvent,
  type StatStore,
  createStatApi,
  createStatReport,
  openStatStore,
  parseStatEvent,
} from './stats.ts'

let dir: string
let dbPath: string
let clock: Date
const now = () => clock

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stats-test-'))
  dbPath = join(dir, 'stats.db')
  clock = new Date('2026-11-14T10:00:00Z')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const SONGS: readonly SongForStats[] = [
  {
    songId: 'a1',
    title: 'Alpha',
    artist: 'Artist A',
    videoId: 'v1',
    videoTitle: 'Stream one',
    videoUrl: 'https://youtu.be/v1',
  },
  {
    songId: 'a2',
    title: 'Beta',
    artist: 'Artist B',
    videoId: 'v1',
    videoTitle: 'Stream one',
    videoUrl: 'https://youtu.be/v1',
  },
  {
    songId: 'b1',
    title: 'Gamma',
    artist: 'Artist C',
    videoId: 'v2',
    videoTitle: 'Stream two',
    videoUrl: 'https://youtu.be/v2',
  },
]

const findSongs = (ids: readonly string[]) =>
  SONGS.filter(song => ids.includes(song.songId))
const songExists = (id: string) => SONGS.some(song => song.songId === id)

const post = (body: unknown) => JSON.stringify(body)
const play = (songId: string, origin = 'Visitor') =>
  post({ songId, kind: 'Play', origin })

const record = (store: StatStore, ...events: StatEvent[]) =>
  events.forEach(event => store.record(event))

const counted = (
  kind: 'Click' | 'Play' | 'Finish',
  songId: string,
  origin: 'Visitor' | 'Autoplay' = 'Visitor',
): StatEvent => ({ kind, songId, origin })

const skip = (
  songId: string,
  secondsIntoSong: number,
  origin: 'Visitor' | 'Autoplay' = 'Visitor',
): StatEvent => ({ kind: 'Skip', songId, origin, secondsIntoSong })

const reportOf = (store: StatStore, days: string | null = null) => {
  const answer = createStatReport({ store, findSongs, now })(days)
  expect(answer.status).toBe(200)
  return answer.body as {
    days: number
    since: string
    songs: Array<Record<string, any>>
    videos: Array<Record<string, any>>
    daily: Array<Record<string, any>>
    skipBuckets: Array<{ songId: string; bucket: number; count: number }>
  }
}

describe('store', () => {
  test('counts add up for each song, kind and origin, and stay apart', () => {
    const store = openStatStore({ path: dbPath, now })
    record(
      store,
      counted('Play', 'a1'),
      counted('Play', 'a1'),
      counted('Play', 'a1', 'Autoplay'),
      counted('Finish', 'a1'),
      counted('Click', 'a1'),
      counted('Play', 'a2'),
    )
    const totals = store.totalsSince('2026-11-14')
    const countOf = (songId: string, kind: string, origin: string) =>
      totals.find(
        total =>
          total.songId === songId &&
          total.kind === kind &&
          total.origin === origin,
      )?.count
    expect(countOf('a1', 'Play', 'Visitor')).toBe(2)
    expect(countOf('a1', 'Play', 'Autoplay')).toBe(1)
    expect(countOf('a1', 'Finish', 'Visitor')).toBe(1)
    expect(countOf('a1', 'Click', 'Visitor')).toBe(1)
    expect(countOf('a2', 'Play', 'Visitor')).toBe(1)
  })

  test('counts persist across a reopen and split by UTC day', () => {
    const first = openStatStore({ path: dbPath, now })
    record(first, counted('Play', 'a1'))
    clock = new Date('2026-11-15T00:00:01Z')
    const reopened = openStatStore({ path: dbPath, now })
    record(reopened, counted('Play', 'a1'), counted('Play', 'a1'))
    const sum = (firstDay: string) =>
      reopened
        .totalsSince(firstDay)
        .reduce((total, { count }) => total + count, 0)
    expect(sum('2026-11-14')).toBe(3)
    expect(sum('2026-11-15')).toBe(2)
  })

  test('a skip is its own row and never a counter', () => {
    const store = openStatStore({ path: dbPath, now })
    record(store, skip('a1', 42), skip('a1', 7, 'Autoplay'))
    expect(store.totalsSince('2026-11-14')).toEqual([])
    expect(store.skipsSince('2026-11-14')).toEqual([
      { songId: 'a1', origin: 'Visitor', secondsIntoSong: 42 },
      { songId: 'a1', origin: 'Autoplay', secondsIntoSong: 7 },
    ])
  })

  test('the skip table holds the day and the seconds and nothing that identifies a visitor', () => {
    const store = openStatStore({ path: dbPath, now })
    record(store, skip('a1', 42))
    const check = new DatabaseSync(dbPath, { readOnly: true })
    const columns = check
      .prepare('SELECT name FROM pragma_table_info(?)')
      .all('skips')
      .map(({ name }) => name)
    expect(columns).toEqual(['day', 'song_id', 'origin', 'seconds_into_song'])
    expect(check.prepare('SELECT day FROM skips').get()).toEqual({
      day: '2026-11-14',
    })
  })
})

describe('parseStatEvent', () => {
  test('accepts one or two distinct moods', () => {
    expect(
      parseStatEvent(post({ songId: 'a1', kind: 'Mood', moods: ['ceria'] })),
    ).toEqual({ kind: 'Mood', songId: 'a1', moods: ['ceria'] })
    expect(
      parseStatEvent(
        post({ songId: 'a1', kind: 'Mood', moods: ['sendu', 'galau'] }),
      ),
    ).toEqual({ kind: 'Mood', songId: 'a1', moods: ['sendu', 'galau'] })
  })

  test.each([
    ['no moods', { songId: 'a1', kind: 'Mood', moods: [] }],
    [
      'three moods',
      { songId: 'a1', kind: 'Mood', moods: ['ceria', 'galau', 'hype'] },
    ],
    ['an unknown mood', { songId: 'a1', kind: 'Mood', moods: ['angry'] }],
    [
      'a repeated mood',
      { songId: 'a1', kind: 'Mood', moods: ['ceria', 'ceria'] },
    ],
    ['moods that are not a list', { songId: 'a1', kind: 'Mood', moods: 'hype' }],
    ['a missing song', { kind: 'Mood', moods: ['hype'] }],
    [
      'an origin',
      { songId: 'a1', kind: 'Mood', moods: ['hype'], origin: 'Visitor' },
    ],
    [
      'seconds into the song',
      { songId: 'a1', kind: 'Mood', moods: ['hype'], secondsIntoSong: 3 },
    ],
    [
      'a session id',
      { songId: 'a1', kind: 'Mood', moods: ['hype'], sessionId: 'x' },
    ],
  ])('rejects a mood vote with %s', (_label, body) => {
    expect(parseStatEvent(post(body))).toBeUndefined()
  })

  test('the mood list matches the one the page offers', () => {
    expect(MOODS).toEqual(PAGE_MOODS)
  })

  test('accepts each kind with its origin', () => {
    expect(parseStatEvent(play('a1', 'Autoplay'))).toEqual({
      kind: 'Play',
      songId: 'a1',
      origin: 'Autoplay',
    })
    expect(
      parseStatEvent(
        post({
          songId: 'a1',
          kind: 'Skip',
          origin: 'Visitor',
          secondsIntoSong: 12,
        }),
      ),
    ).toEqual({
      kind: 'Skip',
      songId: 'a1',
      origin: 'Visitor',
      secondsIntoSong: 12,
    })
  })

  test.each([
    ['not json', 'nope'],
    ['not an object', '3'],
    ['unknown kind', post({ songId: 'a1', kind: 'Hover', origin: 'Visitor' })],
    ['unknown origin', post({ songId: 'a1', kind: 'Play', origin: 'Bot' })],
    ['missing song', post({ kind: 'Play', origin: 'Visitor' })],
    ['empty song', post({ songId: '', kind: 'Play', origin: 'Visitor' })],
    [
      'an autoplay click',
      post({ songId: 'a1', kind: 'Click', origin: 'Autoplay' }),
    ],
    [
      'a skip without seconds',
      post({ songId: 'a1', kind: 'Skip', origin: 'Visitor' }),
    ],
    [
      'a skip with fractional seconds',
      post({
        songId: 'a1',
        kind: 'Skip',
        origin: 'Visitor',
        secondsIntoSong: 1.5,
      }),
    ],
    [
      'a skip with negative seconds',
      post({
        songId: 'a1',
        kind: 'Skip',
        origin: 'Visitor',
        secondsIntoSong: -1,
      }),
    ],
    [
      'seconds on another kind',
      post({
        songId: 'a1',
        kind: 'Play',
        origin: 'Visitor',
        secondsIntoSong: 3,
      }),
    ],
    [
      'an extra field',
      post({ songId: 'a1', kind: 'Play', origin: 'Visitor', visitor: 'x' }),
    ],
  ])('rejects %s', (_label, body) => {
    expect(parseStatEvent(body)).toBeUndefined()
  })
})

describe('write api', () => {
  const open = (options: { perIpPerHour?: number } = {}) => {
    const store = openStatStore({ path: dbPath, now })
    return {
      store,
      api: createStatApi({ store, songExists, now, ...options }),
    }
  }

  test('records a known song and answers 204', () => {
    const { store, api } = open()
    expect(api({ ip: '1.1.1.1', body: play('a1') }).status).toBe(204)
    expect(store.totalsSince('2026-11-14')).toEqual([
      { songId: 'a1', kind: 'Play', origin: 'Visitor', count: 1 },
    ])
  })

  test('records a mood vote as one bump per mood and answers 204', () => {
    const { store, api } = open()
    const vote = post({ songId: 'a1', kind: 'Mood', moods: ['ceria', 'hype'] })
    expect(api({ ip: '1.1.1.1', body: vote }).status).toBe(204)
    expect(api({ ip: '2.2.2.2', body: vote }).status).toBe(204)
    expect(store.moodsSince('2026-11-14')).toEqual(
      expect.arrayContaining([
        { songId: 'a1', mood: 'ceria', count: 2 },
        { songId: 'a1', mood: 'hype', count: 2 },
      ]),
    )
    expect(store.moodsSince('2026-11-14')).toHaveLength(2)
    expect(store.totalsSince('2026-11-14')).toEqual([])
  })

  test('rejects a mood vote for a song that is not in the archive', () => {
    const { store, api } = open()
    const vote = post({ songId: 'ghost', kind: 'Mood', moods: ['ceria'] })
    expect(api({ ip: '1.1.1.1', body: vote }).status).toBe(404)
    expect(store.moodsSince('2026-11-14')).toEqual([])
  })

  test('the mood table holds the day, the song, the mood and a count and nothing that identifies a visitor', () => {
    openStatStore({ path: dbPath, now })
    const columns = new DatabaseSync(dbPath)
      .prepare("SELECT name FROM pragma_table_info('mood_votes')")
      .all()
      .map(row => row.name)
    expect(columns).toEqual(['day', 'song_id', 'mood', 'count'])
  })

  test('rejects a song that is not in the archive and records nothing', () => {
    const { store, api } = open()
    expect(api({ ip: '1.1.1.1', body: play('ghost') }).status).toBe(404)
    expect(store.totalsSince('2026-11-14')).toEqual([])
  })

  test('rejects a malformed body with 400 and records nothing', () => {
    const { store, api } = open()
    expect(
      api({
        ip: '1.1.1.1',
        body: post({ songId: 'a1', kind: 'Play', origin: 'Bot' }),
      }).status,
    ).toBe(400)
    expect(store.totalsSince('2026-11-14')).toEqual([])
  })

  test('limits each address per hour and lets it back in after the hour', () => {
    const { api } = open({ perIpPerHour: 2 })
    const statuses = () =>
      ['1.1.1.1', '1.1.1.1', '1.1.1.1', '2.2.2.2'].map(
        ip => api({ ip, body: play('a1') }).status,
      )
    expect(statuses()).toEqual([204, 204, 429, 204])
    clock = new Date(clock.getTime() + 61 * 60 * 1000)
    expect(api({ ip: '1.1.1.1', body: play('a1') }).status).toBe(204)
  })

  test('a store that fails answers 500 and leaks nothing', () => {
    const broken: StatStore = {
      ...openStatStore({ path: dbPath, now }),
      record: () => {
        throw new Error('disk is gone')
      },
    }
    const api = createStatApi({ store: broken, songExists, now })
    const answer = api({ ip: '1.1.1.1', body: play('a1') })
    expect(answer.status).toBe(500)
    expect(JSON.stringify(answer.body)).not.toContain('disk')
  })
})

describe('report', () => {
  test('carries per-song mood counts, most voted first, with titles', () => {
    const store = openStatStore({ path: dbPath, now })
    record(
      store,
      { kind: 'Mood', songId: 'a1', moods: ['ceria'] },
      { kind: 'Mood', songId: 'b1', moods: ['sendu', 'galau'] },
      { kind: 'Mood', songId: 'b1', moods: ['sendu'] },
    )
    const answer = createStatReport({ store, findSongs, now })(null)
    const { moods } = answer.body as { moods: Array<Record<string, any>> }
    expect(moods.map(song => song.songId)).toEqual(['b1', 'a1'])
    expect(moods[0]?.votes).toEqual({
      ceria: 0,
      galau: 1,
      hype: 0,
      chill: 0,
      romantis: 0,
      sendu: 2,
    })
    expect(moods[1]?.title).toBe(SONGS[0]?.title)
  })

  test('a window that excludes the day leaves the moods out', () => {
    const store = openStatStore({ path: dbPath, now })
    record(store, { kind: 'Mood', songId: 'a1', moods: ['ceria'] })
    clock = new Date('2026-11-20T10:00:00Z')
    const answer = createStatReport({ store, findSongs, now })('3')
    expect((answer.body as { moods: unknown[] }).moods).toEqual([])
  })

  test('sorts songs and videos by visitor plays, then autoplay plays', () => {
    const store = openStatStore({ path: dbPath, now })
    record(
      store,
      counted('Play', 'a1'),
      counted('Play', 'a2'),
      counted('Play', 'a2'),
      counted('Play', 'b1'),
      counted('Play', 'b1', 'Autoplay'),
      counted('Play', 'b1', 'Autoplay'),
      counted('Click', 'a1'),
    )
    const report = reportOf(store)
    expect(report.songs.map(song => song.songId)).toEqual(['a2', 'b1', 'a1'])
    const [stream] = report.videos
    expect(report.videos.map(video => video.videoId)).toEqual(['v1', 'v2'])
    expect(stream?.plays).toEqual({ Visitor: 3, Autoplay: 0 })
    expect(stream?.clicks).toBe(1)
  })

  test('breaks a tie of plays by autoplay plays, then clicks', () => {
    const store = openStatStore({ path: dbPath, now })
    record(
      store,
      counted('Play', 'a1'),
      counted('Play', 'a2'),
      counted('Play', 'a2', 'Autoplay'),
      counted('Play', 'b1'),
      counted('Click', 'b1'),
    )
    expect(reportOf(store).songs.map(song => song.songId)).toEqual([
      'a2',
      'b1',
      'a1',
    ])
  })

  test('carries song and video titles from the archive', () => {
    const store = openStatStore({ path: dbPath, now })
    record(store, counted('Play', 'a1'))
    const [song] = reportOf(store).songs
    expect(song).toMatchObject({
      title: 'Alpha',
      artist: 'Artist A',
      videoId: 'v1',
    })
    expect(reportOf(store).videos[0]).toMatchObject({
      videoTitle: 'Stream one',
    })
  })

  test('a song gone from the archive stays in the songs and out of the videos', () => {
    const store = openStatStore({ path: dbPath, now })
    record(store, counted('Play', 'removed'))
    const report = reportOf(store)
    expect(report.songs).toHaveLength(1)
    expect(report.songs[0]).toMatchObject({ songId: 'removed', title: null })
    expect(report.videos).toEqual([])
  })

  test('lists skips by origin with the median seconds into the song', () => {
    const store = openStatStore({ path: dbPath, now })
    record(
      store,
      skip('a1', 10),
      skip('a1', 50),
      skip('a1', 30, 'Autoplay'),
      skip('a2', 40),
      skip('a2', 20),
      counted('Play', 'a1'),
    )
    const report = reportOf(store)
    const a1 = report.songs.find(song => song.songId === 'a1')
    const a2 = report.songs.find(song => song.songId === 'a2')
    expect(a1?.skips).toEqual({ Visitor: 2, Autoplay: 1 })
    expect(a1?.medianSecondsIntoSkip).toBe(30)
    expect(a2?.skips).toEqual({ Visitor: 2, Autoplay: 0 })
    expect(a2?.medianSecondsIntoSkip).toBe(30)
    expect(report.videos[0]?.skips).toEqual({ Visitor: 4, Autoplay: 1 })
  })

  test('a song with plays and no skips has no median', () => {
    const store = openStatStore({ path: dbPath, now })
    record(store, counted('Play', 'a1'))
    expect(reportOf(store).songs[0]?.medianSecondsIntoSkip).toBeNull()
  })

  test('days limits the window to today and the days before it', () => {
    const store = openStatStore({ path: dbPath, now })
    record(store, counted('Play', 'a1'), skip('a1', 5))
    clock = new Date('2026-11-16T10:00:00Z')
    record(store, counted('Play', 'a2'))
    expect(reportOf(store, '1').songs.map(song => song.songId)).toEqual(['a2'])
    expect(
      reportOf(store, '3')
        .songs.map(song => song.songId)
        .sort(),
    ).toEqual(['a1', 'a2'])
    expect(reportOf(store, '3').since).toBe('2026-11-14')
    expect(reportOf(store).days).toBe(30)
  })

  test('daily lists every UTC day of the window with plays by origin, clicks, finishes and skips', () => {
    const store = openStatStore({ path: dbPath, now })
    record(
      store,
      counted('Click', 'a1'),
      counted('Play', 'a1'),
      counted('Play', 'a2'),
      counted('Play', 'a2', 'Autoplay'),
      counted('Finish', 'a1'),
      skip('a2', 12),
      skip('a1', 3, 'Autoplay'),
    )
    clock = new Date('2026-11-16T10:00:00Z')
    record(store, counted('Play', 'b1'), skip('b1', 40))
    const { daily } = reportOf(store, '3')
    expect(daily.map(day => day.day)).toEqual([
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
    ])
    expect(daily[0]).toEqual({
      day: '2026-11-14',
      clicks: 1,
      plays: { Visitor: 2, Autoplay: 1 },
      finishes: { Visitor: 1, Autoplay: 0 },
      skips: { Visitor: 1, Autoplay: 1 },
    })
    expect(daily[1]).toEqual({
      day: '2026-11-15',
      clicks: 0,
      plays: { Visitor: 0, Autoplay: 0 },
      finishes: { Visitor: 0, Autoplay: 0 },
      skips: { Visitor: 0, Autoplay: 0 },
    })
    expect(daily[2]?.plays).toEqual({ Visitor: 1, Autoplay: 0 })
    expect(daily[2]?.skips).toEqual({ Visitor: 1, Autoplay: 0 })
  })

  test('daily has one empty row for today when nothing was recorded', () => {
    const store = openStatStore({ path: dbPath, now })
    expect(reportOf(store, '1').daily).toHaveLength(1)
  })

  test('skipBuckets count skips per song in ten second buckets and cap the last one', () => {
    const store = openStatStore({ path: dbPath, now })
    record(
      store,
      skip('a1', 0),
      skip('a1', 9),
      skip('a1', 10),
      skip('a2', 10),
      skip('a1', 299),
      skip('a1', 300),
      skip('a1', 7200),
    )
    const buckets = reportOf(store).skipBuckets
    const countOf = (songId: string, bucket: number) =>
      buckets.find(entry => entry.songId === songId && entry.bucket === bucket)
        ?.count
    expect(countOf('a1', 0)).toBe(2)
    expect(countOf('a1', 1)).toBe(1)
    expect(countOf('a2', 1)).toBe(1)
    expect(countOf('a1', 29)).toBe(1)
    expect(countOf('a1', 30)).toBe(2)
    expect(buckets.every(entry => entry.bucket <= 30)).toBe(true)
  })

  test.each(['0', '-1', 'x', '1.5', '99999'])('rejects days=%s', days => {
    const store = openStatStore({ path: dbPath, now })
    expect(createStatReport({ store, findSongs, now })(days).status).toBe(400)
  })
})
