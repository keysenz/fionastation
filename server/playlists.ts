import { createHash, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import type { PlaylistEntry, PlaylistJson } from '../src/playlist.ts'
import { cleanPlaylistName } from '../src/playlistName.ts'

export const MAX_BODY_BYTES = 8 * 1024
const MAX_ENTRIES = 100
const MAX_SONG_ID_LENGTH = 64
const ID_LENGTH = 8
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const UNBIASED_BYTE_LIMIT = 256 - (256 % BASE62.length)
const HOUR_MS = 60 * 60 * 1000
const ID_ATTEMPTS = 8

export type PlaylistWrite = Readonly<{
  name: string
  entries: readonly PlaylistEntry[]
}>

export type CreateResult =
  | Readonly<{
      kind: 'Created'
      id: string
      editToken: string
      version: number
    }>
  | Readonly<{ kind: 'DailyCapReached' }>
export type ReadResult =
  | Readonly<{ kind: 'Found'; playlist: PlaylistJson }>
  | Readonly<{ kind: 'Deleted' }>
  | Readonly<{ kind: 'Unknown' }>
export type AuthResult = 'Allowed' | 'Forbidden' | 'Deleted' | 'Unknown'
export type ReplaceResult =
  | Readonly<{ kind: 'Updated'; version: number }>
  | Readonly<{ kind: 'Stale' }>
  | Readonly<{ kind: 'Deleted' }>
  | Readonly<{ kind: 'Unknown' }>
export type RemoveResult = 'Removed' | 'Unknown'
export type PlaylistSummary = Readonly<{
  id: string
  name: string
  entryCount: number
  createdAt: string
  updatedAt: string
  deleted: boolean
}>
export type SummaryResult =
  | Readonly<{ kind: 'Found'; summary: PlaylistSummary }>
  | Readonly<{ kind: 'Unknown' }>

export type PlaylistStore = Readonly<{
  dailyCapReached: () => boolean
  create: (write: PlaylistWrite) => CreateResult
  read: (id: string) => ReadResult
  authorize: (id: string, editToken: string | undefined) => AuthResult
  replace: (
    id: string,
    write: PlaylistWrite,
    expectedVersion: number,
  ) => ReplaceResult
  remove: (id: string) => RemoveResult
  summarize: (id: string) => SummaryResult
}>

type PlaylistRow = {
  id: string
  name: string
  entries: string
  edit_token_hash: string | null
  version: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

const randomBase62 = (length: number) => {
  let id = ''
  while (id.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < UNBIASED_BYTE_LIMIT && id.length < length) {
        id += BASE62[byte % 62]
      }
    }
  }
  return id
}

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex')

const newEditToken = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')

const nonEmpty = (entries: PlaylistEntry[]): PlaylistJson['entries'] => {
  const [first, ...rest] = entries
  if (!first) {
    throw new Error('A live playlist has no entries')
  }
  return [first, ...rest]
}

