import { describe, expect, test } from 'vitest'

import { histogram, niceMax, timeSeries } from './charts.ts'
import {
  type Report,
  formatPercent,
  histogramOf,
  parseReport,
  sortSongs,
  totalsOf,
} from './report.ts'

const none = { Visitor: 0, Autoplay: 0 }
const day = (date: string, plays: [number, number], clicks = 0) => ({
  day: date,
  clicks,
  plays: { Visitor: plays[0], Autoplay: plays[1] },
  finishes: { Visitor: 1, Autoplay: 1 },
  skips: { Visitor: 1, Autoplay: 0 },
})
const song = (songId: string, visitor: number, median: number | null) => ({
  songId,
  title: songId.toUpperCase(),
  artist: null,
  videoId: 'v',
  clicks: 1,
  plays: { Visitor: visitor, Autoplay: 0 },
  finishes: none,
  skips: none,
  medianSecondsIntoSkip: median,
})

const raw = {
  days: 2,
  since: '2026-11-13',
  songs: [song('a', 5, 20), song('b', 9, null), song('c', 1, 5)],
  videos: [],
  daily: [day('2026-11-13', [3, 1], 2), day('2026-11-14', [1, 3])],
  skipBuckets: [
    { songId: 'a', bucket: 1, count: 2 },
    { songId: 'b', bucket: 1, count: 1 },
    { songId: 'b', bucket: 30, count: 4 },
  ],
  skipBucketSeconds: 10,
  skipBucketCount: 31,
}
const report = parseReport(raw) as Report

describe('parseReport', () => {
  test('reads a report the server sends', () => {
    expect(report.songs).toHaveLength(3)
    expect(report.daily[0]?.day).toBe('2026-11-13')
  })

  test.each([
    ['not an object', 'x'],
    ['a missing daily series', { ...raw, daily: undefined }],
    ['a negative count', { ...raw, daily: [day('2026-11-13', [-1, 0])] }],
    ['a day that is not a date', { ...raw, daily: [day('today', [1, 0])] }],
    [
      'plays missing an origin',
      {
        ...raw,
        daily: [{ ...day('2026-11-13', [1, 0]), plays: { Visitor: 1 } }],
      },
    ],
    [
      'a median that is a string',
      { ...raw, songs: [{ ...song('a', 1, 1), medianSecondsIntoSkip: 'x' }] },
    ],
  ])('rejects %s', (_, body) => {
    expect(parseReport(body)).toBeUndefined()
  })
})

describe('totalsOf', () => {
  test('adds the days and works out the visitor share and finish rate', () => {
    const totals = totalsOf(report.daily)
    expect(totals.totalPlays).toBe(8)
    expect(totals.plays).toEqual({ Visitor: 4, Autoplay: 4 })
    expect(totals.visitorShare).toBe(0.5)
    expect(totals.finishes).toBe(4)
    expect(totals.finishRate).toBe(0.5)
    expect(totals.skips).toBe(2)
    expect(totals.clicks).toBe(2)
  })

  test('has no shares when nothing was played', () => {
    const totals = totalsOf([day('2026-11-14', [0, 0])])
    expect(totals.visitorShare).toBeNull()
    expect(formatPercent(totals.finishRate)).toBe('n/a')
  })
})

describe('sortSongs', () => {
  const ids = (rows: readonly { songId: string }[]) =>
    rows.map(row => row.songId)

  test('sorts by a number in both directions', () => {
    expect(ids(sortSongs(report.songs, 'visitorPlays', 'desc'))).toEqual([
      'b',
      'a',
      'c',
    ])
    expect(ids(sortSongs(report.songs, 'visitorPlays', 'asc'))).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  test('sorts by title', () => {
    expect(ids(sortSongs(report.songs, 'title', 'asc'))).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  test('a song with no skip median goes last either way', () => {
    expect(ids(sortSongs(report.songs, 'medianSkip', 'desc')).at(-1)).toBe('b')
    expect(ids(sortSongs(report.songs, 'medianSkip', 'asc')).at(-1)).toBe('b')
  })
})

describe('histogramOf', () => {
  test('adds every song, or picks one', () => {
    const all = histogramOf(report, null)
    expect(all).toHaveLength(31)
    expect(all[1]).toBe(3)
    expect(all[30]).toBe(4)
    expect(histogramOf(report, 'a')[1]).toBe(2)
    expect(histogramOf(report, 'a')[30]).toBe(0)
  })
})

describe('charts', () => {
  test('niceMax rounds up to a tick friendly number', () => {
    expect(niceMax(0)).toBe(4)
    expect(niceMax(7)).toBeGreaterThanOrEqual(7)
    expect(niceMax(130)).toBeGreaterThanOrEqual(130)
  })

  test('the daily chart has one bar group per day and a tooltip with the numbers', () => {
    const svg = timeSeries(report.daily)
    expect(svg.querySelectorAll('[data-day]')).toHaveLength(2)
    expect(
      svg.querySelector('[data-day="2026-11-13"] title')?.textContent,
    ).toContain('3 visitor plays, 1 autoplay plays, 2 clicks')
  })

  test('the histogram has one bar per bucket and an open ended last label', () => {
    const svg = histogram(histogramOf(report, null), 10)
    expect(svg.querySelectorAll('[data-bucket]')).toHaveLength(31)
    expect(svg.querySelector('[data-bucket="30"] title')?.textContent).toBe(
      '300s and later: 4 skips',
    )
  })
})
