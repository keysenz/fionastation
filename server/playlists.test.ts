// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { PlaylistEntry } from '../src/playlist.ts'
import {
  type Creator,
  MAX_BODY_BYTES,
  type PlaylistReply,
  type PlaylistStore,
  type Viewer,
  createAdminApi,
  createPlaylistApi,
  openPlaylistStore,
} from './playlists.ts'

const entry = (songId: string): PlaylistEntry => ({
  songId,
  videoUrl: `https://youtu.be/${songId}`,
  timestamp: '0:30',
  title: `Title of ${songId}`,
})

const VISITOR: Creator = { kind: 'Site', ownerDiscordId: undefined }
const ANONYMOUS: Viewer = { kind: 'Anonymous' }
const ALICE = '111111111111111111'
const BOB = '222222222222222222'
const member = (discordId: string): Viewer => ({ kind: 'Member', discordId })
const CROSS_SITE: Viewer = { kind: 'CrossSite' }

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
  const result = store.create({ name, entries: ids.map(entry) }, VISITOR)
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
      store.create({ name: 'one too many', entries: [entry('a')] }, VISITOR),
    ).toEqual({
      kind: 'DailyCapReached',
    })
    clock = new Date('2026-11-14T23:59:59Z')
    expect(
      store.create({ name: 'still today', entries: [entry('a')] }, VISITOR)
        .kind,
    ).toBe('DailyCapReached')
    clock = new Date('2026-11-15T00:00:00Z')
    expect(
      store.create({ name: 'tomorrow', entries: [entry('a')] }, VISITOR).kind,
    ).toBe('Created')
  })

  test('deleted playlists still count against the daily cap', () => {
    const store = openPlaylistStore({ path: dbPath, now, dailyCap: 2 })
    store.remove(created(store).id)
    created(store)
    expect(
      store.create({ name: 'c', entries: [entry('a')] }, VISITOR).kind,
    ).toBe('DailyCapReached')
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

  test('a database from before ownership upgrades in place and keeps its playlists', () => {
    const old = new DatabaseSync(dbPath)
    old.exec(`
      CREATE TABLE playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        entries TEXT NOT NULL,
        edit_token_hash TEXT,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
    `)
    old
      .prepare(
        `INSERT INTO playlists VALUES ('OLDplay1', 'Before login', ?, 'hash', 3, ?, ?, NULL)`,
      )
      .run(
        JSON.stringify([entry('a')]),
        '2026-11-01T00:00:00.000Z',
        '2026-11-02T00:00:00.000Z',
      )
    old.close()

    openPlaylistStore({ path: dbPath, now })
    const store = openPlaylistStore({ path: dbPath, now })

    const read = store.read('OLDplay1')
    if (read.kind !== 'Found') throw new Error(read.kind)
    expect(read.playlist.name).toBe('Before login')
    expect(read.playlist.version).toBe(3)
    expect(store.authorizeOwner('OLDplay1', ALICE)).toBe('Forbidden')
    const raw = new DatabaseSync(dbPath, { readOnly: true })
    const columns = raw.prepare('PRAGMA table_info(playlists)').all()
    expect(columns.map(column => column['name'])).toContain('owner_discord_id')
    expect(
      raw
        .prepare(`SELECT name FROM sqlite_master WHERE name = 'sessions'`)
        .get(),
    ).toEqual({ name: 'sessions' })
  })

  test('a session is found until it expires or ends', () => {
    const store = openPlaylistStore({ path: dbPath, now })
    const alice = { discordId: ALICE, name: 'Alice' }
    store.sessions.start('hash-a', alice, new Date('2026-11-15T10:00:00Z'))
    store.sessions.start('hash-b', alice, new Date('2026-12-14T10:00:00Z'))
    expect(store.sessions.find('hash-a')).toEqual(alice)
    expect(store.sessions.find('unknown')).toBeUndefined()

    clock = new Date('2026-11-15T10:00:00Z')
    expect(store.sessions.find('hash-a')).toBeUndefined()
    expect(store.sessions.find('hash-b')).toEqual(alice)

    store.sessions.end('hash-b')
    expect(store.sessions.find('hash-b')).toBeUndefined()
  })

  test('starting a session clears the expired ones', () => {
    const store = openPlaylistStore({ path: dbPath, now })
    const alice = { discordId: ALICE, name: 'Alice' }
    store.sessions.start('old', alice, new Date('2026-11-14T11:00:00Z'))
    clock = new Date('2026-11-14T12:00:00Z')
    store.sessions.start('new', alice, new Date('2026-12-14T12:00:00Z'))
    const raw = new DatabaseSync(dbPath, { readOnly: true })
    expect(raw.prepare('SELECT id_hash FROM sessions').all()).toEqual([
      { id_hash: 'new' },
    ])
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
  const findSongs = (ids: readonly string[]) =>
    ids
      .filter(id => known.has(id))
      .map(entry)
      .reverse()
  const api = createPlaylistApi({
    store,
    now,
    findSongs,
    ...overrides,
  })
  const post = (body: unknown, ip = '1.1.1.1', viewer: Viewer = ANONYMOUS) =>
    api({
      method: 'POST',
      id: undefined,
      ip,
      authorization: undefined,
      viewer,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  const send = (
    method: string,
    id: string,
    token: string | undefined,
    body?: unknown,
    ip = '1.1.1.1',
    viewer: Viewer = ANONYMOUS,
  ) =>
    api({
      method,
      id,
      ip,
      authorization: token === undefined ? undefined : `Bearer ${token}`,
      viewer,
      body: body === undefined ? '' : JSON.stringify(body),
    })
  const as = (viewer: Viewer) => ({
    post: (body: unknown) => post(body, '1.1.1.1', viewer),
    send: (method: string, id: string, body?: unknown) =>
      send(method, id, undefined, body, '1.1.1.1', viewer),
  })
  const rows = () =>
    (
      new DatabaseSync(dbPath, { readOnly: true })
        .prepare('SELECT COUNT(*) AS n FROM playlists')
        .get() as { n: number }
    ).n
  return { api, post, send, as, rows, store, findSongs }
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
      viewer: ANONYMOUS,
      body: JSON.stringify({ name: 'x', songIds: ['s1'] }),
    }
    expect(api(request).status).toBe(503)
    expect(api(request).status).toBe(429)
  })

  test('with the daily cap reached, invalid and duplicate-id bodies get 503 and no song lookup runs', () => {
    const store = openPlaylistStore({ path: dbPath, now, dailyCap: 0 })
    let lookups = 0
    const api = createPlaylistApi({
      store,
      now,
      findSongs: ids => {
        lookups++
        return ids.map(entry)
      },
    })
    const post = (body: string) =>
      api({
        method: 'POST',
        id: undefined,
        ip: '1.1.1.1',
        authorization: undefined,
        viewer: ANONYMOUS,
        body,
      }).status
    expect(post('nope')).toBe(503)
    expect(post(JSON.stringify({ name: 'x', songIds: ['s1', 's1'] }))).toBe(503)
    expect(post(JSON.stringify({ name: 'x', songIds: ['s1'] }))).toBe(503)
    expect(lookups).toBe(0)
  })

  test('a store error answers a JSON 500 instead of throwing', () => {
    const store = openPlaylistStore({ path: dbPath, now })
    const api = createPlaylistApi({
      store: {
        ...store,
        read: () => {
          throw new Error('database is locked')
        },
      },
      now,
      findSongs: ids => ids.map(entry),
    })
    const failed = api({
      method: 'GET',
      id: 'abcd1234',
      ip: '1.1.1.1',
      authorization: undefined,
      viewer: ANONYMOUS,
      body: '',
    })
    expect(failed.status).toBe(500)
    expect(failed.body).toEqual({ error: expect.any(String) })
  })

  test('a song id over 64 characters is a 400 whose message is not the duplicate one', () => {
    const { post, rows } = harness()
    const tooLong = post({ name: 'x', songIds: ['s'.repeat(65)] })
    const duplicate = post({ name: 'x', songIds: ['s1', 's1'] })
    expect(tooLong.status).toBe(400)
    expect(tooLong.body).not.toEqual(duplicate.body)
    expect(rows()).toBe(0)
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
        viewer: ANONYMOUS,
        body: '',
      }).status
    expect(call('GET', undefined)).toBe(405)
    expect(call('DELETE', undefined)).toBe(405)
    expect(call('POST', id)).toBe(405)
    expect(call('PATCH', id)).toBe(405)
  })
})

