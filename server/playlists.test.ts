// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { PlaylistEntry } from '../src/playlist.ts'
import {
  MAX_BODY_BYTES,
  type PlaylistReply,
  type PlaylistStore,
  createPlaylistApi,
  openPlaylistStore,
} from './playlists.ts'

const entry = (songId: string): PlaylistEntry => ({
  songId,
  videoUrl: `https://youtu.be/${songId}`,
  timestamp: '0:30',
  title: `Title of ${songId}`,
})

let dir: string
let dbPath: string
let clock: Date
const now = () => clock

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'playlists-test-'))
  dbPath = join(dir, 'playlists.db')
  clock = new Date('2026-11-14T10:00:00Z')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const created = (store: PlaylistStore, name = 'Rainy day Fio', ids = ['a']) => {
  const result = store.create({ name, entries: ids.map(entry) })
  if (result.kind !== 'Created') throw new Error(`create gave ${result.kind}`)
  return result
}

describe('store', () => {
  test('create then read round-trips the name and entries in order', () => {
    const store = openPlaylistStore({ path: dbPath, now })
    const { id, version } = created(store, 'Rainy day Fio', ['b', 'a', 'c'])
    expect(version).toBe(1)
    const read = store.read(id)
    if (read.kind !== 'Found') throw new Error(read.kind)
    expect(read.playlist).toEqual({
      id,
      name: 'Rainy day Fio',
      entries: ['b', 'a', 'c'].map(entry),
      version: 1,
      createdAt: '2026-11-14T10:00:00.000Z',
      updatedAt: '2026-11-14T10:00:00.000Z',
    })
  })

  test('only a hash of the edit token is stored', () => {
    const store = openPlaylistStore({ path: dbPath, now })
    const { id, editToken } = created(store)
    const raw = new DatabaseSync(dbPath, { readOnly: true })
    const row = raw
      .prepare('SELECT edit_token_hash FROM playlists WHERE id = ?')
      .get(id) as { edit_token_hash: string }
    expect(row.edit_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row.edit_token_hash).not.toContain(editToken)
    expect(editToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  test('ids are 8 base62 characters and a clash retries with a fresh id', () => {
    const ids = ['AAAAAAAA', 'AAAAAAAA', 'BBBBBBBB']
    const store = openPlaylistStore({
      path: dbPath,
      now,
      newId: () => ids.shift() ?? 'ZZZZZZZZ',
    })
    expect(created(store).id).toBe('AAAAAAAA')
    expect(created(store).id).toBe('BBBBBBBB')
    const random = openPlaylistStore({ path: join(dir, 'other.db'), now })
    expect(created(random).id).toMatch(/^[0-9A-Za-z]{8}$/)
  })

  test('a stale version is refused and the playlist is unchanged', () => {
    const store = openPlaylistStore({ path: dbPath, now })
    const { id } = created(store)
    expect(
      store.replace(id, { name: 'Second', entries: [entry('b')] }, 1),
    ).toEqual({
      kind: 'Updated',
      version: 2,
    })
    expect(
      store.replace(id, { name: 'Third', entries: [entry('c')] }, 1),
    ).toEqual({
      kind: 'Stale',
    })
    const read = store.read(id)
    if (read.kind !== 'Found') throw new Error(read.kind)
    expect(read.playlist.name).toBe('Second')
    expect(read.playlist.version).toBe(2)
  })

  test('only the creator token authorizes', () => {
    const store = openPlaylistStore({ path: dbPath, now })
    const { id, editToken } = created(store)
    expect(store.authorize(id, editToken)).toBe('Allowed')
    expect(store.authorize(id, `${editToken}x`)).toBe('Forbidden')
    expect(store.authorize(id, undefined)).toBe('Forbidden')
    expect(store.authorize('nope1234', editToken)).toBe('Unknown')
  })

  test('a delete then a read reports deleted, and the entries are gone', () => {
    const store = openPlaylistStore({ path: dbPath, now })
    const { id, editToken } = created(store)
    expect(store.remove(id)).toBe('Removed')
    expect(store.remove(id)).toBe('Removed')
    expect(store.read(id)).toEqual({ kind: 'Deleted' })
    expect(store.authorize(id, editToken)).toBe('Deleted')
    expect(store.replace(id, { name: 'x', entries: [entry('a')] }, 1)).toEqual({
      kind: 'Deleted',
    })
    const raw = new DatabaseSync(dbPath, { readOnly: true })
    const row = raw
      .prepare('SELECT entries FROM playlists WHERE id = ?')
      .get(id) as {
      entries: string
    }
    expect(JSON.parse(row.entries)).toEqual([])
    expect(store.read('nope1234')).toEqual({ kind: 'Unknown' })
  })

  test('the daily cap refuses the 1001st create of a UTC day and accepts one the next day', () => {
    const store = openPlaylistStore({ path: dbPath, now })
    for (let i = 0; i < 1000; i++) created(store, `p${i}`)
    expect(
      store.create({ name: 'one too many', entries: [entry('a')] }),
    ).toEqual({
      kind: 'DailyCapReached',
    })
    clock = new Date('2026-11-14T23:59:59Z')
    expect(
      store.create({ name: 'still today', entries: [entry('a')] }).kind,
    ).toBe('DailyCapReached')
    clock = new Date('2026-11-15T00:00:00Z')
    expect(store.create({ name: 'tomorrow', entries: [entry('a')] }).kind).toBe(
      'Created',
    )
  })

  test('deleted playlists still count against the daily cap', () => {
    const store = openPlaylistStore({ path: dbPath, now, dailyCap: 2 })
    store.remove(created(store).id)
    created(store)
    expect(store.create({ name: 'c', entries: [entry('a')] }).kind).toBe(
      'DailyCapReached',
    )
  })

  test('reopening the same file keeps the data and converges on the schema', () => {
    const first = openPlaylistStore({ path: dbPath, now })
    const { id } = created(first)
    const second = openPlaylistStore({ path: dbPath, now })
    const third = openPlaylistStore({ path: dbPath, now })
    expect(second.read(id).kind).toBe('Found')
    expect(third.read(id).kind).toBe('Found')
    const raw = new DatabaseSync(dbPath, { readOnly: true })
    expect(raw.prepare('PRAGMA journal_mode').get()).toEqual({
      journal_mode: 'wal',
    })
  })
})

type Body = {
  id: string
  editToken: string
  version: number
  name: string
  entries: PlaylistEntry[]
}
const bodyOf = (reply: PlaylistReply) => reply.body as Body

const harness = (
  overrides: { createsPerIpPerHour?: number; editsPerHour?: number } = {},
) => {
  const store = openPlaylistStore({ path: dbPath, now })
  const known = new Set(['s1', 's2', 's3', 's4'])
  const api = createPlaylistApi({
    store,
    now,
    findSongs: ids =>
      ids
        .filter(id => known.has(id))
        .map(entry)
        .reverse(),
    ...overrides,
  })
  const post = (body: unknown, ip = '1.1.1.1') =>
    api({
      method: 'POST',
      id: undefined,
      ip,
      authorization: undefined,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  const send = (
    method: string,
    id: string,
    token: string | undefined,
    body?: unknown,
    ip = '1.1.1.1',
  ) =>
    api({
      method,
      id,
      ip,
      authorization: token === undefined ? undefined : `Bearer ${token}`,
      body: body === undefined ? '' : JSON.stringify(body),
    })
  const rows = () =>
    (
      new DatabaseSync(dbPath, { readOnly: true })
        .prepare('SELECT COUNT(*) AS n FROM playlists')
        .get() as { n: number }
    ).n
  return { api, post, send, rows, store }
}

describe('api', () => {
  test('POST creates and GET reads the same name and entries in the requested order', () => {
    const { post, send } = harness()
    const reply = post({ name: 'Rainy day Fio', songIds: ['s3', 's1', 's2'] })
    expect(reply.status).toBe(201)
    const { id, editToken, version } = bodyOf(reply)
    expect(id).toMatch(/^[0-9A-Za-z]{8}$/)
    expect(editToken).toBeTypeOf('string')
    expect(version).toBe(1)
    const read = send('GET', id, undefined)
    expect(read.status).toBe(200)
    expect(bodyOf(read).name).toBe('Rainy day Fio')
    expect(bodyOf(read).entries.map((e: PlaylistEntry) => e.songId)).toEqual([
      's3',
      's1',
      's2',
    ])
    expect(bodyOf(read).version).toBe(1)
    expect(bodyOf(read).editToken).toBeUndefined()
  })

  test('the same song id twice is a 400 and writes nothing', () => {
    const { post, rows } = harness()
    expect(post({ name: 'x', songIds: ['s1', 's1'] }).status).toBe(400)
    expect(rows()).toBe(0)
  })

  test('an unknown song id mixed in is a 400 and writes nothing', () => {
    const { post, rows } = harness()
    expect(post({ name: 'x', songIds: ['s1', 'ghost', 's2'] }).status).toBe(400)
    expect(rows()).toBe(0)
  })

  test.each([
    ['not json', 'nope'],
    ['an array', '[]'],
    ['no name', { songIds: ['s1'] }],
    ['a non-string name', { name: 5, songIds: ['s1'] }],
    ['no song ids', { name: 'x' }],
    ['an empty list', { name: 'x', songIds: [] }],
    ['a non-string id', { name: 'x', songIds: [1] }],
    [
      '101 ids',
      { name: 'x', songIds: Array.from({ length: 101 }, (_, i) => `i${i}`) },
    ],
    ['a 61 grapheme name', { name: 'a'.repeat(61), songIds: ['s1'] }],
  ])('%s is a 400 and writes nothing', (_label, body) => {
    const { post, rows } = harness()
    expect(post(body).status).toBe(400)
    expect(rows()).toBe(0)
  })

  test('the name is cleaned and entries come from the song lookup, not the request', () => {
    const { post, send } = harness()
    const reply = post({
      name: '  ‮𝓕𝓲𝓸𝓷𝓪​  ',
      songIds: ['s1'],
      entries: [
        { songId: 's1', title: 'FAKE', videoUrl: 'javascript:alert(1)' },
      ],
    })
    expect(reply.status).toBe(201)
    const read = bodyOf(send('GET', bodyOf(reply).id, undefined))
    expect(read.name).toBe('Fiona')
    expect(read.entries).toEqual([entry('s1')])
  })

  test('a blank name becomes the default name', () => {
    const { post, send } = harness()
    const reply = post({ name: '   ', songIds: ['s1'] })
    expect(bodyOf(send('GET', bodyOf(reply).id, undefined)).name).toBe(
      'Untitled playlist',
    )
  })

  test('a body over 8 KB is a 413 and writes nothing', () => {
    const { post, rows } = harness()
    const reply = post({
      name: 'x',
      songIds: ['s1'],
      pad: 'a'.repeat(MAX_BODY_BYTES),
    })
    expect(reply.status).toBe(413)
    expect(rows()).toBe(0)
  })

  test('the oversize check runs before the per-IP limit counts it', () => {
    const { post } = harness({ createsPerIpPerHour: 1 })
    expect(post('x'.repeat(MAX_BODY_BYTES + 1)).status).toBe(413)
    expect(post({ name: 'x', songIds: ['s1'] }).status).toBe(201)
  })

  test('the 11th create from one IP in an hour is a 429 and another IP is fine', () => {
    const { post } = harness()
    for (let i = 0; i < 10; i++) {
      expect(post({ name: `p${i}`, songIds: ['s1'] }).status).toBe(201)
    }
    expect(post({ name: 'p10', songIds: ['s1'] }).status).toBe(429)
    expect(post({ name: 'p10', songIds: ['s1'] }, '2.2.2.2').status).toBe(201)
    clock = new Date(clock.getTime() + 61 * 60 * 1000)
    expect(post({ name: 'later', songIds: ['s1'] }).status).toBe(201)
  })

  test('the per-IP limit runs before body validation, so bad bodies spend it too', () => {
    const { post } = harness({ createsPerIpPerHour: 2 })
    expect(post('nope').status).toBe(400)
    expect(post('nope').status).toBe(400)
    expect(post('nope').status).toBe(429)
  })

  test('the per-IP limit runs before the daily cap', () => {
    const store = openPlaylistStore({ path: dbPath, now, dailyCap: 0 })
    const api = createPlaylistApi({
      store,
      now,
      findSongs: ids => ids.map(entry),
      createsPerIpPerHour: 1,
    })
    const request = {
      method: 'POST',
      id: undefined,
      ip: '1.1.1.1',
      authorization: undefined,
      body: JSON.stringify({ name: 'x', songIds: ['s1'] }),
    }
    expect(api(request).status).toBe(503)
    expect(api(request).status).toBe(429)
  })

  test('an edit with the right token and current version bumps the version, a stale one is a 409', () => {
    const { post, send } = harness()
    const { id, editToken } = bodyOf(post({ name: 'one', songIds: ['s1'] }))
    const first = send('PUT', id, editToken, {
      name: 'two',
      songIds: ['s2', 's1'],
      version: 1,
    })
    expect(first.status).toBe(200)
    expect(bodyOf(first).version).toBe(2)
    const stale = send('PUT', id, editToken, {
      name: 'three',
      songIds: ['s1'],
      version: 1,
    })
    expect(stale.status).toBe(409)
    const read = bodyOf(send('GET', id, undefined))
    expect(read.name).toBe('two')
    expect(read.entries.map((e: PlaylistEntry) => e.songId)).toEqual([
      's2',
      's1',
    ])
  })

  test('a PUT body is checked like a POST body', () => {
    const { post, send } = harness()
    const { id, editToken } = bodyOf(post({ name: 'one', songIds: ['s1'] }))
    expect(
      send('PUT', id, editToken, {
        name: 'x',
        songIds: ['s1', 's1'],
        version: 1,
      }).status,
    ).toBe(400)
    expect(
      send('PUT', id, editToken, { name: 'x', songIds: ['ghost'], version: 1 })
        .status,
    ).toBe(400)
    expect(
      send('PUT', id, editToken, { name: 'x', songIds: ['s1'] }).status,
    ).toBe(400)
    expect(
      send('PUT', id, editToken, { name: 'x', songIds: ['s1'], version: 1.5 })
        .status,
    ).toBe(400)
  })

  test('a wrong or missing token is a 403 for edit and delete and changes nothing', () => {
    const { post, send } = harness()
    const { id } = bodyOf(post({ name: 'one', songIds: ['s1'] }))
    const edit = { name: 'hacked', songIds: ['s2'], version: 1 }
    expect(send('PUT', id, 'wrong', edit).status).toBe(403)
    expect(send('PUT', id, undefined, edit).status).toBe(403)
    expect(send('DELETE', id, 'wrong').status).toBe(403)
    const read = bodyOf(send('GET', id, undefined))
    expect(read.name).toBe('one')
    expect(read.version).toBe(1)
  })

  test('edits are limited to 30 an hour per playlist', () => {
    const { post, send } = harness()
    const { id, editToken } = bodyOf(post({ name: 'one', songIds: ['s1'] }))
    for (let version = 1; version <= 30; version++) {
      expect(
        send('PUT', id, editToken, { name: 'n', songIds: ['s1'], version })
          .status,
      ).toBe(200)
    }
    expect(
      send('PUT', id, editToken, { name: 'n', songIds: ['s1'], version: 31 })
        .status,
    ).toBe(429)
    expect(
      send('PUT', id, 'wrong', { name: 'n', songIds: ['s1'], version: 31 })
        .status,
    ).toBe(403)
    clock = new Date(clock.getTime() + 61 * 60 * 1000)
    expect(
      send('PUT', id, editToken, { name: 'n', songIds: ['s1'], version: 31 })
        .status,
    ).toBe(200)
  })

  test('delete with the token makes the playlist read 410, unknown ids read 404', () => {
    const { post, send } = harness()
    const { id, editToken } = bodyOf(post({ name: 'one', songIds: ['s1'] }))
    expect(send('DELETE', id, editToken).status).toBe(200)
    expect(send('GET', id, undefined).status).toBe(410)
    expect(
      send('PUT', id, editToken, { name: 'n', songIds: ['s1'], version: 1 })
        .status,
    ).toBe(410)
    expect(send('GET', 'zzzzzzzz', undefined).status).toBe(404)
    expect(send('GET', 'short', undefined).status).toBe(404)
    expect(
      send('PUT', 'zzzzzzzz', 'x', { name: 'n', songIds: ['s1'], version: 1 })
        .status,
    ).toBe(404)
    expect(send('DELETE', 'zzzzzzzz', 'x').status).toBe(404)
  })

  test('methods outside the route table are 405', () => {
    const { api, post } = harness()
    const { id } = bodyOf(post({ name: 'one', songIds: ['s1'] }))
    const call = (method: string, withId: string | undefined) =>
      api({
        method,
        id: withId,
        ip: '1.1.1.1',
        authorization: undefined,
        body: '',
      }).status
    expect(call('GET', undefined)).toBe(405)
    expect(call('DELETE', undefined)).toBe(405)
    expect(call('POST', id)).toBe(405)
    expect(call('PATCH', id)).toBe(405)
  })
})
