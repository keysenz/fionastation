import type { DatabaseSync } from 'node:sqlite'

import type { StatOrigin } from './stats.ts'

const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const MAX_SEQ = 1_000_000
export const MAX_POOL_SIZE = 100_000
export const MAX_SONG_ID_LENGTH = 100
export const DEFAULT_TRAIL_DAYS = 180
export const MIN_TRANSITION_PLAYS = 2
export const MAX_TRANSITIONS = 500
export const EXPORT_PAGE_SIZE = 1000

export const POLICY_PROPENSITY: Readonly<
  Record<string, (poolSize: number) => number>
> = {
  'uniform-v1': poolSize => 1 / poolSize,
}

export type TrailTag = Readonly<{
  sessionId: string
  seq: number
  prevSongId: string | null
}>

export type TrailKind = 'Click' | 'Play' | 'Finish' | 'Skip'

export type TrailEvent = Readonly<{
  trail: TrailTag
  kind: TrailKind
  songId: string
  origin: StatOrigin
  secondsIntoSong: number | null
}>

export type Decision = Readonly<{
  kind: 'Decision'
  songId: string
  sessionId: string
  seq: number
  policy: string
  poolSize: number
  prevSongId: string | null
}>

export type OutcomeCount = Readonly<{
  origin: StatOrigin
  kind: 'Play' | 'Finish' | 'Skip'
  count: number
}>

export type OriginSkip = Readonly<{
  origin: StatOrigin
  secondsIntoSong: number
}>

export type TransitionRow = Readonly<{
  prevSongId: string
  songId: string
  plays: number
  finishes: number
  skips: number
}>

export type EventRow = Readonly<{
  sessionId: string
  seq: number
  minute: string
  songId: string
  kind: TrailKind
  origin: StatOrigin
  secondsIntoSong: number | null
  prevSongId: string | null
}>

export type DecisionRow = Readonly<{
  sessionId: string
  seq: number
  minute: string
  policy: string
  poolSize: number
  propensity: number
  pickedSongId: string
  prevSongId: string | null
}>

export const EXPORT_TABLES = ['events', 'decisions'] as const
export type ExportTable = (typeof EXPORT_TABLES)[number]

export const isSessionId = (value: unknown): value is string =>
  typeof value === 'string' && SESSION_ID.test(value)

const isSeq = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= MAX_SEQ

export const isSongId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value !== '' &&
  value.length <= MAX_SONG_ID_LENGTH

type TrailFields = Readonly<{
  sessionId?: unknown
  seq?: unknown
  prevSongId?: unknown
}>

export const parseTrailTag = ({
  sessionId,
  seq,
  prevSongId,
}: TrailFields): Readonly<{ trail: TrailTag | undefined }> | undefined => {
  if (
    sessionId === undefined &&
    seq === undefined &&
    prevSongId === undefined
  ) {
    return { trail: undefined }
  }
  if (!isSessionId(sessionId) || !isSeq(seq)) return undefined
  if (prevSongId !== undefined && !isSongId(prevSongId)) return undefined
  return {
    trail: {
      sessionId: sessionId.toLowerCase(),
      seq,
      prevSongId: prevSongId ?? null,
    },
  }
}

export const parseDecision = (
  fields: Readonly<Record<string, unknown>>,
): Decision | undefined => {
  const { kind, songId, policy, poolSize, sessionId, seq, prevSongId, ...rest } =
    fields
  const parsed = parseTrailTag({ sessionId, seq, prevSongId })
  if (
    kind !== 'Decision' ||
    Object.keys(rest).length > 0 ||
    !parsed?.trail ||
    !isSongId(songId) ||
    typeof policy !== 'string' ||
    !Object.hasOwn(POLICY_PROPENSITY, policy) ||
    typeof poolSize !== 'number' ||
    !Number.isInteger(poolSize) ||
    poolSize < 1 ||
    poolSize > MAX_POOL_SIZE
  ) {
    return undefined
  }
  const { trail } = parsed
  return {
    kind,
    songId,
    sessionId: trail.sessionId,
    seq: trail.seq,
    policy,
    poolSize,
    prevSongId: trail.prevSongId,
  }
}

export const minuteOf = (date: Date) => date.toISOString().slice(0, 16)

