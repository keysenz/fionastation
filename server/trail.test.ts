// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { SongForStats } from './db.ts'
import {
  type StatStore,
  createStatApi,
  createStatExport,
  createStatReport,
  openStatStore,
  parseStatEvent,
} from './stats.ts'
import { createGatedExport } from './statsAccess.ts'

let dir: string
let dbPath: string
let clock: Date
const now = () => clock

const S1 = '3f2b8c1e-5a4d-4e6f-9b7a-0c1d2e3f4a5b'
const S2 = '8a1c0d2e-7b6f-4a5b-8c9d-1e2f3a4b5c6d'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trail-test-'))
  dbPath = join(dir, 'stats.db')
  clock = new Date('2026-11-14T10:00:30Z')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const SONGS: readonly SongForStats[] = ['a1', 'a2', 'b1'].map((songId, i) => ({
  songId,
  title: `Song ${songId}`,
  artist: 'Artist',
  videoId: `v${i}`,
  videoTitle: `Stream ${i}`,
  videoUrl: `https://youtu.be/v${i}`,
}))
const findSongs = (ids: readonly string[]) =>
  SONGS.filter(song => ids.includes(song.songId))
const songExists = (id: string) => SONGS.some(song => song.songId === id)

const open = (options: { trailDays?: number } = {}) => {
  const store = openStatStore({ path: dbPath, now, ...options })
  return { store, api: createStatApi({ store, songExists, now }) }
}

const send = (api: ReturnType<typeof open>['api'], body: unknown) =>
  api({ ip: '1.1.1.1', body: JSON.stringify(body) })

const tagged = (
  songId: string,
  kind: string,
  seq: number,
  extra: Record<string, unknown> = {},
) => ({
  songId,
  kind,
  origin: 'Visitor',
  sessionId: S1,
  seq,
  ...extra,
})

const rows = (table: string) =>
  new DatabaseSync(dbPath, { readOnly: true })
    .prepare(`SELECT * FROM ${table} ORDER BY session_id, seq`)
    .all()

