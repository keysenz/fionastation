import { Option, Result, Schema } from 'effect'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import {
  REQUIRED_FIELDS,
  UUID_PATTERN,
  quoteFromFields,
} from '../src/page/commission/inquiryContract.ts'
import {
  type InquiryKind,
  InquiryPayload,
  type QuoteSnapshot,
} from '../src/page/commission/inquiryPayload.ts'
import {
  type AdminRequest,
  MAX_BODY_BYTES,
  bearerHolder,
  isDiscordId,
  windowLimiter,
} from './playlists.ts'

const HOUR_MS = 60 * 60 * 1000
const MAX_FIELDS = 24
const MAX_VALUE_CHARS = 2000
const MAX_NOTE_CHARS = 1000
const MAX_UNPOSTED = 100
const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/

// STATUS MACHINE

export const NEXT_STATUSES = {
  received: ['quoted', 'declined'],
  quoted: ['deposit_paid', 'declined'],
  deposit_paid: ['in_progress'],
  in_progress: ['preview'],
  preview: ['draft'],
  draft: ['revision', 'final'],
  revision: ['draft', 'final'],
  final: [],
  declined: [],
} as const satisfies Record<string, readonly string[]>

export type Status = keyof typeof NEXT_STATUSES

const isStatus = (value: unknown): value is Status =>
  typeof value === 'string' && Object.hasOwn(NEXT_STATUSES, value)

export const nextStatuses = (status: Status): readonly Status[] =>
  NEXT_STATUSES[status]

export const isUuid = (id: string) => UUID_PATTERN.test(id)

// STORE

export type Commission = Readonly<{
  id: string
  kind: InquiryKind
  createdAt: string
  status: Status
  next: readonly Status[]
  fields: Readonly<Record<string, string>>
  quote: QuoteSnapshot | null
  channelId?: string
  messageId?: string
}>

export type CommissionEvent = Readonly<{
  status: Status
  note: string | null
  at: string
}>

export type NewCommission = Readonly<{
  id: string
  kind: InquiryKind
  payload: string
  quote: QuoteSnapshot | null
  ipHash: string
}>

export type StoredPayload = Readonly<{ payload: string }>

export type PostedResult =
  | Readonly<{ kind: 'Posted'; commission: Commission }>
  | Readonly<{ kind: 'Conflict' }>
  | Readonly<{ kind: 'Unknown' }>

export type EventResult =
  | Readonly<{ kind: 'Recorded'; commission: Commission }>
  | Readonly<{ kind: 'Repeated'; commission: Commission }>
  | Readonly<{ kind: 'Forbidden'; from: Status }>
  | Readonly<{ kind: 'Unknown' }>

export type CommissionStore = Readonly<{
  find: (id: string) => StoredPayload | undefined
  create: (commission: NewCommission) => 'Created' | 'Exists'
  read: (
    id: string,
  ) =>
    | Readonly<{ commission: Commission; events: CommissionEvent[] }>
    | undefined
  listUnposted: () => Commission[]
  markPosted: (id: string, channelId: string, messageId: string) => PostedResult
  addEvent: (
    id: string,
    status: Status,
    note: string | null,
    actorDiscordId: string,
  ) => EventResult
}>

type CommissionRow = {
  id: string
  kind: InquiryKind
  payload: string
  quote: string | null
  created_at: string
  channel_id: string | null
  message_id: string | null
  status: Status
}

type EventRow = { status: Status; note: string | null; at: string }

const toCommission = (row: CommissionRow): Commission => ({
  id: row.id,
  kind: row.kind,
  createdAt: row.created_at,
  status: row.status,
  next: nextStatuses(row.status),
  fields: JSON.parse(row.payload).fields,
  quote: row.quote === null ? null : JSON.parse(row.quote),
  ...(row.channel_id === null ? {} : { channelId: row.channel_id }),
  ...(row.message_id === null ? {} : { messageId: row.message_id }),
})

const CURRENT_STATUS = `(SELECT status FROM commission_event e
  WHERE e.commission_id = c.id ORDER BY e.seq DESC LIMIT 1)`