const toJson = (row: PlaylistRow): PlaylistJson => ({
  id: row.id,
  name: row.name,
  entries: nonEmpty(JSON.parse(row.entries)),
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const utcDayBounds = (at: Date) => {
  const start = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  )
  const end = new Date(start.getTime() + 24 * HOUR_MS)
  return { start: start.toISOString(), end: end.toISOString() }
}

export const openPlaylistStore = ({
  path,
  now = () => new Date(),
  dailyCap = 1000,
  newId = () => randomBase62(ID_LENGTH),
}: Readonly<{
  path: string
  now?: () => Date
  dailyCap?: number
  newId?: () => string
}>): PlaylistStore => {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA busy_timeout = 1000')
  db.exec(`
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entries TEXT NOT NULL,
      edit_token_hash TEXT,
      owner_discord_id TEXT,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS playlists_created_at ON playlists (created_at);
  `)

  const selectRow = db.prepare('SELECT * FROM playlists WHERE id = ?')
  const countCreated = db.prepare(
    'SELECT COUNT(*) AS n FROM playlists WHERE created_at >= ? AND created_at < ?',
  )
  const insert = db.prepare(
    `INSERT INTO playlists (id, name, entries, edit_token_hash, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
  )
  const update = db.prepare(
    `UPDATE playlists SET name = ?, entries = ?, version = version + 1, updated_at = ?
     WHERE id = ? AND version = ? AND deleted_at IS NULL`,
  )
  const markDeleted = db.prepare(
    `UPDATE playlists SET deleted_at = ?, entries = '[]', updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
  )

  const find = (id: string) =>
    selectRow.get(id) as unknown as PlaylistRow | undefined

  const capReached = (at: Date) => {
    const { start, end } = utcDayBounds(at)
    const { n } = countCreated.get(start, end) as unknown as { n: number }
    return n >= dailyCap
  }

  return {
    dailyCapReached: () => capReached(now()),

    create: ({ name, entries }) => {
      const at = now()
      if (capReached(at)) {
        return { kind: 'DailyCapReached' }
      }
      const editToken = newEditToken()
      const stamp = at.toISOString()
      for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
        const id = newId()
        const { changes } = insert.run(
          id,
          name,
          JSON.stringify(entries),
          hashToken(editToken),
          stamp,
          stamp,
        )
        if (changes === 1) {
          return { kind: 'Created', id, editToken, version: 1 }
        }
      }
      throw new Error('Could not find an unused playlist id')
    },

    read: id => {
      const row = find(id)
      if (!row) return { kind: 'Unknown' }
      if (row.deleted_at !== null) return { kind: 'Deleted' }
      return { kind: 'Found', playlist: toJson(row) }
    },

    authorize: (id, editToken) => {
      const row = find(id)
      if (!row) return 'Unknown'
      if (row.deleted_at !== null) return 'Deleted'
      if (row.edit_token_hash === null || editToken === undefined) {
        return 'Forbidden'
      }
      const stored = Buffer.from(row.edit_token_hash)
      const given = Buffer.from(hashToken(editToken))
      return stored.length === given.length && timingSafeEqual(stored, given)
        ? 'Allowed'
        : 'Forbidden'
    },

    replace: (id, { name, entries }, expectedVersion) => {
      const { changes } = update.run(
        name,
        JSON.stringify(entries),
        now().toISOString(),
        id,
        expectedVersion,
      )
      if (changes === 1) {
        return { kind: 'Updated', version: expectedVersion + 1 }
      }
      const row = find(id)
      if (!row) return { kind: 'Unknown' }
      return row.deleted_at !== null ? { kind: 'Deleted' } : { kind: 'Stale' }
    },

    remove: id => {
      const stamp = now().toISOString()
      markDeleted.run(stamp, stamp, id)
      return find(id) ? 'Removed' : 'Unknown'
    },

    summarize: id => {
      const row = find(id)
      if (!row) return { kind: 'Unknown' }
      return {
        kind: 'Found',
        summary: {
          id: row.id,
          name: row.name,
          entryCount: (JSON.parse(row.entries) as unknown[]).length,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          deleted: row.deleted_at !== null,
        },
      }
    },
  }
}

const windowLimiter = (max: number, windowMs: number, now: () => Date) => {
  const hits = new Map<string, number[]>()
  return (key: string) => {
    const at = now().getTime()
    if (hits.size > 10_000) {
      for (const [other, times] of hits) {
        if (times.every(time => time <= at - windowMs)) hits.delete(other)
      }
    }
    const recent = (hits.get(key) ?? []).filter(time => time > at - windowMs)
    if (recent.length >= max) {
      hits.set(key, recent)
      return false
    }
    hits.set(key, [...recent, at])
    return true
  }
}

export type PlaylistRequest = Readonly<{
  method: string
  id: string | undefined
  ip: string
  authorization: string | undefined
  body: string
}>
export type PlaylistReply = Readonly<{ status: number; body: unknown }>