describe('write api with a trail', () => {
  test('an old client post without session fields still counts and leaves no trail row', () => {
    const { store, api } = open()
    expect(
      send(api, { songId: 'a1', kind: 'Play', origin: 'Visitor' }).status,
    ).toBe(204)
    expect(store.totalsSince('2026-11-14')).toHaveLength(1)
    expect(rows('listen_events')).toEqual([])
  })

  test('trail rows keep their order and carry the previous play, and counters still count', () => {
    const { store, api } = open()
    send(api, tagged('a1', 'Play', 1))
    send(api, tagged('a1', 'Skip', 2, { secondsIntoSong: 9 }))
    send(api, tagged('a2', 'Play', 3, { prevSongId: 'a1', origin: 'Autoplay' }))
    send(api, tagged('a2', 'Finish', 4, { prevSongId: 'a1', origin: 'Autoplay' }))
    expect(
      rows('listen_events').map(
        (row: any) =>
          `${row.seq} ${row.song_id} ${row.kind} ${row.origin} ${row.seconds_into_song} ${row.prev_song_id} ${row.minute}`,
      ),
    ).toEqual([
      '1 a1 Play Visitor null null 2026-11-14T10:00',
      '2 a1 Skip Visitor 9 null 2026-11-14T10:00',
      '3 a2 Play Autoplay null a1 2026-11-14T10:00',
      '4 a2 Finish Autoplay null a1 2026-11-14T10:00',
    ])
    const plays = store
      .totalsSince('2026-11-14')
      .filter(total => total.kind === 'Play')
      .reduce((sum, total) => sum + total.count, 0)
    expect(plays).toBe(2)
    expect(store.skipsSince('2026-11-14')).toHaveLength(1)
  })

  test('a retried post is stored once and counted once', () => {
    const { store, api } = open()
    send(api, tagged('a1', 'Play', 1))
    expect(send(api, tagged('a1', 'Play', 1)).status).toBe(204)
    expect(rows('listen_events')).toHaveLength(1)
    expect(store.totalsSince('2026-11-14')[0]?.count).toBe(1)
  })

  test.each([
    ['a session id that is not a UUID', tagged('a1', 'Play', 1, { sessionId: 'abc' })],
    ['a UUID that is not version 4', tagged('a1', 'Play', 1, { sessionId: '3f2b8c1e-5a4d-1e6f-9b7a-0c1d2e3f4a5b' })],
    ['a session id without a seq', { songId: 'a1', kind: 'Play', origin: 'Visitor', sessionId: S1 }],
    ['a seq without a session id', { songId: 'a1', kind: 'Play', origin: 'Visitor', seq: 1 }],
    ['a previous song without a session', { songId: 'a1', kind: 'Play', origin: 'Visitor', prevSongId: 'a2' }],
    ['a negative seq', tagged('a1', 'Play', -1)],
    ['a fractional seq', tagged('a1', 'Play', 1.5)],
    ['a huge seq', tagged('a1', 'Play', 1e9)],
  ])('answers 400 for %s and records nothing', (_label, body) => {
    const { store, api } = open()
    expect(send(api, body).status).toBe(400)
    expect(store.totalsSince('2026-11-14')).toEqual([])
    expect(rows('listen_events')).toEqual([])
  })

  test('a post for an unknown song is refused whole, trail row and counter', () => {
    const { store, api } = open()
    expect(send(api, tagged('ghost', 'Play', 1)).status).toBe(404)
    expect(rows('listen_events')).toEqual([])
    expect(store.totalsSince('2026-11-14')).toEqual([])
  })

  test('a counter failure rolls the trail row back', () => {
    const { store } = open()
    new DatabaseSync(dbPath).exec('DROP TABLE song_stats')
    expect(() =>
      store.record({
        kind: 'Play',
        songId: 'a1',
        origin: 'Visitor',
        trail: { sessionId: S1, seq: 1, prevSongId: null },
      }),
    ).toThrow()
    expect(rows('listen_events')).toEqual([])
  })

  test('the trail tables hold no address, user agent or device value', () => {
    open()
    const db = new DatabaseSync(dbPath, { readOnly: true })
    const columns = (table: string) =>
      db
        .prepare('SELECT name FROM pragma_table_info(?)')
        .all(table)
        .map(({ name }) => name)
    expect(columns('listen_events')).toEqual([
      'session_id',
      'seq',
      'minute',
      'song_id',
      'kind',
      'origin',
      'seconds_into_song',
      'prev_song_id',
    ])
    expect(columns('autoplay_decisions')).toEqual([
      'session_id',
      'seq',
      'minute',
      'policy',
      'pool_size',
      'propensity',
      'picked_song_id',
      'prev_song_id',
    ])
  })
})

describe('autoplay decisions', () => {
  const decision = (seq: number, extra: Record<string, unknown> = {}) => ({
    kind: 'Decision',
    songId: 'a2',
    sessionId: S1,
    seq,
    policy: 'uniform-v1',
    poolSize: 8,
    ...extra,
  })

  test('stores the pick with propensity 1 over the pool size, in the session seq space', () => {
    const { api } = open()
    send(api, tagged('a1', 'Play', 1))
    expect(send(api, decision(2, { prevSongId: 'a1' })).status).toBe(204)
    send(api, tagged('a2', 'Play', 3, { prevSongId: 'a1', origin: 'Autoplay' }))
    expect(rows('autoplay_decisions')).toEqual([
      {
        session_id: S1,
        seq: 2,
        minute: '2026-11-14T10:00',
        policy: 'uniform-v1',
        pool_size: 8,
        propensity: 0.125,
        picked_song_id: 'a2',
        prev_song_id: 'a1',
      },
    ])
    expect(rows('listen_events').map((row: any) => row.seq)).toEqual([1, 3])
  })

  test('a decision never touches the counters', () => {
    const { store, api } = open()
    send(api, decision(1))
    expect(store.totalsSince('2026-11-14')).toEqual([])
    expect(store.dailySince('2026-11-14')).toEqual([])
  })

  test.each([
    ['an unknown policy', { policy: 'greedy' }],
    ['a zero pool', { poolSize: 0 }],
    ['a fractional pool', { poolSize: 2.5 }],
    ['an unknown song', { songId: 'ghost' }, 404],
    ['a bad session id', { sessionId: 'x' }],
    ['an extra field', { propensity: 0.5 }],
  ])('refuses %s', (_label, extra, status = 400) => {
    const { api } = open()
    expect(send(api, decision(1, extra)).status).toBe(status)
    expect(rows('autoplay_decisions')).toEqual([])
  })

  test('the parser requires both session fields', () => {
    expect(
      parseStatEvent(
        JSON.stringify({ kind: 'Decision', songId: 'a1', policy: 'uniform-v1', poolSize: 2 }),
      ),
    ).toBeUndefined()
  })
})

