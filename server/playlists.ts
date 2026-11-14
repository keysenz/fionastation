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
const MAX_OWNED_LISTED = 200

export type PlaylistWrite = Readonly<{
  name: string
  entries: readonly PlaylistEntry[]
}>

export type Account = Readonly<{ discordId: string; name: string }>

export type Creator =
  | Readonly<{ kind: 'Site'; ownerDiscordId: string | undefined }>
  | Readonly<{ kind: 'Discord'; discordId: string }>

export type CreateResult =
  | Readonly<{
      kind: 'Created'
      id: string
      editToken: string | undefined
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

export type SessionStore = Readonly<{
  start: (idHash: string, account: Account, expiresAt: Date) => void
  find: (idHash: string) => Account | undefined
  end: (idHash: string) => void
}>

export type PlaylistStore = Readonly<{
  dailyCapReached: () => boolean
  create: (write: PlaylistWrite, creator: Creator) => CreateResult
  read: (id: string) => ReadResult
  authorize: (id: string, editToken: string | undefined) => AuthResult
  authorizeOwner: (id: string, discordId: string) => AuthResult
  claim: (editTokens: readonly string[], discordId: string) => string[]
  listOwned: (discordId: string) => PlaylistSummary[]
  replace: (
    id: string,
    write: PlaylistWrite,
    expectedVersion: number,
  ) => ReplaceResult
  remove: (id: string) => RemoveResult
  summarize: (id: string) => SummaryResult
  sessions: SessionStore
}>

type PlaylistRow = {
  id: string
  name: string
  entries: string
  edit_token_hash: string | null
  owner_discord_id: string | null
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

const toSummary = (row: PlaylistRow): PlaylistSummary => ({
  id: row.id,
  name: row.name,
  entryCount: (JSON.parse(row.entries) as unknown[]).length,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deleted: row.deleted_at !== null,
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
    CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY,
      discord_id TEXT NOT NULL,
      discord_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `)
  const columns = db
    .prepare('PRAGMA table_info(playlists)')
    .all() as unknown as {
    name: string
  }[]
  if (!columns.some(column => column.name === 'owner_discord_id')) {
    db.exec('ALTER TABLE playlists ADD COLUMN owner_discord_id TEXT')
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS playlists_owner
      ON playlists (owner_discord_id) WHERE owner_discord_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS playlists_edit_token
      ON playlists (edit_token_hash) WHERE edit_token_hash IS NOT NULL;
  `)

  const selectRow = db.prepare('SELECT * FROM playlists WHERE id = ?')
  const countCreated = db.prepare(
    'SELECT COUNT(*) AS n FROM playlists WHERE created_at >= ? AND created_at < ?',
  )
  const insert = db.prepare(
    `INSERT INTO playlists
       (id, name, entries, edit_token_hash, owner_discord_id, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
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

  const claimByToken = db.prepare(
    `UPDATE playlists SET owner_discord_id = ?
     WHERE edit_token_hash = ? AND owner_discord_id IS NULL AND deleted_at IS NULL`,
  )
  const selectClaimed = db.prepare(
    `SELECT id FROM playlists
     WHERE edit_token_hash = ? AND owner_discord_id = ? AND deleted_at IS NULL`,
  )
  const selectOwned = db.prepare(
    `SELECT * FROM playlists WHERE owner_discord_id = ? AND deleted_at IS NULL
     ORDER BY updated_at DESC, id LIMIT ${MAX_OWNED_LISTED}`,
  )
  const insertSession = db.prepare(
    `INSERT INTO sessions (id_hash, discord_id, discord_name, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
  const selectSession = db.prepare(
    'SELECT discord_id, discord_name FROM sessions WHERE id_hash = ? AND expires_at > ?',
  )
  const deleteSession = db.prepare('DELETE FROM sessions WHERE id_hash = ?')
  const deleteExpiredSessions = db.prepare(
    'DELETE FROM sessions WHERE expires_at <= ?',
  )

  const find = (id: string) =>
    selectRow.get(id) as unknown as PlaylistRow | undefined

  const live = (id: string, allowed: (row: PlaylistRow) => boolean) => {
    const row = find(id)
    if (!row) return 'Unknown'
    if (row.deleted_at !== null) return 'Deleted'
    return allowed(row) ? 'Allowed' : 'Forbidden'
  }

  const capReached = (at: Date) => {
    const { start, end } = utcDayBounds(at)
    const { n } = countCreated.get(start, end) as unknown as { n: number }
    return n >= dailyCap
  }

  return {
    dailyCapReached: () => capReached(now()),

    create: ({ name, entries }, creator) => {
      const at = now()
      if (capReached(at)) {
        return { kind: 'DailyCapReached' }
      }
      const editToken = creator.kind === 'Site' ? newEditToken() : undefined
      const owner =
        creator.kind === 'Site' ? creator.ownerDiscordId : creator.discordId
      const stamp = at.toISOString()
      for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
        const id = newId()
        const { changes } = insert.run(
          id,
          name,
          JSON.stringify(entries),
          editToken === undefined ? null : hashToken(editToken),
          owner ?? null,
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

    authorize: (id, editToken) =>
      live(id, row => {
        if (row.edit_token_hash === null || editToken === undefined) {
          return false
        }
        const stored = Buffer.from(row.edit_token_hash)
        const given = Buffer.from(hashToken(editToken))
        return stored.length === given.length && timingSafeEqual(stored, given)
      }),

    authorizeOwner: (id, discordId) =>
      live(id, row => row.owner_discord_id === discordId),

    claim: (editTokens, discordId) =>
      [...new Set(editTokens)].flatMap(editToken => {
        const hash = hashToken(editToken)
        claimByToken.run(discordId, hash)
        const claimed = selectClaimed.get(hash, discordId) as unknown as
          | { id: string }
          | undefined
        return claimed ? [claimed.id] : []
      }),

    listOwned: discordId =>
      (selectOwned.all(discordId) as unknown as PlaylistRow[]).map(toSummary),

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
      return { kind: 'Found', summary: toSummary(row) }
    },

    sessions: {
      start: (idHash, { discordId, name }, expiresAt) => {
        const at = now().toISOString()
        deleteExpiredSessions.run(at)
        insertSession.run(idHash, discordId, name, at, expiresAt.toISOString())
      },
      find: idHash => {
        const row = selectSession.get(
          idHash,
          now().toISOString(),
        ) as unknown as { discord_id: string; discord_name: string } | undefined
        return row && { discordId: row.discord_id, name: row.discord_name }
      },
      end: idHash => {
        deleteSession.run(idHash)
      },
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

export type Viewer =
  | Readonly<{ kind: 'Anonymous' }>
  | Readonly<{ kind: 'Member'; discordId: string }>
  | Readonly<{ kind: 'CrossSite' }>

export type PlaylistRequest = Readonly<{
  method: string
  id: string | undefined
  ip: string
  authorization: string | undefined
  viewer: Viewer
  body: string
}>
export type PlaylistReply = Readonly<{ status: number; body: unknown }>

type Checked<T> =
  | Readonly<{ kind: 'Ready'; value: T }>
  | Readonly<{ kind: 'Refused'; reply: PlaylistReply }>

const reply = (status: number, body: unknown): PlaylistReply => ({
  status,
  body,
})
const failure = (status: number, error: string) => reply(status, { error })
const ready = <T>(value: T): Checked<T> => ({ kind: 'Ready', value })
const refuse = (status: number, error: string): Checked<never> => ({
  kind: 'Refused',
  reply: failure(status, error),
})

const capReply = failure(
  503,
  'Too many playlists were saved today. Try tomorrow.',
)
const unknownReply = failure(404, 'No such playlist')
const deletedReply = failure(410, 'This playlist was deleted')
const notOwnerReply = failure(403, 'This playlist belongs to someone else')
const crossSiteReply = failure(403, 'This request came from another site')
const signedOutReply = failure(401, 'Connect Discord first')
const methodReply = failure(405, 'Method Not Allowed')
const songCountError = `A playlist holds 1 to ${MAX_ENTRIES} songs`

const parseObject = (body: string): Checked<Record<string, unknown>> => {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return refuse(400, 'The body is not JSON')
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return refuse(400, 'The body must be an object')
  }
  return ready(json as Record<string, unknown>)
}

const checkName = (name: unknown): Checked<string> => {
  if (typeof name !== 'string') return refuse(400, 'The name must be text')
  const cleaned = cleanPlaylistName(name)
  return cleaned.kind === 'TooLong'
    ? refuse(400, 'The name is longer than 60 characters')
    : ready(cleaned.name)
}

const isSongId = (id: unknown): id is string =>
  typeof id === 'string' && id !== ''

const songIdTooLong = refuse(
  400,
  `A song id is longer than ${MAX_SONG_ID_LENGTH} characters`,
)

type FindSongs = (ids: readonly string[]) => PlaylistEntry[]

const checkWrite = (
  findSongs: FindSongs,
  body: string,
): Checked<Readonly<{ write: PlaylistWrite; version: unknown }>> => {
  const parsed = parseObject(body)
  if (parsed.kind === 'Refused') return parsed
  const { name, songIds, version } = parsed.value
  if (typeof name !== 'string') return refuse(400, 'The name must be text')
  if (!Array.isArray(songIds) || !songIds.every(isSongId)) {
    return refuse(400, 'songIds must be a list of song ids')
  }
  const cleaned = checkName(name)
  if (cleaned.kind === 'Refused') return cleaned
  if (songIds.length < 1 || songIds.length > MAX_ENTRIES) {
    return refuse(400, songCountError)
  }
  if (songIds.some(id => id.length > MAX_SONG_ID_LENGTH)) return songIdTooLong
  if (new Set(songIds).size !== songIds.length) {
    return refuse(400, 'Each song may appear once')
  }
  const found = new Map(findSongs(songIds).map(song => [song.songId, song]))
  const entries = songIds.flatMap(id => found.get(id) ?? [])
  if (entries.length !== songIds.length) {
    return refuse(400, 'Some songs are not in the song list')
  }
  return ready({ write: { name: cleaned.value, entries }, version })
}

const replaceFailure = (
  kind: Exclude<ReplaceResult['kind'], 'Updated'>,
): PlaylistReply => {
  switch (kind) {
    case 'Stale':
      return failure(409, 'The playlist changed. Reload it.')
    case 'Deleted':
      return deletedReply
    case 'Unknown':
      return unknownReply
  }
}

const bearerToken = (authorization: string | undefined) =>
  /^Bearer (\S+)$/.exec(authorization ?? '')?.[1]

const isPlaylistId = (id: string) =>
  new RegExp(`^[0-9A-Za-z]{${ID_LENGTH}}$`).test(id)

const answerSafely =
  <Request>(label: string, handle: (request: Request) => PlaylistReply) =>
  (request: Request): PlaylistReply => {
    try {
      return handle(request)
    } catch (error) {
      console.error(`${label}:`, error)
      return failure(500, 'Could not read or save playlists')
    }
  }

export const createPlaylistApi = ({
  store,
  findSongs,
  now = () => new Date(),
  createsPerIpPerHour = 10,
  editsPerHour = 30,
}: Readonly<{
  store: PlaylistStore
  findSongs: FindSongs
  now?: () => Date
  createsPerIpPerHour?: number
  editsPerHour?: number
}>) => {
  const allowCreate = windowLimiter(createsPerIpPerHour, HOUR_MS, now)
  const allowEdit = windowLimiter(editsPerHour, HOUR_MS, now)

  const create = ({ ip, viewer, body }: PlaylistRequest) => {
    if (viewer.kind === 'CrossSite') return crossSiteReply
    if (!allowCreate(ip)) {
      return failure(429, 'Too many playlists from this address. Try later.')
    }
    // Turnstile check goes here: after the per-IP limit, before the daily cap.
    if (store.dailyCapReached()) return capReply
    const checked = checkWrite(findSongs, body)
    if (checked.kind === 'Refused') return checked.reply
    const created = store.create(checked.value.write, {
      kind: 'Site',
      ownerDiscordId: viewer.kind === 'Member' ? viewer.discordId : undefined,
    })
    if (created.kind === 'DailyCapReached') return capReply
    const { id, editToken, version } = created
    return reply(201, { id, editToken, version })
  }

  const edit = (request: PlaylistRequest, id: string) => {
    if (!allowEdit(id)) {
      return failure(429, 'This playlist was edited too often. Try later.')
    }
    const checked = checkWrite(findSongs, request.body)
    if (checked.kind === 'Refused') return checked.reply
    const { write, version } = checked.value
    if (
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      return failure(400, 'version must be a whole number')
    }
    const replaced = store.replace(id, write, version)
    return replaced.kind === 'Updated'
      ? reply(200, { version: replaced.version })
      : replaceFailure(replaced.kind)
  }

  const editRight = (
    { authorization, viewer }: PlaylistRequest,
    id: string,
  ): AuthResult | 'CrossSite' | 'NotOwner' => {
    const byToken = store.authorize(id, bearerToken(authorization))
    if (byToken !== 'Forbidden') return byToken
    switch (viewer.kind) {
      case 'Anonymous':
        return 'Forbidden'
      case 'CrossSite':
        return 'CrossSite'
      case 'Member':
        return store.authorizeOwner(id, viewer.discordId) === 'Allowed'
          ? 'Allowed'
          : 'NotOwner'
    }
  }

  const withEditRight = (
    request: PlaylistRequest,
    id: string,
    next: () => PlaylistReply,
  ) => {
    switch (editRight(request, id)) {
      case 'Unknown':
        return unknownReply
      case 'Deleted':
        return deletedReply
      case 'Forbidden':
        return failure(403, 'Wrong edit token')
      case 'CrossSite':
        return crossSiteReply
      case 'NotOwner':
        return notOwnerReply
      case 'Allowed':
        return next()
    }
  }

  const mine = ({ method, viewer }: PlaylistRequest) => {
    if (method !== 'GET') return methodReply
    return viewer.kind === 'Member'
      ? reply(200, { playlists: store.listOwned(viewer.discordId) })
      : signedOutReply
  }

  const claim = ({ method, viewer, body }: PlaylistRequest) => {
    if (method !== 'POST') return methodReply
    if (viewer.kind === 'CrossSite') return crossSiteReply
    if (viewer.kind === 'Anonymous') return signedOutReply
    const parsed = parseObject(body)
    if (parsed.kind === 'Refused') return parsed.reply
    const { editTokens } = parsed.value
    if (
      !Array.isArray(editTokens) ||
      !editTokens.every(token => typeof token === 'string')
    ) {
      return failure(400, 'editTokens must be a list of edit tokens')
    }
    return reply(200, { claimed: store.claim(editTokens, viewer.discordId) })
  }

  return answerSafely('Playlist store error', (request: PlaylistRequest) => {
    if (Buffer.byteLength(request.body) > MAX_BODY_BYTES) {
      return failure(413, 'The request is too large')
    }
    const { id } = request
    if (id === undefined) {
      return request.method === 'POST' ? create(request) : methodReply
    }
    if (id === 'mine') return mine(request)
    if (id === 'claim') return claim(request)
    if (!isPlaylistId(id)) return unknownReply
    switch (request.method) {
      case 'GET': {
        const read = store.read(id)
        switch (read.kind) {
          case 'Found':
            return reply(200, read.playlist)
          case 'Deleted':
            return deletedReply
          case 'Unknown':
            return unknownReply
        }
      }
      case 'PUT':
        return withEditRight(request, id, () => edit(request, id))
      case 'DELETE':
        return withEditRight(request, id, () => {
          store.remove(id)
          return reply(200, { id })
        })
      default:
        return methodReply
    }
  })
}

export type AdminRequest = Readonly<{
  method: string
  pathname: string
  authorization: string | undefined
  actingDiscordId: string | undefined
  body: string
}>

const MOD_ROUTE = /^\/admin\/playlists(?:\/([^/]+))?$/
const OWNER_ROUTE =
  /^\/admin\/owner\/playlists(?:\/([^/]+)(?:\/(name|songs)(?:\/([^/]+))?)?)?$/
const DISCORD_ID = /^\d{17,20}$/

const digest = (value: string) => createHash('sha256').update(value).digest()

export const createAdminApi = ({
  store,
  secret,
  findSongs,
  now = () => new Date(),
  createsPerMemberPerHour = 10,
  editsPerHour = 30,
}: Readonly<{
  store: PlaylistStore
  secret: string
  findSongs: FindSongs
  now?: () => Date
  createsPerMemberPerHour?: number
  editsPerHour?: number
}>) => {
  const expected = digest(secret)
  const allowCreate = windowLimiter(createsPerMemberPerHour, HOUR_MS, now)
  const allowEdit = windowLimiter(editsPerHour, HOUR_MS, now)

  const holdsSecret = (authorization: string | undefined) => {
    const given = bearerToken(authorization)
    return given !== undefined && timingSafeEqual(digest(given), expected)
  }

  const moderate = (method: string, id: string | undefined) => {
    if (id === undefined || (method !== 'GET' && method !== 'DELETE')) {
      return methodReply
    }
    if (!isPlaylistId(id)) return unknownReply
    if (method === 'DELETE' && store.remove(id) === 'Unknown') {
      return unknownReply
    }
    const found = store.summarize(id)
    return found.kind === 'Found' ? reply(200, found.summary) : unknownReply
  }

  const create = (discordId: string, body: string) => {
    if (!allowCreate(discordId)) {
      return failure(429, 'Too many playlists from this member. Try later.')
    }
    if (store.dailyCapReached()) return capReply
    const checked = checkWrite(findSongs, body)
    if (checked.kind === 'Refused') return checked.reply
    const created = store.create(checked.value.write, {
      kind: 'Discord',
      discordId,
    })
    if (created.kind === 'DailyCapReached') return capReply
    const read = store.read(created.id)
    return read.kind === 'Found' ? reply(201, read.playlist) : unknownReply
  }

  const withOwned = (
    discordId: string,
    id: string,
    next: (playlist: PlaylistJson) => PlaylistReply,
  ) => {
    if (!isPlaylistId(id)) return unknownReply
    switch (store.authorizeOwner(id, discordId)) {
      case 'Unknown':
        return unknownReply
      case 'Deleted':
        return deletedReply
      case 'Forbidden':
        return notOwnerReply
      case 'Allowed': {
        const read = store.read(id)
        return read.kind === 'Found' ? next(read.playlist) : unknownReply
      }
    }
  }

  const save = (
    { id, version }: PlaylistJson,
    change: Checked<PlaylistWrite>,
  ) => {
    if (change.kind === 'Refused') return change.reply
    if (!allowEdit(id)) {
      return failure(429, 'This playlist was edited too often. Try later.')
    }
    const replaced = store.replace(id, change.value, version)
    if (replaced.kind !== 'Updated') return replaceFailure(replaced.kind)
    const read = store.read(id)
    return read.kind === 'Found' ? reply(200, read.playlist) : unknownReply
  }

  const renamed = (
    { entries }: PlaylistJson,
    body: string,
  ): Checked<PlaylistWrite> => {
    const parsed = parseObject(body)
    if (parsed.kind === 'Refused') return parsed
    const name = checkName(parsed.value.name)
    return name.kind === 'Refused' ? name : ready({ name: name.value, entries })
  }

  const withSong = (
    { name, entries }: PlaylistJson,
    body: string,
  ): Checked<PlaylistWrite> => {
    const parsed = parseObject(body)
    if (parsed.kind === 'Refused') return parsed
    const { songId } = parsed.value
    if (!isSongId(songId)) return refuse(400, 'songId must be a song id')
    if (songId.length > MAX_SONG_ID_LENGTH) return songIdTooLong
    if (entries.some(entry => entry.songId === songId)) {
      return refuse(400, 'Each song may appear once')
    }
    if (entries.length >= MAX_ENTRIES) return refuse(400, songCountError)
    const [song] = findSongs([songId])
    return song
      ? ready({ name, entries: [...entries, song] })
      : refuse(400, 'Some songs are not in the song list')
  }

  const withoutSong = (
    { name, entries }: PlaylistJson,
    songId: string,
  ): Checked<PlaylistWrite> => {
    const kept = entries.filter(entry => entry.songId !== songId)
    if (kept.length === entries.length) {
      return refuse(404, 'That song is not in the playlist')
    }
    return kept.length === 0
      ? refuse(400, songCountError)
      : ready({ name, entries: kept })
  }

  const own = (
    { method, actingDiscordId, body }: AdminRequest,
    [id, part, songId]: readonly (string | undefined)[],
  ) => {
    if (actingDiscordId === undefined || !DISCORD_ID.test(actingDiscordId)) {
      return failure(400, 'X-Acting-Discord-Id must be a Discord user id')
    }
    const owned = (
      playlistId: string,
      next: (playlist: PlaylistJson) => PlaylistReply,
    ) => withOwned(actingDiscordId, playlistId, next)

    if (id === undefined) {
      switch (method) {
        case 'GET':
          return reply(200, { playlists: store.listOwned(actingDiscordId) })
        case 'POST':
          return create(actingDiscordId, body)
        default:
          return methodReply
      }
    }
    if (part === undefined) {
      switch (method) {
        case 'GET':
          return owned(id, playlist => reply(200, playlist))
        case 'DELETE':
          return owned(id, () => {
            store.remove(id)
            return reply(200, { id })
          })
        default:
          return methodReply
      }
    }
    if (part === 'name' && songId === undefined && method === 'PUT') {
      return owned(id, playlist => save(playlist, renamed(playlist, body)))
    }
    if (part === 'songs' && songId === undefined && method === 'POST') {
      return owned(id, playlist => save(playlist, withSong(playlist, body)))
    }
    if (part === 'songs' && songId !== undefined && method === 'DELETE') {
      return owned(id, playlist =>
        save(playlist, withoutSong(playlist, songId)),
      )
    }
    return methodReply
  }

  return answerSafely('Admin playlist error', (request: AdminRequest) => {
    if (!holdsSecret(request.authorization)) return failure(403, 'Forbidden')
    if (Buffer.byteLength(request.body) > MAX_BODY_BYTES) {
      return failure(413, 'The request is too large')
    }
    const mod = MOD_ROUTE.exec(request.pathname)
    if (mod) return moderate(request.method, mod[1])
    const owner = OWNER_ROUTE.exec(request.pathname)
    return owner ? own(request, owner.slice(1)) : failure(404, 'Not Found')
  })
}