describe('ownership', () => {
  const idsOf = (reply: PlaylistReply) =>
    (reply.body as { playlists: { id: string }[] }).playlists.map(
      ({ id }) => id,
    )
  const version1 = { name: 'Renamed', songIds: ['s2'], version: 1 }

  test('a claim with the edit tokens makes both playlists the member’s own', () => {
    const { post, send, as } = harness()
    const first = bodyOf(post({ name: 'one', songIds: ['s1'] }))
    const second = bodyOf(post({ name: 'two', songIds: ['s2'] }))
    const alice = as(member(ALICE))

    const claimed = alice.send('POST', 'claim', {
      editTokens: [first.editToken, second.editToken, 'not-a-token'],
    })

    expect(claimed.status).toBe(200)
    expect(claimed.body).toEqual({ claimed: [first.id, second.id] })
    expect(idsOf(alice.send('GET', 'mine')).sort()).toEqual(
      [first.id, second.id].sort(),
    )
    expect(send('GET', first.id, undefined).status).toBe(200)
  })

  test('a claim never takes a playlist that already has an owner, and repeats safely', () => {
    const { post, as } = harness()
    const { id, editToken } = bodyOf(post({ name: 'one', songIds: ['s1'] }))
    const claim = (viewer: Viewer) =>
      as(viewer).send('POST', 'claim', { editTokens: [editToken] }).body

    expect(claim(member(ALICE))).toEqual({ claimed: [id] })
    expect(claim(member(ALICE))).toEqual({ claimed: [id] })
    expect(claim(member(BOB))).toEqual({ claimed: [] })
    expect(idsOf(as(member(BOB)).send('GET', 'mine'))).toEqual([])
  })

  test('claim and mine need a session, and a cross-site claim is refused', () => {
    const { post, as } = harness()
    const { editToken } = bodyOf(post({ name: 'one', songIds: ['s1'] }))
    const body = { editTokens: [editToken] }
    const alice = as(member(ALICE))

    expect(as(ANONYMOUS).send('POST', 'claim', body).status).toBe(401)
    expect(as(ANONYMOUS).send('GET', 'mine').status).toBe(401)
    expect(as(CROSS_SITE).send('POST', 'claim', body).status).toBe(403)
    expect(alice.send('POST', 'claim', { editTokens: 'x' }).status).toBe(400)
    expect(alice.send('GET', 'claim').status).toBe(405)
    expect(alice.send('POST', 'mine').status).toBe(405)
    expect(idsOf(alice.send('GET', 'mine'))).toEqual([])
  })

  test('a playlist saved with a session belongs to that member and still gets a token', () => {
    const { as, send } = harness()
    const alice = as(member(ALICE))
    const made = bodyOf(alice.post({ name: 'mine', songIds: ['s1'] }))

    expect(made.editToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(idsOf(alice.send('GET', 'mine'))).toEqual([made.id])
    expect(send('PUT', made.id, made.editToken, version1).status).toBe(200)
  })

  test('the owner edits and deletes without a token', () => {
    const { as, send } = harness()
    const alice = as(member(ALICE))
    const { id } = bodyOf(alice.post({ name: 'mine', songIds: ['s1'] }))

    expect(alice.send('PUT', id, version1).body).toEqual({ version: 2 })
    expect(bodyOf(send('GET', id, undefined)).name).toBe('Renamed')
    expect(alice.send('DELETE', id).status).toBe(200)
    expect(send('GET', id, undefined).status).toBe(410)
    expect(idsOf(alice.send('GET', 'mine'))).toEqual([])
  })

  test('another member, a visitor and a cross-site request cannot edit or delete it', () => {
    const { as, send } = harness()
    const { id } = bodyOf(
      as(member(ALICE)).post({ name: 'mine', songIds: ['s1'] }),
    )

    for (const viewer of [member(BOB), ANONYMOUS, CROSS_SITE]) {
      expect(as(viewer).send('PUT', id, version1).status).toBe(403)
      expect(as(viewer).send('DELETE', id).status).toBe(403)
    }
    const read = bodyOf(send('GET', id, undefined))
    expect(read.name).toBe('mine')
    expect(read.version).toBe(1)
  })

  test('a cross-site save is refused before it counts or writes', () => {
    const { as, rows } = harness({ createsPerIpPerHour: 1 })
    const body = { name: 'x', songIds: ['s1'] }

    expect(as(CROSS_SITE).post(body).status).toBe(403)
    expect(rows()).toBe(0)
    expect(as(ANONYMOUS).post(body).status).toBe(201)
  })

  test('the edit token still works for a visitor after a member claims the playlist', () => {
    const { post, send, as } = harness()
    const { id, editToken } = bodyOf(post({ name: 'one', songIds: ['s1'] }))
    const alice = as(member(ALICE))
    alice.send('POST', 'claim', { editTokens: [editToken] })

    expect(send('PUT', id, editToken, version1).status).toBe(200)
    expect(alice.send('PUT', id, { ...version1, version: 2 }).status).toBe(200)
  })
})

describe('admin api', () => {
  const SECRET = 'a-throwaway-admin-secret'
  const adminHarness = () => {
    const { post, send, store, findSongs } = harness()
    const admin = createAdminApi({ store, secret: SECRET, findSongs, now })
    const request = (
      method: string,
      pathname: string,
      options: Readonly<{
        secret?: string | null
        acting?: string
        body?: unknown
      }> = {},
    ) =>
      admin({
        method,
        pathname,
        authorization:
          options.secret === null
            ? undefined
            : `Bearer ${options.secret ?? SECRET}`,
        actingDiscordId: options.acting,
        body: options.body === undefined ? '' : JSON.stringify(options.body),
      })
    const call = (
      method: string,
      id: string | undefined,
      secret: string | null = SECRET,
    ) =>
      request(
        method,
        id === undefined ? '/admin/playlists' : `/admin/playlists/${id}`,
        { secret },
      )
    const owner = (acting: string, method: string, path = '', body?: unknown) =>
      request(method, `/admin/owner/playlists${path}`, { acting, body })
    const make = (name = 'Rainy day Fio', songIds = ['s1', 's2']) =>
      bodyOf(post({ name, songIds }))
    return { call, make, send, owner, request, store }
  }

  test('GET summarises a live playlist without its entries or token', () => {
    const { call, make } = adminHarness()
    const { id } = make('Rainy day Fio', ['s1', 's2', 's3'])
    const reply = call('GET', id)
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({
      id,
      name: 'Rainy day Fio',
      entryCount: 3,
      createdAt: '2026-11-14T10:00:00.000Z',
      updatedAt: '2026-11-14T10:00:00.000Z',
      deleted: false,
    })
  })

  test('GET of an unknown or malformed id is 404', () => {
    const { call } = adminHarness()
    expect(call('GET', 'zzzzzzzz').status).toBe(404)
    expect(call('GET', 'short').status).toBe(404)
  })

  test('a wrong, missing or malformed secret is 403 and changes nothing', () => {
    const { call, make, send } = adminHarness()
    const { id } = make()
    expect(call('GET', id, 'wrong').status).toBe(403)
    expect(call('GET', id, SECRET + 'x').status).toBe(403)
    expect(call('DELETE', id, 'wrong').status).toBe(403)
    expect(call('DELETE', id, null).status).toBe(403)
    expect(
      createAdminApi({
        store: harness().store,
        secret: SECRET,
        findSongs: () => [],
      })({
        method: 'GET',
        pathname: `/admin/playlists/${id}`,
        authorization: SECRET,
        actingDiscordId: undefined,
        body: '',
      }).status,
    ).toBe(403)
    expect(send('GET', id, undefined).status).toBe(200)
  })

  test('DELETE leaves the row reporting deleted and the public read at 410', () => {
    const { call, make, send } = adminHarness()
    const { id } = make()
    expect(call('DELETE', id).status).toBe(200)
    expect(call('GET', id).body).toMatchObject({
      id,
      entryCount: 0,
      deleted: true,
    })
    expect(send('GET', id, undefined).status).toBe(410)
  })

  test('DELETE twice answers 200 both times and the second changes nothing', () => {
    const { call, make } = adminHarness()
    const { id } = make()
    expect(call('DELETE', id).status).toBe(200)
    const before = call('GET', id).body
    clock = new Date('2026-11-14T12:00:00Z')
    expect(call('DELETE', id).status).toBe(200)
    expect(call('GET', id).body).toEqual(before)
  })

  test('DELETE of an unknown id is 404', () => {
    const { call } = adminHarness()
    expect(call('DELETE', 'zzzzzzzz').status).toBe(404)
  })

  test('the owner can no longer edit a playlist the admin deleted', () => {
    const { call, make, send } = adminHarness()
    const { id, editToken } = make()
    call('DELETE', id)
    expect(
      send('PUT', id, editToken, { name: 'n', songIds: ['s1'], version: 1 })
        .status,
    ).toBe(410)
  })

  test('methods outside GET and DELETE, and a missing id, are 405', () => {
    const { call, make } = adminHarness()
    const { id } = make()
    expect(call('PUT', id).status).toBe(405)
    expect(call('POST', id).status).toBe(405)
    expect(call('GET', undefined).status).toBe(405)
  })
  describe('owner routes', () => {
    const songsOf = (reply: PlaylistReply) =>
      bodyOf(reply).entries.map(({ songId }) => songId)
    const start = (acting = ALICE, songIds = ['s1']) => {
      const tools = adminHarness()
      const made = tools.owner(acting, 'POST', '', {
        name: ' Rainy  ',
        songIds,
      })
      return { ...tools, made, id: bodyOf(made).id }
    }

    test('a member creates, lists, renames, adds to, removes from and deletes a playlist', () => {
      const { owner, send, made, id } = start()
      const read = () => bodyOf(send('GET', id, undefined))

      expect(made.status).toBe(201)
      expect(bodyOf(made)).toMatchObject({ name: 'Rainy', version: 1 })
      expect(bodyOf(made).editToken).toBeUndefined()
      expect(owner(ALICE, 'GET').body).toEqual({
        playlists: [
          expect.objectContaining({ id, name: 'Rainy', entryCount: 1 }),
        ],
      })

      const renamed = owner(ALICE, 'PUT', `/${id}/name`, { name: 'Sunny' })
      expect(renamed.status).toBe(200)
      expect(read()).toMatchObject({ name: 'Sunny', version: 2 })

      const added = owner(ALICE, 'POST', `/${id}/songs`, { songId: 's2' })
      expect(added.status).toBe(200)
      expect(songsOf(added)).toEqual(['s1', 's2'])
      expect(read().entries).toEqual([entry('s1'), entry('s2')])

      const removed = owner(ALICE, 'DELETE', `/${id}/songs/s1`)
      expect(removed.status).toBe(200)
      expect(read()).toMatchObject({ entries: [entry('s2')], version: 4 })
      expect(songsOf(owner(ALICE, 'GET', `/${id}`))).toEqual(['s2'])

      expect(owner(ALICE, 'DELETE', `/${id}`).body).toEqual({ id })
      expect(send('GET', id, undefined).status).toBe(410)
      expect(owner(ALICE, 'GET').body).toEqual({ playlists: [] })
      expect(owner(ALICE, 'GET', `/${id}`).status).toBe(410)
    })

    test('a playlist made from Discord has no edit token', () => {
      const { send, id } = start()
      const body = { name: 'x', songIds: ['s1'], version: 1 }
      expect(send('PUT', id, 'any-token', body).status).toBe(403)
      expect(send('PUT', id, undefined, body).status).toBe(403)
    })

    test('another Discord id is refused on every route and nothing changes', () => {
      const { owner, send, id } = start()
      const status = (method: string, path: string, body?: unknown) =>
        owner(BOB, method, path, body).status

      expect(status('GET', `/${id}`)).toBe(403)
      expect(status('PUT', `/${id}/name`, { name: 'Taken' })).toBe(403)
      expect(status('POST', `/${id}/songs`, { songId: 's2' })).toBe(403)
      expect(status('DELETE', `/${id}/songs/s1`)).toBe(403)
      expect(status('DELETE', `/${id}`)).toBe(403)
      expect(owner(BOB, 'GET').body).toEqual({ playlists: [] })
      expect(bodyOf(send('GET', id, undefined))).toMatchObject({
        name: 'Rainy',
        entries: [entry('s1')],
        version: 1,
      })
    })

    test('a playlist with no owner is refused, and an unknown one is 404', () => {
      const { owner, make } = adminHarness()
      const { id } = make()
      const rename = owner(ALICE, 'PUT', `/${id}/name`, { name: 'Mine now' })
      expect(rename.status).toBe(403)
      expect(owner(ALICE, 'GET', '/zzzzzzzz').status).toBe(404)
      expect(owner(ALICE, 'GET', '/short').status).toBe(404)
    })

    test('the acting id must be a Discord user id, and the secret still gates', () => {
      const { request } = adminHarness()
      const path = '/admin/owner/playlists'
      expect(request('GET', path).status).toBe(400)
      expect(request('GET', path, { acting: 'alice' }).status).toBe(400)
      expect(
        request('GET', path, { acting: ALICE, secret: 'wrong' }).status,
      ).toBe(403)
      expect(request('GET', '/admin/owner', { acting: ALICE }).status).toBe(404)
    })

    test('names and songs follow the public rules', () => {
      const { owner, send, id } = start(ALICE, ['s1', 's2'])
      const status = (method: string, path: string, body?: unknown) =>
        owner(ALICE, method, path, body).status
      const long = 'x'.repeat(61)

      expect(status('POST', '', { name: 'x', songIds: ['s1', 's1'] })).toBe(400)
      expect(status('POST', '', { name: 'x', songIds: ['nope'] })).toBe(400)
      expect(status('POST', '', { name: long, songIds: ['s1'] })).toBe(400)
      expect(status('PUT', `/${id}/name`, { name: long })).toBe(400)
      expect(status('PUT', `/${id}/name`, { name: 7 })).toBe(400)
      expect(status('POST', `/${id}/songs`, { songId: 's1' })).toBe(400)
      expect(status('POST', `/${id}/songs`, { songId: 'nope' })).toBe(400)
      expect(status('POST', `/${id}/songs`, {})).toBe(400)
      expect(status('DELETE', `/${id}/songs/s3`)).toBe(404)
      expect(status('DELETE', `/${id}/songs/s1`)).toBe(200)
      expect(status('DELETE', `/${id}/songs/s2`)).toBe(400)
      expect(status('PATCH', `/${id}`)).toBe(405)
      expect(status('GET', `/${id}/songs`)).toBe(405)
      expect(bodyOf(send('GET', id, undefined)).entries).toEqual([entry('s2')])

      const blank = owner(ALICE, 'PUT', `/${id}/name`, { name: '   ' })
      expect(bodyOf(blank).name).toBe('Untitled playlist')
    })

    const withEverySong = (dailyCap = 1000) => {
      const admin = createAdminApi({
        store: openPlaylistStore({ path: dbPath, now, dailyCap }),
        secret: SECRET,
        now,
        findSongs: ids => ids.map(entry),
      })
      return (method: string, path: string, body: unknown) =>
        admin({
          method,
          pathname: `/admin/owner/playlists${path}`,
          authorization: `Bearer ${SECRET}`,
          actingDiscordId: ALICE,
          body: JSON.stringify(body),
        })
    }

    test('a playlist stops at 100 songs', () => {
      const call = withEverySong()
      const songIds = Array.from({ length: 100 }, (_, i) => `song${i}`)
      const made = call('POST', '', { name: 'full', songIds })
      expect(made.status).toBe(201)
      const add = call('POST', `/${bodyOf(made).id}/songs`, { songId: 'more' })
      expect(add.status).toBe(400)
    })

    test('the 11th create from one member in an hour is a 429 and another member is fine', () => {
      const { owner } = adminHarness()
      const body = { name: 'x', songIds: ['s1'] }
      for (let i = 0; i < 10; i++) {
        expect(owner(ALICE, 'POST', '', body).status).toBe(201)
      }
      expect(owner(ALICE, 'POST', '', body).status).toBe(429)
      expect(owner(BOB, 'POST', '', body).status).toBe(201)
      clock = new Date(clock.getTime() + 61 * 60 * 1000)
      expect(owner(ALICE, 'POST', '', body).status).toBe(201)
    })

    test('the daily cap stops a member create', () => {
      const call = withEverySong(0)
      expect(call('POST', '', { name: 'x', songIds: ['s1'] }).status).toBe(503)
    })
  })
})