describe('retention', () => {
  test('deletes trail and decision rows older than the window and keeps the rest and the totals', () => {
    const { store, api } = open({ trailDays: 180 })
    clock = new Date('2026-05-01T10:00:00Z')
    send(api, tagged('a1', 'Play', 1))
    send(api, {
      kind: 'Decision',
      songId: 'a1',
      sessionId: S1,
      seq: 2,
      policy: 'uniform-v1',
      poolSize: 3,
    })
    clock = new Date('2026-11-12T10:00:00Z')
    send(api, tagged('a2', 'Play', 3))
    send(api, { ...tagged('a2', 'Play', 1), sessionId: S2 })
    clock = new Date('2026-11-14T10:00:00Z')
    expect(store.prune()).toBe(2)
    expect(rows('listen_events').map((row: any) => row.seq)).toEqual([3, 1])
    expect(rows('autoplay_decisions')).toEqual([])
    expect(
      store.totalsSince('2026-01-01').reduce((sum, { count }) => sum + count, 0),
    ).toBe(3)
  })

  test('the window follows trailDays', () => {
    const { store, api } = open({ trailDays: 7 })
    clock = new Date('2026-11-01T10:00:00Z')
    send(api, tagged('a1', 'Play', 1))
    clock = new Date('2026-11-14T10:00:00Z')
    expect(store.prune()).toBe(1)
  })
})

describe('reads', () => {
  const seed = (api: ReturnType<typeof open>['api']) => {
    const visit = (sessionId: string, steps: Array<[string, string, string?]>) =>
      steps.forEach(([kind, songId, prevSongId], i) =>
        send(api, {
          songId,
          kind,
          origin: prevSongId ? 'Autoplay' : 'Visitor',
          sessionId,
          seq: i + 1,
          ...(kind === 'Skip' ? { secondsIntoSong: 10 * (i + 1) } : {}),
          ...(prevSongId ? { prevSongId } : {}),
        }),
      )
    visit(S1, [
      ['Play', 'a1'],
      ['Finish', 'a1'],
      ['Play', 'a2', 'a1'],
      ['Skip', 'a2', 'a1'],
    ])
    visit(S2, [
      ['Play', 'a1'],
      ['Finish', 'a1'],
      ['Play', 'a2', 'a1'],
      ['Finish', 'a2', 'a1'],
      ['Play', 'b1', 'a2'],
    ])
  }

  test('transitions group prev to song with plays, finishes and skips, and drop single events', () => {
    const { store, api } = open()
    seed(api)
    expect(store.transitionsSince('2026-11-14')).toEqual([
      { prevSongId: 'a1', songId: 'a2', plays: 2, finishes: 1, skips: 1 },
    ])
  })

  test('the report carries origin outcomes with the median skip and titled transitions', () => {
    const { store, api } = open()
    seed(api)
    const answer = createStatReport({ store, findSongs, now })('7')
    const body = answer.body as any
    expect(body.outcomes).toEqual([
      { origin: 'Visitor', plays: 2, finishes: 2, skips: 0, medianSecondsIntoSkip: null },
      { origin: 'Autoplay', plays: 3, finishes: 1, skips: 1, medianSecondsIntoSkip: 40 },
    ])
    expect(body.transitions[0]).toMatchObject({
      prevTitle: 'Song a1',
      title: 'Song a2',
      plays: 2,
    })
  })

  test('the existing totals are the same with or without a trail', () => {
    const traced = open().store
    seed(open().api)
    const plain = openStatStore({ path: join(dir, 'plain.db'), now })
    for (const row of rows('listen_events') as any[]) {
      if (row.kind === 'Skip') {
        plain.record({ kind: 'Skip', songId: row.song_id, origin: row.origin, secondsIntoSong: row.seconds_into_song })
      } else {
        plain.record({ kind: row.kind, songId: row.song_id, origin: row.origin })
      }
    }
    expect(traced.totalsSince('2026-11-14').toSorted(byKey)).toEqual(
      plain.totalsSince('2026-11-14').toSorted(byKey),
    )
  })
})

const byKey = (
  left: { songId: string; kind: string; origin: string },
  right: { songId: string; kind: string; origin: string },
) =>
  `${left.songId}${left.kind}${left.origin}`.localeCompare(
    `${right.songId}${right.kind}${right.origin}`,
  )