const reply = (status: number, body: unknown): PlaylistReply => ({
  status,
  body,
})
const failure = (status: number, error: string) => reply(status, { error })
const capReply = failure(
  503,
  'Too many playlists were saved today. Try tomorrow.',
)

type ParsedWrite =
  | Readonly<{
      kind: 'Parsed'
      name: string
      songIds: string[]
      version: unknown
    }>
  | Readonly<{ kind: 'Invalid'; error: string }>

const parseWrite = (body: string): ParsedWrite => {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return { kind: 'Invalid', error: 'The body is not JSON' }
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { kind: 'Invalid', error: 'The body must be an object' }
  }
  const { name, songIds, version } = json as Record<string, unknown>
  if (typeof name !== 'string') {
    return { kind: 'Invalid', error: 'The name must be text' }
  }
  if (
    !Array.isArray(songIds) ||
    !songIds.every(id => typeof id === 'string' && id !== '')
  ) {
    return { kind: 'Invalid', error: 'songIds must be a list of song ids' }
  }
  return { kind: 'Parsed', name, songIds, version }
}

const isPlaylistId = (id: string) =>
  new RegExp(`^[0-9A-Za-z]{${ID_LENGTH}}$`).test(id)

export const createPlaylistApi = ({
  store,
  findSongs,
  now = () => new Date(),
  createsPerIpPerHour = 10,
  editsPerHour = 30,
}: Readonly<{
  store: PlaylistStore
  findSongs: (ids: readonly string[]) => PlaylistEntry[]
  now?: () => Date
  createsPerIpPerHour?: number
  editsPerHour?: number
}>) => {
  const allowCreate = windowLimiter(createsPerIpPerHour, HOUR_MS, now)
  const allowEdit = windowLimiter(editsPerHour, HOUR_MS, now)

  const checkWrite = (
    body: string,
  ):
    | Readonly<{ kind: 'Ready'; write: PlaylistWrite; version: unknown }>
    | Readonly<{ kind: 'Refused'; reply: PlaylistReply }> => {
    const refuse = (error: string) => ({
      kind: 'Refused' as const,
      reply: failure(400, error),
    })
    const parsed = parseWrite(body)
    if (parsed.kind === 'Invalid') return refuse(parsed.error)
    const cleaned = cleanPlaylistName(parsed.name)
    if (cleaned.kind === 'TooLong') {
      return refuse('The name is longer than 60 characters')
    }
    const { songIds } = parsed
    if (songIds.length < 1 || songIds.length > MAX_ENTRIES) {
      return refuse(`A playlist holds 1 to ${MAX_ENTRIES} songs`)
    }
    if (
      songIds.some(id => id.length > MAX_SONG_ID_LENGTH)
    ) {
      return refuse(`A song id is longer than ${MAX_SONG_ID_LENGTH} characters`)
    }
    if (new Set(songIds).size !== songIds.length) {
      return refuse('Each song may appear once')
    }
    const found = new Map(findSongs(songIds).map(song => [song.songId, song]))
    const entries = songIds.flatMap(id => found.get(id) ?? [])
    if (entries.length !== songIds.length) {
      return refuse('Some songs are not in the song list')
    }
    return {
      kind: 'Ready',
      write: { name: cleaned.name, entries },
      version: parsed.version,
    }
  }

  const create = (request: PlaylistRequest) => {
    if (!allowCreate(request.ip)) {
      return failure(429, 'Too many playlists from this address. Try later.')
    }
    // Turnstile check goes here: after the per-IP limit, before the daily cap.
    if (store.dailyCapReached()) return capReply
    const checked = checkWrite(request.body)
    if (checked.kind === 'Refused') return checked.reply
    const created = store.create(checked.write)
    if (created.kind === 'DailyCapReached') return capReply
    const { id, editToken, version } = created
    return reply(201, { id, editToken, version })
  }

  const edit = (request: PlaylistRequest, id: string) => {
    if (!allowEdit(id)) {
      return failure(429, 'This playlist was edited too often. Try later.')
    }
    const checked = checkWrite(request.body)
    if (checked.kind === 'Refused') return checked.reply
    const { version } = checked
    if (
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      return failure(400, 'version must be a whole number')
    }
    const replaced = store.replace(id, checked.write, version)
    switch (replaced.kind) {
      case 'Updated':
        return reply(200, { version: replaced.version })
      case 'Stale':
        return failure(409, 'The playlist changed. Reload it.')
      case 'Deleted':
        return failure(410, 'This playlist was deleted')
      case 'Unknown':
        return failure(404, 'No such playlist')
    }
  }

  const withToken = (
    request: PlaylistRequest,
    id: string,
    next: () => PlaylistReply,
  ) => {
    const token = /^Bearer (\S+)$/.exec(request.authorization ?? '')?.[1]
    switch (store.authorize(id, token)) {
      case 'Unknown':
        return failure(404, 'No such playlist')
      case 'Forbidden':
        return failure(403, 'Wrong edit token')
      case 'Deleted':
        return failure(410, 'This playlist was deleted')
      case 'Allowed':
        return next()
    }
  }

  const handle = (request: PlaylistRequest): PlaylistReply => {
    if (Buffer.byteLength(request.body) > MAX_BODY_BYTES) {
      return failure(413, 'The request is too large')
    }
    const { id } = request
    if (id === undefined) {
      return request.method === 'POST'
        ? create(request)
        : failure(405, 'Method Not Allowed')
    }
    if (!isPlaylistId(id)) {
      return failure(404, 'No such playlist')
    }
    switch (request.method) {
      case 'GET': {
        const read = store.read(id)
        switch (read.kind) {
          case 'Found':
            return reply(200, read.playlist)
          case 'Deleted':
            return failure(410, 'This playlist was deleted')
          case 'Unknown':
            return failure(404, 'No such playlist')
        }
      }
      case 'PUT':
        return withToken(request, id, () => edit(request, id))
      case 'DELETE':
        return withToken(request, id, () => {
          store.remove(id)
          return reply(200, { id })
        })
      default:
        return failure(405, 'Method Not Allowed')
    }
  }
  return (request: PlaylistRequest): PlaylistReply => {
    try {
      return handle(request)
    } catch (error) {
      console.error('Playlist store error:', error)
      return failure(500, 'Could not read or save playlists')
    }
  }
}

