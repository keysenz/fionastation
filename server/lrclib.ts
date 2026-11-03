import {
  type LrclibTrack,
  type SearchPlan,
  normalizeTitle,
} from './lyricsMatch.ts'

const LRCLIB = 'https://lrclib.net/api'
const REQUEST_TIMEOUT_MS = 8_000

const USER_AGENT =
  'fionastation (https://github.com/keysenz/fionastation, synced lyrics for a fan radio page)'

const RETRY_DELAYS_MS = [400, 1_200]

/** LRCLIB is rate limiting, failing or slow. The caller does not cache. Only a rate limit
 *  carries `retryAfterSeconds`, and only a rate limit should make the caller back off. */
export class LrclibUnavailable extends Error {
  readonly isRateLimited: boolean
  readonly isRetryable: boolean
  readonly retryAfterSeconds: number | undefined

  constructor(
    message: string,
    options: {
      isRateLimited?: boolean
      isRetryable?: boolean
      retryAfterSeconds?: number | undefined
    } = {},
  ) {
    super(message)
    this.isRateLimited = options.isRateLimited ?? false
    this.isRetryable = options.isRetryable ?? true
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

export type StatusClass =
  | 'Ok'
  | 'Miss'
  | 'RateLimited'
  | 'Transient'
  | 'Rejected'

/** 5xx is LRCLIB flaking at random, so a retry is worth it. Other 4xx will not change. */
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
      isRateLimited: true,
      isRetryable: false,
      retryAfterSeconds: parseRetryAfterSeconds(
        response.headers.get('Retry-After'),
      ),
    })
  }
  throw new LrclibUnavailable(`LRCLIB answered ${response.status}`, {
    isRetryable: status === 'Transient',
  })
}

/** LRCLIB answers 503 on a random share of identical requests, so one failure says little. */
async function request(path: string, expectArray = false): Promise<unknown> {
  for (let tries = 0; ; tries++) {
    try {
      return await attempt(path, expectArray)
    } catch (error) {
      const delay = RETRY_DELAYS_MS[tries]
      if (
        !(error instanceof LrclibUnavailable) ||
        !error.isRetryable ||
        delay === undefined
      ) {
        throw error
      }
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
  return tracks.some(
    track =>
      track.syncedLyrics !== null && normalizeTitle(track.trackName) === key,
  )
}

/** Searches by track (and artist) name. Only when that finds no synced track with the exact
 *  title does it make one free-text request. At most two requests. */
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