describe('export', () => {
  const MOD = '244661517356761089'
  const lines = (answer: ReturnType<ReturnType<typeof createStatExport>>) => {
    expect(answer.status).toBe(200)
    return [...('lines' in answer ? answer.lines : [])]
  }

  test('streams events as NDJSON in session order with titles joined at read time', () => {
    const { store, api } = open()
    send(api, tagged('a1', 'Play', 1))
    send(api, tagged('a2', 'Play', 2, { prevSongId: 'a1' }))
    send(api, { ...tagged('b1', 'Play', 1), sessionId: S2 })
    const out = lines(createStatExport({ store, findSongs, now })('7', 'events'))
    expect(out.every(line => line.endsWith('\n'))).toBe(true)
    const parsed = out.map(line => JSON.parse(line))
    expect(parsed.map(row => `${row.sessionId.slice(0, 4)}/${row.seq}`)).toEqual([
      '3f2b/1',
      '3f2b/2',
      '8a1c/1',
    ])
    expect(parsed[1]).toMatchObject({
      songId: 'a2',
      title: 'Song a2',
      videoId: 'v1',
      prevSongId: 'a1',
      prevTitle: 'Song a1',
      kind: 'Play',
      minute: '2026-11-14T10:00',
    })
  })

  test('pages through more rows than one page holds without dropping or repeating', () => {
    const { store } = open()
    for (let seq = 0; seq < 2500; seq++) {
      store.record({
        kind: 'Play',
        songId: 'a1',
        origin: 'Visitor',
        trail: { sessionId: S1, seq, prevSongId: null },
      })
    }
    const out = lines(createStatExport({ store, findSongs, now })('7', 'events'))
    expect(out.map(line => JSON.parse(line).seq)).toEqual(
      Array.from({ length: 2500 }, (_, i) => i),
    )
  })

  test('exports decisions with the propensity', () => {
    const { store, api } = open()
    send(api, { kind: 'Decision', songId: 'a2', sessionId: S1, seq: 1, policy: 'uniform-v1', poolSize: 4 })
    const [line] = lines(createStatExport({ store, findSongs, now })('7', 'decisions'))
    expect(JSON.parse(line as string)).toMatchObject({
      policy: 'uniform-v1',
      poolSize: 4,
      propensity: 0.25,
      pickedSongId: 'a2',
      pickedTitle: 'Song a2',
    })
  })

  test('respects the day range', () => {
    const { store, api } = open()
    clock = new Date('2026-11-10T10:00:00Z')
    send(api, tagged('a1', 'Play', 1))
    clock = new Date('2026-11-14T10:00:00Z')
    send(api, tagged('a1', 'Play', 2))
    const exporter = createStatExport({ store, findSongs, now })
    expect(lines(exporter('1', 'events'))).toHaveLength(1)
    expect(lines(exporter('7', 'events'))).toHaveLength(2)
  })

  test.each([
    ['an unknown table', '7', 'sessions'],
    ['no table', '7', null],
    ['bad days', '0', 'events'],
  ])('answers 400 for %s', (_label, days, table) => {
    const { store } = open()
    expect(createStatExport({ store, findSongs, now })(days, table).status).toBe(400)
  })

  describe('gate', () => {
    const gate = (exportRows: Parameters<typeof createGatedExport>[0]['exportRows']) =>
      createGatedExport({
        allowedIds: new Set([MOD]),
        signedInId: cookie => cookie?.replace('as=', ''),
        exportRows,
      })
    const rowsOf = (store: StatStore) => createStatExport({ store, findSongs, now })

    test('401 when signed out, 403 when not listed, 200 when listed, and rows are read only then', () => {
      const { store } = open()
      let reads = 0
      const exporter = rowsOf(store)
      const gated = gate((days, table) => (reads++, exporter(days, table)))
      expect(gated(undefined, '7', 'events').status).toBe(401)
      expect(gated('as=111111111111111111', '7', 'events').status).toBe(403)
      expect(reads).toBe(0)
      expect(gated(`as=${MOD}`, '7', 'events').status).toBe(200)
      expect(reads).toBe(1)
    })

    test('503 without the export or the list', () => {
      expect(gate(undefined)(`as=${MOD}`, '7', 'events').status).toBe(503)
    })
  })
})