export const openCommissionStore = ({
  path,
  now = () => new Date(),
}: Readonly<{ path: string; now?: () => Date }>): CommissionStore => {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA busy_timeout = 1000')
  db.exec(`
    CREATE TABLE IF NOT EXISTS commission (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      quote TEXT,
      created_at TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      channel_id TEXT,
      message_id TEXT
    );
    CREATE INDEX IF NOT EXISTS commission_unposted
      ON commission (created_at) WHERE channel_id IS NULL;
    CREATE TABLE IF NOT EXISTS commission_event (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      commission_id TEXT NOT NULL REFERENCES commission (id),
      status TEXT NOT NULL,
      note TEXT,
      actor_discord_id TEXT,
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS commission_event_by_commission
      ON commission_event (commission_id, seq);
  `)

  const selectPayload = db.prepare(
    'SELECT payload FROM commission WHERE id = ?',
  )
  const selectOne = db.prepare(
    `SELECT c.*, ${CURRENT_STATUS} AS status FROM commission c WHERE c.id = ?`,
  )
  const selectUnposted = db.prepare(
    `SELECT c.*, ${CURRENT_STATUS} AS status FROM commission c
     WHERE c.channel_id IS NULL ORDER BY c.created_at, c.rowid LIMIT ${MAX_UNPOSTED}`,
  )
  const selectEvents = db.prepare(
    'SELECT status, note, at FROM commission_event WHERE commission_id = ? ORDER BY seq',
  )
  const insertCommission = db.prepare(
    `INSERT INTO commission (id, kind, payload, quote, created_at, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
  )
  const insertEvent = db.prepare(
    `INSERT INTO commission_event (commission_id, status, note, actor_discord_id, at)
     VALUES (?, ?, ?, ?, ?)`,
  )
  const setPosted = db.prepare(
    `UPDATE commission SET channel_id = ?, message_id = ?
     WHERE id = ? AND channel_id IS NULL`,
  )

  const inTransaction = <T>(run: () => T): T => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = run()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  const find = (id: string) =>
    selectOne.get(id) as unknown as CommissionRow | undefined

  return {
    find: id => selectPayload.get(id) as unknown as StoredPayload | undefined,

    create: ({ id, kind, payload, quote, ipHash }) =>
      inTransaction(() => {
        const at = now().toISOString()
        const { changes } = insertCommission.run(
          id,
          kind,
          payload,
          quote === null ? null : JSON.stringify(quote),
          at,
          ipHash,
        )
        if (changes === 0) return 'Exists'
        insertEvent.run(id, 'received', null, null, at)
        return 'Created'
      }),

    read: id => {
      const row = find(id)
      return (
        row && {
          commission: toCommission(row),
          events: selectEvents.all(id) as unknown as EventRow[],
        }
      )
    },

    listUnposted: () =>
      (selectUnposted.all() as unknown as CommissionRow[]).map(toCommission),

    markPosted: (id, channelId, messageId) => {
      setPosted.run(channelId, messageId, id)
      const row = find(id)
      if (!row) return { kind: 'Unknown' }
      return row.channel_id === channelId && row.message_id === messageId
        ? { kind: 'Posted', commission: toCommission(row) }
        : { kind: 'Conflict' }
    },

    addEvent: (id, status, note, actorDiscordId) =>
      inTransaction((): EventResult => {
        const row = find(id)
        if (!row) return { kind: 'Unknown' }
        if (row.status === status) {
          return { kind: 'Repeated', commission: toCommission(row) }
        }
        if (!nextStatuses(row.status).includes(status)) {
          return { kind: 'Forbidden', from: row.status }
        }
        insertEvent.run(id, status, note, actorDiscordId, now().toISOString())
        const updated = find(id)
        if (!updated) throw new Error('A commission vanished mid-event')
        return { kind: 'Recorded', commission: toCommission(updated) }
      }),
  }
}

// TOKENS

export const trackingToken = (secret: string, id: string) =>
  createHmac('sha256', secret).update(id).digest('base64url')

const hashIp = (secret: string, ip: string) =>
  createHmac('sha256', secret).update(`ip:${ip}`).digest('hex')

const digest = (value: string) => createHash('sha256').update(value).digest()

const tokenMatches = (secret: string, id: string, given: string | undefined) =>
  given !== undefined &&
  timingSafeEqual(digest(given), digest(trackingToken(secret, id)))

// REPLIES

export type CommissionReply = Readonly<{ status: number; body: unknown }>

const reply = (status: number, body: unknown): CommissionReply => ({
  status,
  body,
})
const failure = (status: number, error: string) => reply(status, { error })

const methodReply = failure(405, 'Method Not Allowed')
const tooLargeReply = failure(413, 'The request is too large')
const unknownReply = failure(404, 'No such commission')

const answerSafely =
  <Request>(label: string, handle: (request: Request) => CommissionReply) =>
  (request: Request): CommissionReply => {
    try {
      return handle(request)
    } catch (error) {
      console.error(`${label}:`, error)
      return failure(500, 'Could not read or save commissions')
    }
  }

const parseObject = (
  body: string,
): Result.Result<Record<string, unknown>, CommissionReply> => {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return Result.fail(failure(400, 'The body is not JSON'))
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return Result.fail(failure(400, 'The body must be an object'))
  }
  return Result.succeed(json as Record<string, unknown>)
}

// PUBLIC API

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const problemWith = (payload: InquiryPayload): string | undefined => {
  if (!isUuid(payload.id)) return 'id must be a lowercase UUID'
  const entries = Object.entries(payload.fields)
  if (entries.length > MAX_FIELDS) {
    return `Send at most ${MAX_FIELDS} fields`
  }
  const badKey = entries.find(([key]) => !FIELD_KEY.test(key))
  if (badKey) return 'A field name is not allowed'
  if (entries.some(([, value]) => value.length > MAX_VALUE_CHARS)) {
    return `A field is longer than ${MAX_VALUE_CHARS} characters`
  }
  const missing = REQUIRED_FIELDS[payload.kind].find(
    key => (payload.fields[key] ?? '').trim() === '',
  )
  return missing === undefined ? undefined : `${missing} is required`
}

export type InquiryRequest = Readonly<{
  method: string
  ip: string
  body: string
}>

export type TrackRequest = Readonly<{
  method: string
  id: string
  token: string | undefined
}>

export const createCommissionApi = ({
  store,
  secret,
  now = () => new Date(),
  createsPerIpPerHour = 5,
}: Readonly<{
  store: CommissionStore
  secret: string
  now?: () => Date
  createsPerIpPerHour?: number
}>) => {
  const allowCreate = windowLimiter(createsPerIpPerHour, HOUR_MS, now)

  const replyFor = (id: string) => ({
    id,
    trackingUrl: `/commission/${id}?t=${trackingToken(secret, id)}`,
  })

  const replayOf = (id: string, canonical: string) =>
    store.find(id)?.payload === canonical
      ? reply(200, replyFor(id))
      : failure(409, 'This inquiry id was already used for a different inquiry')

  const submit = ({ method, ip, body }: InquiryRequest) => {
    if (method !== 'POST') return methodReply
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) return tooLargeReply
    const parsed = parseObject(body)
    if (Result.isFailure(parsed)) return parsed.failure
    const decoded = Schema.decodeUnknownResult(InquiryPayload)(parsed.success)
    if (Result.isFailure(decoded)) {
      return failure(400, 'The inquiry is not in the expected shape')
    }
    const payload = decoded.success
    const problem = problemWith(payload)
    if (problem !== undefined) return failure(400, problem)
    const quote = quoteFromFields(payload.kind, payload.fields)
    if (Option.isNone(quote)) {
      return failure(400, 'The answers are not a selection the form offers')
    }
    const canonical = stableStringify(payload)
    if (store.find(payload.id) !== undefined) {
      return replayOf(payload.id, canonical)
    }
    if (!allowCreate(ip)) {
      return failure(429, 'Too many inquiries from this address. Try later.')
    }
    const created = store.create({
      id: payload.id,
      kind: payload.kind,
      payload: canonical,
      quote: quote.value,
      ipHash: hashIp(secret, ip),
    })
    return created === 'Created'
      ? reply(201, replyFor(payload.id))
      : replayOf(payload.id, canonical)
  }

  const track = ({ method, id, token }: TrackRequest) => {
    if (method !== 'GET') return methodReply
    const allowed = isUuid(id) && tokenMatches(secret, id, token)
    const found = allowed ? store.read(id) : undefined
    if (!found) return unknownReply
    const { commission, events } = found
    return reply(200, {
      id: commission.id,
      kind: commission.kind,
      createdAt: commission.createdAt,
      status: commission.status,
      events,
    })
  }

  return {
    submit: answerSafely('Commission store error', submit),
    track: answerSafely('Commission store error', track),
  }
}

// ADMIN API

const ADMIN_ROUTE =
  /^\/admin\/commissions\/(unposted|([^/]+)\/(posted|events))$/

export const createCommissionAdminApi = ({
  store,
  secret,
}: Readonly<{ store: CommissionStore; secret: string }>) => {
  const holdsSecret = bearerHolder(secret)

  const listUnposted = (method: string) =>
    method === 'GET' ? reply(200, store.listUnposted()) : methodReply

  const posted = (id: string, body: string) => {
    const parsed = parseObject(body)
    if (Result.isFailure(parsed)) return parsed.failure
    const { channelId, messageId } = parsed.success
    if (
      typeof channelId !== 'string' ||
      typeof messageId !== 'string' ||
      !isDiscordId(channelId) ||
      !isDiscordId(messageId)
    ) {
      return failure(400, 'channelId and messageId must be Discord ids')
    }
    const result = store.markPosted(id, channelId, messageId)
    switch (result.kind) {
      case 'Posted':
        return reply(200, result.commission)
      case 'Conflict':
        return failure(409, 'This commission already has a different message')
      case 'Unknown':
        return unknownReply
    }
  }

  const noteOf = (
    note: unknown,
  ): Result.Result<string | null, CommissionReply> => {
    if (note === undefined || note === null) return Result.succeed(null)
    if (typeof note !== 'string') {
      return Result.fail(failure(400, 'note must be text'))
    }
    if (note.length > MAX_NOTE_CHARS) {
      return Result.fail(
        failure(400, `note is longer than ${MAX_NOTE_CHARS} characters`),
      )
    }
    return Result.succeed(note.trim() === '' ? null : note.trim())
  }

  const event = (
    id: string,
    body: string,
    actingDiscordId: string | undefined,
  ) => {
    if (actingDiscordId === undefined || !isDiscordId(actingDiscordId)) {
      return failure(400, 'X-Acting-Discord-Id must be a Discord user id')
    }
    const parsed = parseObject(body)
    if (Result.isFailure(parsed)) return parsed.failure
    const { status, note } = parsed.success
    if (!isStatus(status)) return failure(400, 'status is not a known status')
    const checkedNote = noteOf(note)
    if (Result.isFailure(checkedNote)) return checkedNote.failure
    const result = store.addEvent(
      id,
      status,
      checkedNote.success,
      actingDiscordId,
    )
    switch (result.kind) {
      case 'Recorded':
      case 'Repeated':
        return reply(200, result.commission)
      case 'Forbidden':
        return failure(
          400,
          `A commission that is ${result.from} cannot become ${status}`,
        )
      case 'Unknown':
        return unknownReply
    }
  }

  return answerSafely('Admin commission error', (request: AdminRequest) => {
    if (!holdsSecret(request.authorization)) return failure(403, 'Forbidden')
    if (Buffer.byteLength(request.body) > MAX_BODY_BYTES) return tooLargeReply
    const route = ADMIN_ROUTE.exec(request.pathname)
    if (!route) return failure(404, 'Not Found')
    const [, , id, action] = route
    if (id === undefined || action === undefined) {
      return listUnposted(request.method)
    }
    if (request.method !== 'POST') return methodReply
    if (!isUuid(id)) return unknownReply
    return action === 'posted'
      ? posted(id, request.body)
      : event(id, request.body, request.actingDiscordId)
  })
}
