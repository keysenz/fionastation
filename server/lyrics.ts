import { existsSync, readFileSync } from 'node:fs'

import type { Lyrics } from '../src/lyrics.ts'
import { LrclibUnavailable, getTrack, searchTracks } from './lrclib.ts'
import {
  type LocalLyrics,
  localLyricsFor,
  loadLocalLyrics,
} from './localLyrics.ts'
import {
  type Alignments,
  type LookupPlan,
  type LrclibTrack,
  type Overrides,
  type SongForLyrics,
  type Verdict,
  isExactSyncedTitle,
  judgeCandidates,
  noAlignments,
  normalizeTitle,
  parseAlignments,
  parseOverrides,
  planKey,
  planLookup,
  toLyrics,
  verdictForChosenTrack,
  withAlignment,
} from './lyricsMatch.ts'

export type LyricsLookup =
  | Readonly<{ kind: 'Answered'; lyrics: Lyrics }>
  | Readonly<{ kind: 'Unavailable' }>

const MAX_IN_FLIGHT = 2
const DEFAULT_PAUSE_MS = 60_000
const CACHE_TTL_MS = 24 * 3600_000

export function loadOverrides(path: string): Overrides {
  try {
    return parseOverrides(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid lyrics overrides in ${path}: ${reason}`, {
      cause: error,
    })
  }
}

export function loadAlignments(path: string): Alignments {
  if (!existsSync(path)) return noAlignments
  try {
    return parseAlignments(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid lyrics alignments in ${path}: ${reason}`, {
      cause: error,
    })
  }
}

export function warnAboutUnknownSongs(
  overrides: Overrides,
  knownSongIds: ReadonlySet<string>,
): void {
  for (const id of overrides.songs.keys()) {
    if (!knownSongIds.has(id)) {
      console.warn(`lyrics-overrides.json: no song with id ${id}`)
    }
  }
}

export { loadLocalLyrics }

type Cached = Readonly<{
  tracks: ReadonlyArray<LrclibTrack>
  expiresAt: number
}>

const cache = new Map<string, Cached>()
const inFlight = new Map<string, Promise<ReadonlyArray<LrclibTrack>>>()
const waiting: Array<() => void> = []
let running = 0
let pausedUntil = 0

async function withSlot<A>(work: () => Promise<A>): Promise<A> {
  if (running >= MAX_IN_FLIGHT) {
    await new Promise<void>(resolve => waiting.push(resolve))
  } else {
    running++
  }
  try {
    return await work()
  } finally {
    const next = waiting.shift()
    if (next) {
      next()
    } else {
      running--
    }
  }
}

const notFound: Verdict = { kind: 'Missing', reason: 'NotFound' }

const isPaused = () => Date.now() < pausedUntil

async function fetchTracks(
  plan: LookupPlan,
): Promise<ReadonlyArray<LrclibTrack>> {
  if (plan.kind === 'ById') {
    const track = await getTrack(plan.lrclibId)
    return track ? [track] : []
  }
  if (plan.kind === 'Search') {
    const key = normalizeTitle(plan.title)
    const tracks = await searchTracks(plan)
    return tracks.filter(track => isExactSyncedTitle(track, key))
  }
  return []
}

export const pauseMsFor = (error: LrclibUnavailable): number | undefined =>
  error.failure.kind === 'RateLimited'
    ? (error.failure.retryAfterSeconds ?? DEFAULT_PAUSE_MS / 1000) * 1000
    : undefined

async function tracksFor(
  plan: LookupPlan,
): Promise<ReadonlyArray<LrclibTrack>> {
  const key = planKey(plan)
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.tracks
  const pending = inFlight.get(key)
  if (pending) return pending
  if (isPaused()) throw new LrclibUnavailable('paused after a rate limit')

  const request = withSlot(async () => {
    if (isPaused()) throw new LrclibUnavailable('paused after a rate limit')
    try {
      const tracks = await fetchTracks(plan)
      cache.set(key, { tracks, expiresAt: Date.now() + CACHE_TTL_MS })
      return tracks
    } catch (error) {
      if (error instanceof LrclibUnavailable) {
        const pauseMs = pauseMsFor(error)
        if (pauseMs !== undefined) {
          pausedUntil = Date.now() + pauseMs
          console.warn(
            `LRCLIB paused for ${pauseMs / 1000} s: ${error.message}`,
          )
        }
      }
      throw error
    }
  })
  inFlight.set(key, request)
  try {
    return await request
  } finally {
    inFlight.delete(key)
  }
}

export async function lookupLyrics(
  song: SongForLyrics,
  overrides: Overrides,
  alignments: Alignments,
  local: LocalLyrics,
): Promise<LyricsLookup> {
  const { plan, offsetMs, ignoredSongFix } = planLookup(song, overrides)
  if (ignoredSongFix) {
    console.warn(
      `lyrics-overrides.json: ignoring the fix for song ${song.id}, its title is now "${song.title}"`,
    )
  }
  if (plan.kind === 'Hide') {
    return { kind: 'Answered', lyrics: { _tag: 'Missing', reason: 'Hidden' } }
  }
  const localLyrics = localLyricsFor(
    song,
    local.get(song.id),
    alignments.get(song.id),
    offsetMs,
  )
  if (localLyrics !== undefined) {
    return { kind: 'Answered', lyrics: localLyrics }
  }
  try {
    const tracks = await tracksFor(plan)
    const [chosen] = tracks
    const verdict =
      plan.kind === 'ById'
        ? chosen
          ? verdictForChosenTrack(chosen)
          : notFound
        : judgeCandidates(plan, tracks, song.spanSeconds)
    return {
      kind: 'Answered',
      lyrics: toLyrics(
        withAlignment(verdict, song, alignments.get(song.id)),
        offsetMs,
      ),
    }
  } catch (error) {
    if (error instanceof LrclibUnavailable) return { kind: 'Unavailable' }
    throw error
  }
}