export type AdminRequest = Readonly<{
  method: string
  id: string | undefined
  authorization: string | undefined
}>

const digest = (value: string) => createHash('sha256').update(value).digest()

export const createAdminApi = ({
  store,
  secret,
}: Readonly<{ store: PlaylistStore; secret: string }>) => {
  const expected = digest(secret)
  const holdsSecret = (authorization: string | undefined) => {
    const given = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1]
    return given !== undefined && timingSafeEqual(digest(given), expected)
  }

  const handle = ({ method, id, authorization }: AdminRequest) => {
    if (!holdsSecret(authorization)) return failure(403, 'Forbidden')
    if (id === undefined || (method !== 'GET' && method !== 'DELETE')) {
      return failure(405, 'Method Not Allowed')
    }
    if (!isPlaylistId(id)) return failure(404, 'No such playlist')
    if (method === 'DELETE' && store.remove(id) === 'Unknown') {
      return failure(404, 'No such playlist')
    }
    const found = store.summarize(id)
    return found.kind === 'Found'
      ? reply(200, found.summary)
      : failure(404, 'No such playlist')
  }

  return (request: AdminRequest): PlaylistReply => {
    try {
      return handle(request)
    } catch (error) {
      console.error('Admin playlist error:', error)
      return failure(500, 'Could not read or save playlists')
    }
  }
}
