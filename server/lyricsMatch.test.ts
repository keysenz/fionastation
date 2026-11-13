import { Schema } from 'effect'
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

import { Lyrics } from '../src/lyrics.ts'
import {
  type LrclibTrack,
  type SearchPlan,
  type SongForLyrics,
  artistHintOf,
  judgeCandidates,
  noOverrides,
  normalizeTitle,
  parseAlignments,
  parseLrc,
  parseOverrides,
  planKey,
  planLookup,
  toLyrics,
  verdictForChosenTrack,
  withAlignment,
} from './lyricsMatch.ts'

const fixture = (name: string): LrclibTrack[] =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/lrclib/${name}.json`, import.meta.url),
      'utf8',
    ),
  )

const search = (
  title: string,
  artist?: string,
  trusted = false,
): SearchPlan => ({
  kind: 'Search',
  title,
  ...(artist === undefined ? {} : { artist }),
  isArtistTrusted: trusted,
})

const lrc = (count: number): string =>
  Array.from({ length: count }, (_, i) => {
    const seconds = i * 10
    return `[${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.00] line ${i}`
  }).join('\n')

const track = (
  id: number,
  trackName: string,
  artistName: string,
  duration = 200,
  extra: Partial<LrclibTrack> = {},
): LrclibTrack => ({
  id,
  trackName,
  artistName,
  duration,
  instrumental: false,
  syncedLyrics: lrc(12),
  ...extra,
})

const song = (
  title: string,
  videoTitle = 'Stream',
  kind: SongForLyrics['kind'] = 'karaoke',
): SongForLyrics => ({ id: 's1', title, videoTitle, kind })

test('Pretender with Madonna and Hige Dandism entries is unsure', () => {
  expect(judgeCandidates(search('Pretender'), fixture('pretender'))).toEqual({
    kind: 'Missing',
    reason: 'Unsure',
  })
})

test('a lone wrong-artist LOSER entry is unsure, not picked', () => {
  const rotfront = fixture('loser').filter(t => t.id === 32588201)
  expect(judgeCandidates(search('LOSER'), rotfront)).toEqual({
    kind: 'Missing',
    reason: 'Unsure',
  })
})

test('a trusted artist with no matching track is not found', () => {
  expect(
    judgeCandidates(search('LOSER', 'Kenshi Yonezu', true), fixture('loser')),
  ).toEqual({ kind: 'Missing', reason: 'NotFound' })
})

test('an artist hint that matches picks that artist', () => {
  const verdict = judgeCandidates(search('Idol', 'Yoasobi'), fixture('idol'))
  expect(verdict.kind).toBe('Picked')
  if (verdict.kind === 'Picked') {
    expect(verdict.track.artistName.toLowerCase()).toContain('yoasobi')
  }
})

test('an artist hint that matches nothing falls back to the two-witness rule', () => {
  const tracks = [track(1, 'Song', 'A'), track(2, 'Song', 'A')]
  expect(judgeCandidates(search('Song', 'Someone Else'), tracks).kind).toBe(
    'Picked',
  )
  expect(judgeCandidates(search('Song', 'Someone Else', true), tracks)).toEqual(
    { kind: 'Missing', reason: 'NotFound' },
  )
})

test('one stray second artist keeps Bukti unsure until the artist is known', () => {
  expect(judgeCandidates(search('Bukti'), fixture('bukti'))).toEqual({
    kind: 'Missing',
    reason: 'Unsure',
  })
  const verdict = judgeCandidates(search('Bukti', 'Virgoun'), fixture('bukti'))
  expect(verdict.kind === 'Picked' && verdict.track.artistName).toContain(
    'Virgoun',
  )
})

test('the first search is not enough for Betelgeuse by title alone', () => {
  const verdict = judgeCandidates(search('Betelgeuse'), fixture('betelgeuse-q'))
  expect(verdict).toEqual({ kind: 'Missing', reason: 'Unsure' })
})

test('instrumental and plain-only tracks are excluded', () => {
  const tracks = [
    track(1, 'Song', 'A', 200, { instrumental: true }),
    track(2, 'Song', 'A', 200, { syncedLyrics: null }),
    track(3, 'Song', 'A'),
  ]
  expect(judgeCandidates(search('Song'), tracks)).toEqual({
    kind: 'Missing',
    reason: 'Unsure',
  })
  const withPair = [...tracks, track(4, 'Song', 'A')]
  const verdict = judgeCandidates(search('Song'), withPair)
  expect(verdict.kind === 'Picked' && verdict.track.id).toBe(3)
})

test('the pick is the median duration and does not depend on input order', () => {
  const tracks = [
    track(5, 'Song', 'A', 240),
    track(3, 'Song', 'A', 200),
    track(4, 'Song', 'A', 220),
  ]
  const forward = judgeCandidates(search('Song'), tracks)
  const backward = judgeCandidates(search('Song'), tracks.toReversed())
  expect(forward).toEqual(backward)
  expect(forward.kind === 'Picked' && forward.track.id).toBe(4)
})

test('junk entries with a tiny duration are rejected by the last-line check', () => {
  const tracks = [track(1, 'Song', 'A', 4), track(2, 'Song', 'A', 5)]
  expect(judgeCandidates(search('Song'), tracks)).toEqual({
    kind: 'Missing',
    reason: 'NotFound',
  })
})

test('a track with fewer than 8 lines is rejected', () => {
  const tracks = [
    track(1, 'Song', 'A', 200, { syncedLyrics: lrc(7) }),
    track(2, 'Song', 'A', 200, { syncedLyrics: lrc(7) }),
  ]
  expect(judgeCandidates(search('Song'), tracks).kind).toBe('Missing')
})

test('the duration veto rejects tracks longer than the song slot plus 15 s', () => {
  const tracks = [track(1, 'Song', 'A', 300), track(2, 'Song', 'A', 310)]
  expect(judgeCandidates(search('Song'), tracks).kind).toBe('Picked')
  expect(judgeCandidates(search('Song'), tracks, 120)).toEqual({
    kind: 'Missing',
    reason: 'NotFound',
  })
  expect(judgeCandidates(search('Song'), tracks, 300).kind).toBe('Picked')
})

test('artists that contain each other count as one group', () => {
  const tracks = [
    track(1, 'Song', 'Virgoun'),
    track(2, 'Song', 'Song, Virgoun'),
    track(3, 'Song', 'VIRGOUN - Topic'),
  ]
  expect(judgeCandidates(search('Song'), tracks).kind).toBe('Picked')
})

test('toLyrics output decodes with the client schema', () => {
  const verdict = judgeCandidates(search('Bukti', 'Virgoun'), fixture('bukti'))
  for (const lyrics of [
    toLyrics(verdict, 800),
    toLyrics({ kind: 'Missing', reason: 'Unsure' }, 0),
  ]) {
    expect(
      Schema.decodeUnknownSync(Lyrics)(JSON.parse(JSON.stringify(lyrics))),
    ).toEqual(lyrics)
  }
})

test('artistHintOf reads the artist on either side of the dash', () => {
  expect(
    artistHintOf(
      song('Idol', 'Idol - Yoasobi (by fioyow) #vtuber  #cover', 'cover'),
    ),
  ).toBe('Yoasobi')
  expect(
    artistHintOf(
      song(
        'Only Love',
        'Trademark - Only Love short cover by Fio  #vtuber',
        'cover',
      ),
    ),
  ).toBe('Trademark')
  expect(
    artistHintOf(song('Idol', 'Idol - Yoasobi karaoke', 'karaoke')),
  ).toBeUndefined()
  expect(
    artistHintOf(
      song(
        'Untuk Dirimu',
        '【COVER】Untuk Dirimu - Fiona Clearesta ft. Pyoneers',
        'cover',
      ),
    ),
  ).toBeUndefined()
})

test('parseLrc handles multi-stamp lines, metadata, order and blanks', () => {
  const lines = parseLrc(
    [
      '[ar:Someone]',
      '[offset:+200]',
      '[01:40.50]late',
      '[00:12.00][01:40.00]chorus',
      '[00:05.5]',
      'not a lyric line',
      '[00:01.123] first',
    ].join('\n'),
  )
  expect(lines).toEqual([
    { atMs: 1123, text: 'first' },
    { atMs: 5500, text: '' },
    { atMs: 12000, text: 'chorus' },
    { atMs: 100000, text: 'chorus' },
    { atMs: 100500, text: 'late' },
  ])
})

test('normalizeTitle is idempotent and drops version suffixes only', () => {
  for (const title of [
    'Pretender',
    'Pretender (Remastered 2019)',
    'Idol - 2023 Remaster',
    'You (=I)',
    'ベテルギウス - BETELGEUSE',
    'LOSER',
    '  Hello,  World! ',
  ]) {
    const once = normalizeTitle(title)
    expect(normalizeTitle(once)).toBe(once)
  }
  expect(normalizeTitle('Pretender (Remastered 2019)')).toBe('pretender')
  expect(normalizeTitle('You (=I)')).toBe('you i')
  expect(normalizeTitle('Ｌｏｓｅｒ')).toBe('loser')
})

test('planLookup lets a song fix beat a title fix and adds offsets', () => {
  const overrides = parseOverrides({
    titles: {
      pretender: { lrclibId: 35912324, offsetSeconds: 0.5 },
    },
    songs: {
      s1: { songTitle: 'Pretender', artist: 'Madonna', offsetSeconds: -2 },
    },
  })
  const result = planLookup(song('Pretender'), overrides)
  expect(result.plan).toEqual({
    kind: 'Search',
    title: 'Pretender',
    artist: 'Madonna',
    isArtistTrusted: true,
  })
  expect(result.offsetMs).toBe(-1500)
  expect(
    planLookup({ ...song('Pretender'), id: 's2' }, overrides).plan,
  ).toEqual({ kind: 'ById', lrclibId: 35912324 })
})

test('planLookup hides, and ignores a song fix whose title guard no longer matches', () => {
  const overrides = parseOverrides({
    titles: { 'happy birthday': { hide: true } },
    songs: { s1: { songTitle: 'Other Song', lrclibId: 1 } },
  })
  expect(planLookup(song('Happy Birthday'), overrides).plan).toEqual({
    kind: 'Hide',
  })
  const stale = planLookup(song('Pretender'), overrides)
  expect(stale.ignoredSongFix).toBe(true)
  expect(stale.plan.kind).toBe('Search')
})

test('planKey is shared across occurrences of a title', () => {
  const a = planLookup(song('Satu Bulan'), noOverrides).plan
  const b = planLookup({ ...song('satu  bulan'), id: 's9' }, noOverrides).plan
  expect(planKey(a)).toBe(planKey(b))
})

test('parseOverrides rejects bad files with a path', () => {
  expect(() => parseOverrides({ titles: { 'Pretender ': {} } })).toThrow(
    /titles\["Pretender "\].*normalized/,
  )
  expect(() =>
    parseOverrides({ titles: { a: { hide: true, lrclibId: 1 } } }),
  ).toThrow(/only one of/)
  expect(() => parseOverrides({ songs: { s1: { hide: true } } })).toThrow(
    /songTitle/,
  )
  expect(() => parseOverrides({ titles: { a: { lrclibId: 1.5 } } })).toThrow(
    /integer/,
  )
  expect(() => parseOverrides({ nope: {} })).toThrow(/unknown section/)
})

test('the real overrides file parses', () => {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('./lyrics-overrides.json', import.meta.url), 'utf8'),
  )
  expect(() => parseOverrides(raw)).not.toThrow()
})

const pretenderLrclib = verdictForChosenTrack(
  track(3821917, 'Pretender', 'Official髭男dism', 326, {
    syncedLyrics: '[00:32.13]君とのラブストーリー\n[00:35.43]それは予想通り',
  }),
)

const pretenderAligned = {
  songTitle: 'Pretender',
  lrclibId: 3821917,
  lines: [
    { atMs: 4380, text: '君とのラブストーリー' },
    { atMs: 7160, text: 'それは予想通り' },
  ],
} as const

const lrclibTiming = [32130, 35430]

const servedTimes = (lyrics: ReturnType<typeof toLyrics>) =>
  lyrics._tag === 'Synced' ? lyrics.lines.map(line => line.atMs) : []

test('an alignment for the picked track and current title replaces the LRCLIB timing', () => {
  const lyrics = toLyrics(
    withAlignment(pretenderLrclib, song('Pretender'), pretenderAligned),
    -1500,
  )
  expect(servedTimes(lyrics)).toEqual([4380, 7160])
  expect(lyrics).toMatchObject({
    offsetMs: -1500,
    credit: { lrclibId: 3821917 },
  })
})

test('a title that normalizes the same still takes the alignment', () => {
  const lyrics = toLyrics(
    withAlignment(
      pretenderLrclib,
      song('PRETENDER (short ver.)'),
      pretenderAligned,
    ),
    0,
  )
  expect(servedTimes(lyrics)).toEqual([4380, 7160])
})

test('an alignment is ignored unless it was made for this track and this title', () => {
  for (const [current, aligned] of [
    [song('Pretender'), undefined],
    [song('Pretender'), { ...pretenderAligned, lrclibId: 999 }],
    [song('Betelgeuse'), pretenderAligned],
  ] as const) {
    expect(
      servedTimes(
        toLyrics(withAlignment(pretenderLrclib, current, aligned), 0),
      ),
    ).toEqual(lrclibTiming)
  }
})

test('an alignment never turns missing lyrics into lyrics', () => {
  expect(
    toLyrics(
      withAlignment(
        { kind: 'Missing', reason: 'Unsure' },
        song('Pretender'),
        pretenderAligned,
      ),
      0,
    ),
  ).toEqual({ _tag: 'Missing', reason: 'Unsure' })
})

test('parseAlignments keeps aligned songs and skips rejected ones', () => {
  const alignments = parseAlignments({
    a: { ...pretenderAligned, status: 'Aligned', aligner: 'x' },
    b: {
      songTitle: 'Blue Jeans',
      lrclibId: 1,
      status: 'Rejected',
      reason: 'weak',
      aligner: 'x',
    },
  })
  expect([...alignments.keys()]).toEqual(['a'])
  expect(alignments.get('a')?.lines).toEqual(pretenderAligned.lines)
})

test('the real alignments file parses', () => {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('./lyrics-aligned.json', import.meta.url), 'utf8'),
  )
  expect(parseAlignments(raw).size).toBeGreaterThan(0)
})

test('parseAlignments rejects bad files with a path', () => {
  const aligned = (lines: unknown) => ({
    a: { songTitle: 'S', lrclibId: 1, status: 'Aligned', lines },
  })
  expect(() => parseAlignments(aligned([]))).toThrow(
    /\$\["a"\]\.lines.*at least one/,
  )
  expect(() =>
    parseAlignments(
      aligned([
        { atMs: 5, text: 'b' },
        { atMs: 1, text: 'a' },
      ]),
    ),
  ).toThrow(/time order/)
  expect(() => parseAlignments(aligned([{ atMs: 1.5, text: 'a' }]))).toThrow(
    /atMs: expected an integer/,
  )
  expect(() =>
    parseAlignments({ a: { songTitle: 'S', lrclibId: 1, status: 'Maybe' } }),
  ).toThrow(/status/)
})