export const createTrail = (db: DatabaseSync) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS listen_events (
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      minute TEXT NOT NULL,
      song_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      origin TEXT NOT NULL,
      seconds_into_song INTEGER,
      prev_song_id TEXT,
      PRIMARY KEY (session_id, seq)
    ) WITHOUT ROWID
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS autoplay_decisions (
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      minute TEXT NOT NULL,
      policy TEXT NOT NULL,
      pool_size INTEGER NOT NULL,
      propensity REAL NOT NULL,
      picked_song_id TEXT NOT NULL,
      prev_song_id TEXT,
      PRIMARY KEY (session_id, seq)
    ) WITHOUT ROWID
  `)
  const addEvent = db.prepare(`
    INSERT OR IGNORE INTO listen_events
      (session_id, seq, minute, song_id, kind, origin, seconds_into_song, prev_song_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const addDecision = db.prepare(`
    INSERT OR IGNORE INTO autoplay_decisions
      (session_id, seq, minute, policy, pool_size, propensity, picked_song_id, prev_song_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const outcomeCounts = db.prepare(`
    SELECT origin, kind, COUNT(*) AS count
    FROM listen_events
    WHERE minute >= ? AND kind IN ('Play', 'Finish', 'Skip')
    GROUP BY origin, kind
  `)
  const skipSeconds = db.prepare(`
    SELECT origin, seconds_into_song AS secondsIntoSong
    FROM listen_events
    WHERE minute >= ? AND kind = 'Skip'
  `)
  const transitions = db.prepare(`
    SELECT prev_song_id AS prevSongId, song_id AS songId,
           SUM(kind = 'Play') AS plays,
           SUM(kind = 'Finish') AS finishes,
           SUM(kind = 'Skip') AS skips
    FROM listen_events
    WHERE minute >= ? AND prev_song_id IS NOT NULL
      AND kind IN ('Play', 'Finish', 'Skip')
    GROUP BY prev_song_id, song_id
    HAVING plays >= ?
    ORDER BY plays DESC, prev_song_id, song_id
    LIMIT ?
  `)
  const eventPage = db.prepare(`
    SELECT session_id AS sessionId, seq, minute, song_id AS songId, kind, origin,
           seconds_into_song AS secondsIntoSong, prev_song_id AS prevSongId
    FROM listen_events
    WHERE minute >= ? AND (session_id, seq) > (?, ?)
    ORDER BY session_id, seq
    LIMIT ?
  `)
  const decisionPage = db.prepare(`
    SELECT session_id AS sessionId, seq, minute, policy, pool_size AS poolSize,
           propensity, picked_song_id AS pickedSongId, prev_song_id AS prevSongId
    FROM autoplay_decisions
    WHERE minute >= ? AND (session_id, seq) > (?, ?)
    ORDER BY session_id, seq
    LIMIT ?
  `)
  const pruneEvents = db.prepare('DELETE FROM listen_events WHERE minute < ?')
  const pruneDecisions = db.prepare(
    'DELETE FROM autoplay_decisions WHERE minute < ?',
  )
  return {
    addEventIfNew: (event: TrailEvent, minute: string): boolean =>
      Number(
        addEvent.run(
          event.trail.sessionId,
          event.trail.seq,
          minute,
          event.songId,
          event.kind,
          event.origin,
          event.secondsIntoSong,
          event.trail.prevSongId,
        ).changes,
      ) > 0,
    addDecision: (decision: Decision, minute: string) => {
      addDecision.run(
        decision.sessionId,
        decision.seq,
        minute,
        decision.policy,
        decision.poolSize,
        (POLICY_PROPENSITY[decision.policy] as (poolSize: number) => number)(
          decision.poolSize,
        ),
        decision.songId,
        decision.prevSongId,
      )
    },
    prune: (cutoffMinute: string) =>
      Number(pruneEvents.run(cutoffMinute).changes) +
      Number(pruneDecisions.run(cutoffMinute).changes),
    outcomeCountsSince: (minute: string) =>
      outcomeCounts.all(minute) as unknown as OutcomeCount[],
    skipSecondsSince: (minute: string) =>
      skipSeconds.all(minute) as unknown as OriginSkip[],
    transitionsSince: (minute: string) =>
      transitions.all(
        minute,
        MIN_TRANSITION_PLAYS,
        MAX_TRANSITIONS,
      ) as unknown as TransitionRow[],
    eventsAfter: (
      minute: string,
      after: Readonly<{ sessionId: string; seq: number }>,
    ) =>
      eventPage.all(
        minute,
        after.sessionId,
        after.seq,
        EXPORT_PAGE_SIZE,
      ) as unknown as EventRow[],
    decisionsAfter: (
      minute: string,
      after: Readonly<{ sessionId: string; seq: number }>,
    ) =>
      decisionPage.all(
        minute,
        after.sessionId,
        after.seq,
        EXPORT_PAGE_SIZE,
      ) as unknown as DecisionRow[],
  }
}
