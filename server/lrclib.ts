import {
  type LrclibTrack,
  type SearchPlan,
  normalizeTitle,
} from './lyricsMatch.ts'

const LRCLIB = 'https://lrclib.net/api'
const REQUEST_TIMEOUT_MS = 8_000

const USER_AGENT =
  'fionastation (https://github.com/keysenz/fionastation, synced lyrics for a fan radio page)'

/** LRCLIB is rate limiting, failing or slow. The caller backs off and does not cache. */
export class LrclibUnavailable extends Error {}

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

async function request(path: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${LRCLIB}${path}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new LrclibUnavailable('LRCLIB did not answer')
  }
  if (response.status === 404) {
    await response.body?.cancel()
    return undefined
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new LrclibUnavailable(`LRCLIB answered ${response.status}`)
  }
  try {
    return await response.json()
  } catch {
    throw new LrclibUnavailable('LRCLIB sent something unreadable')
  }
}

async function searchOnce(query: URLSearchParams): Promise<LrclibTrack[]> {
  const body = await request(`/search?${query}`)
  // NOTE: under rate limiting LRCLIB has answered 200 with an object instead of an array.
  if (!Array.isArray(body)) {
    throw new LrclibUnavailable('LRCLIB sent a non-array search result')
  }
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
