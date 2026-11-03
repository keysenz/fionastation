import {
  type LrclibTrack,
  type SearchPlan,
  isExactSyncedTitle,
  normalizeTitle,
} from './lyricsMatch.ts'

const LRCLIB = 'https://lrclib.net/api'
const REQUEST_TIMEOUT_MS = 8_000

const USER_AGENT =
  'fionastation (https://github.com/keysenz/fionastation, synced lyrics for a fan radio page)'

const RETRY_DELAYS_MS = [400, 1_200]

const MAX_BUSY_WAIT_SECONDS = 3

export type LrclibFailure =
  | Readonly<{ kind: 'RateLimited'; retryAfterSeconds?: number | undefined }>
  | Readonly<{ kind: 'Transient'; retryAfterSeconds?: number | undefined }>
  | Readonly<{ kind: 'Rejected' }>

export class LrclibUnavailable extends Error {
  readonly failure: LrclibFailure

  constructor(message: string, failure: LrclibFailure = { kind: 'Transient' }) {
    super(message)
    this.failure = failure
  }
}

export type StatusClass =
  | 'Ok'
  | 'Miss'
  | 'RateLimited'
  | 'Transient'
  | 'Rejected'

export const classifyStatus = (status: number): StatusClass => {
  if (status >= 200 && status < 300) return 'Ok'
  if (status === 404) return 'Miss'
  if (status === 429) return 'RateLimited'
  return status >= 500 ? 'Transient' : 'Rejected'
}

export const parseRetryAfterSeconds = (
  header: string | null,
): number | undefined => {
  const seconds = header === null ? NaN : Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

const toTrack = (value: unknown): LrclibTrack | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const field = (key: string): unknown => Reflect.get(value, key)
  const id = field('id')
  const trackName = field('trackName')
  const artistName = field('artistName')
  const duration = field('duration')
  const instrumental = field('instrumental')
  const syncedLyrics = field('syncedLyrics')
  if (
    typeof id !== 'number' ||
    typeof trackName !== 'string' ||
    typeof artistName !== 'string' ||
    typeof duration !== 'number' ||
    typeof instrumental !== 'boolean'
  ) {
    return undefined
  }
  return {
    id,
    trackName,
    artistName,
    duration,
    instrumental,
    syncedLyrics: typeof syncedLyrics === 'string' ? syncedLyrics : null,
  }
}

async function attempt(path: string, expectArray: boolean): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${LRCLIB}${path}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new LrclibUnavailable('LRCLIB did not answer')
  }
  const status = classifyStatus(response.status)
  if (status === 'Ok') {
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new LrclibUnavailable('LRCLIB sent something unreadable')
    }
    // NOTE: under rate limiting LRCLIB has answered 200 with an object instead of an array.
    if (expectArray && !Array.isArray(body)) {
      throw new LrclibUnavailable('LRCLIB sent a non-array search result')
    }
    return body
  }
  await response.body?.cancel()
  if (status === 'Miss') return undefined
  if (status === 'RateLimited') {
    throw new LrclibUnavailable('LRCLIB answered 429', {
      kind: 'RateLimited',
      retryAfterSeconds: parseRetryAfterSeconds(
        response.headers.get('Retry-After'),
      ),
    })
  }
  throw new LrclibUnavailable(
    `LRCLIB answered ${response.status}`,
    status === 'Transient'
      ? {
          kind: 'Transient',
          retryAfterSeconds:
            response.status === 503
              ? parseRetryAfterSeconds(response.headers.get('Retry-After'))
              : undefined,
        }
      : { kind: 'Rejected' },
  )
}

const retryDelayMs = (error: unknown, tries: number): number | undefined => {
  if (!(error instanceof LrclibUnavailable)) return undefined
  const { failure } = error
  if (failure.kind !== 'Transient') return undefined
  const fixed = RETRY_DELAYS_MS[tries]
  if (fixed === undefined) return undefined
  return failure.retryAfterSeconds === undefined
    ? fixed
    : Math.min(failure.retryAfterSeconds, MAX_BUSY_WAIT_SECONDS) * 1000
}

async function request(path: string, expectArray = false): Promise<unknown> {
  for (let tries = 0; ; tries++) {
    try {
      return await attempt(path, expectArray)
    } catch (error) {
      const delay = retryDelayMs(error, tries)
      if (delay === undefined) throw error
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}

async function searchOnce(query: URLSearchParams): Promise<LrclibTrack[]> {
  const body = await request(`/search?${query}`, true)
  if (!Array.isArray(body)) return []
  return body.flatMap(item => toTrack(item) ?? [])
}

const hasExactSyncedTitle = (
  title: string,
  tracks: ReadonlyArray<LrclibTrack>,
): boolean => {
  const key = normalizeTitle(title)
  return tracks.some(track => isExactSyncedTitle(track, key))
}

export async function searchTracks(plan: SearchPlan): Promise<LrclibTrack[]> {
  const byName = new URLSearchParams({ track_name: plan.title })
  if (plan.artist !== undefined) byName.set('artist_name', plan.artist)
  const first = await searchOnce(byName)
  if (hasExactSyncedTitle(plan.title, first)) return first
  const free = new URLSearchParams({
    q: plan.artist === undefined ? plan.title : `${plan.title} ${plan.artist}`,
  })
  const second = await searchOnce(free)
  const seen = new Set(first.map(track => track.id))
  return [...first, ...second.filter(track => !seen.has(track.id))]
}

export async function getTrack(id: number): Promise<LrclibTrack | undefined> {
  return toTrack(await request(`/get/${id}`))
}
