import type { VideoKind } from '../src/domain.ts'
import type { LyricLine, Lyrics, MissingReason } from '../src/lyrics.ts'

export type SongForLyrics = Readonly<{
  id: string
  title: string
  videoTitle: string
  kind: VideoKind
  /** Seconds from this song's timestamp to the next one in its video. Unknown for the last song. */
  spanSeconds?: number
}>

type FixMatch =
  | Readonly<{ lrclibId: number }>
  | Readonly<{ artist: string }>
  | Readonly<{ hide: true }>

export type LyricsFix = Readonly<{
  match?: FixMatch
  offsetSeconds?: number
  note?: string
}>

export type SongFix = LyricsFix & Readonly<{ songTitle: string }>

export type Overrides = Readonly<{
  titles: ReadonlyMap<string, LyricsFix>
  songs: ReadonlyMap<string, SongFix>
}>

export const noOverrides: Overrides = { titles: new Map(), songs: new Map() }

export type LrclibTrack = Readonly<{
  id: number
  trackName: string
  artistName: string
  duration: number
  instrumental: boolean
  syncedLyrics: string | null
}>

export type LookupPlan =
  | Readonly<{ kind: 'Hide' }>
  | Readonly<{ kind: 'ById'; lrclibId: number }>
  | Readonly<{
      kind: 'Search'
      title: string
      artist?: string
      isArtistTrusted: boolean
    }>

export type SearchPlan = Extract<LookupPlan, { kind: 'Search' }>

type SyncedLines = Extract<Lyrics, { _tag: 'Synced' }>['lines']

export type Verdict =
  | Readonly<{ kind: 'Picked'; track: LrclibTrack; lines: SyncedLines }>
  | Readonly<{
      kind: 'Missing'
      reason: Exclude<MissingReason, 'Hidden'>
    }>

const MIN_LINES = 8
const LAST_LINE_SLACK = 1.25
const DURATION_SLACK_SECONDS = 15
const MIN_CONTAINMENT_LENGTH = 3

const VERSION_WORDS =
  'remaster(?:ed)?|live|ver(?:sion)?\\.?|mix|edit|feat\\.?|ft\\.?|acoustic|mono|stereo|deluxe|bonus|tv size|full|inst(?:rumental)?|\\d{4}'
const VERSION_BRACKET = new RegExp(
  `[(\\[【][^)\\]】]*\\b(?:${VERSION_WORDS})[^)\\]】]*[)\\]】]`,
  'giu',
)
const VERSION_DASH_SUFFIX =
  /\s[-–]\s.*\b(?:remaster(?:ed)?|live|version|ver\.|mix|edit)\b.*$/iu

/** NFKC, lowercase, drop version brackets and " - ... remaster" suffixes, collapse punctuation and space. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(VERSION_BRACKET, ' ')
    .replace(VERSION_DASH_SUFFIX, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const normalizeArtist = (artist: string): string =>
  normalizeTitle(artist.replace(/\s-\s*topic$/iu, ''))

const NOISE_SEGMENT =
  /\b(?:cover|fiona|clearesta|fioyow|fioyoyow|fio|vtuber|ft|feat)\b/iu

/** Covers and originals only. Splits the video title around " - ", " / " or " | ", drops the side that
 *  holds the song title, and returns the one remaining side that is not credit noise. */
export function artistHintOf(song: SongForLyrics): string | undefined {
  if (song.kind === 'karaoke') return undefined
  const songKey = normalizeTitle(song.title)
  if (songKey === '') return undefined
  const cleaned = song.videoTitle
    .replace(/#\S+/gu, ' ')
    .replace(/【[^】]*】/gu, ' ')
    .replace(/\bshort cover\b.*$/iu, ' ')
    .replace(/\bcover by\b.*$/iu, ' ')
    .replace(/\([^)]*\b(?:by|cover)\b[^)]*\)/giu, ' ')
    .replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, ' ')
  const sides = cleaned
    .split(/\s[-–/|]\s/u)
    .map(side => side.trim())
    .filter(side => side !== '')
  const songSide = sides.findIndex(side =>
    normalizeTitle(side).includes(songKey),
  )
  if (songSide === -1) return undefined
  const others = sides.filter(
    (side, index) => index !== songSide && !NOISE_SEGMENT.test(side),
  )
  const [only] = others
  return others.length === 1 && only !== undefined ? only : undefined
}

const addSeconds = (a: number | undefined, b: number | undefined): number =>
  (a ?? 0) + (b ?? 0)

/** A song fix beats a title fix for the match. Offsets add. A song fix whose
 *  title guard no longer matches is ignored and reported through `ignoredSongFix`. */
export function planLookup(
  song: SongForLyrics,
  overrides: Overrides,
): { plan: LookupPlan; offsetMs: number; ignoredSongFix: boolean } {
  const titleKey = normalizeTitle(song.title)
  const rawSongFix = overrides.songs.get(song.id)
  const ignoredSongFix =
    rawSongFix !== undefined &&
    normalizeTitle(rawSongFix.songTitle) !== titleKey
  const songFix = ignoredSongFix ? undefined : rawSongFix
  const titleFix = overrides.titles.get(titleKey)
  const match = songFix?.match ?? titleFix?.match
  const offsetMs = Math.round(
    addSeconds(songFix?.offsetSeconds, titleFix?.offsetSeconds) * 1000,
  )

  const plan = ((): LookupPlan => {
    if (match && 'hide' in match) return { kind: 'Hide' }
    if (match && 'lrclibId' in match) {
      return { kind: 'ById', lrclibId: match.lrclibId }
    }
    if (match) {
      return {
        kind: 'Search',
        title: song.title,
        artist: match.artist,
        isArtistTrusted: true,
      }
    }
    const hint = artistHintOf(song)
    return hint === undefined
      ? { kind: 'Search', title: song.title, isArtistTrusted: false }
      : {
          kind: 'Search',
          title: song.title,
          artist: hint,
          isArtistTrusted: false,
        }
  })()
  return { plan, offsetMs, ignoredSongFix }
}

/** Stable cache key for a plan, shared by every occurrence of a title. */
export function planKey(plan: LookupPlan): string {
  switch (plan.kind) {
    case 'Hide':
      return 'hide'
    case 'ById':
      return `id:${plan.lrclibId}`
    case 'Search':
      return `search:${normalizeTitle(plan.title)}|${normalizeArtist(plan.artist ?? '')}`
  }
}

const LRC_STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/gu

/** Multi-stamp lines, metadata tags ignored, sorted by time, empty text kept. */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const row of text.split(/\r?\n/u)) {
    const stamps = [...row.matchAll(LRC_STAMP)]
    const first = stamps[0]
    if (first?.index !== 0) continue
    const last = stamps[stamps.length - 1]
    if (!last) continue
    const rest = row.slice((last.index ?? 0) + last[0].length).trim()
    for (const [, minutes, seconds, fraction] of stamps) {
      const atMs = Math.round(
        (Number(minutes) * 60 + Number(seconds)) * 1000 +
          (fraction === undefined ? 0 : Number(`0.${fraction}`) * 1000),
      )
      lines.push({ atMs, text: rest })
    }
  }
  return lines.sort((a, b) => a.atMs - b.atMs)
}

const isNonEmpty = <A>(items: ReadonlyArray<A>): items is [A, ...A[]] =>
  items.length > 0

type Candidate = Readonly<{
  track: LrclibTrack
  lines: SyncedLines
  artistKey: string
}>

const toCandidate = (
  track: LrclibTrack,
  spanSeconds: number | undefined,
): Candidate | undefined => {
  if (track.instrumental || !track.syncedLyrics) return undefined
  if (
    spanSeconds !== undefined &&
    track.duration > spanSeconds + DURATION_SLACK_SECONDS
  ) {
    return undefined
  }
  const lines = parseLrc(track.syncedLyrics)
  const last = lines[lines.length - 1]
  if (!isNonEmpty(lines) || lines.length < MIN_LINES || !last) return undefined
  if (
    track.duration > 0 &&
    last.atMs > track.duration * 1000 * LAST_LINE_SLACK
  ) {
    return undefined
  }
  return { track, lines, artistKey: normalizeArtist(track.artistName) }
}

const isRelated = (a: string, b: string): boolean =>
  a === b ||
  (Math.min(a.length, b.length) >= MIN_CONTAINMENT_LENGTH &&
    (a.includes(b) || b.includes(a)))

const groupByArtist = (candidates: ReadonlyArray<Candidate>): Candidate[][] => {
  const groups: Candidate[][] = []
  for (const candidate of candidates) {
    const related = groups.filter(group =>
      group.some(member => isRelated(member.artistKey, candidate.artistKey)),
    )
    const merged = [candidate, ...related.flat()]
    for (const group of related) groups.splice(groups.indexOf(group), 1)
    groups.push(merged)
  }
  return groups
}

const medianCandidate = (
  group: ReadonlyArray<Candidate>,
): Candidate | undefined =>
  group.toSorted(
    (a, b) => a.track.duration - b.track.duration || a.track.id - b.track.id,
  )[Math.floor((group.length - 1) / 2)]

const picked = (group: ReadonlyArray<Candidate>): Verdict => {
  const winner = medianCandidate(group)
  return winner
    ? { kind: 'Picked', track: winner.track, lines: winner.lines }
    : { kind: 'Missing', reason: 'NotFound' }
}

/** A track a maintainer named by id. It skips the title and artist checks, and keeps only the lines check. */
export function verdictForChosenTrack(track: LrclibTrack): Verdict {
  const lines = track.syncedLyrics ? parseLrc(track.syncedLyrics) : []
  return isNonEmpty(lines)
    ? { kind: 'Picked', track, lines }
    : { kind: 'Missing', reason: 'NotFound' }
}

const UNSURE: Verdict = { kind: 'Missing', reason: 'Unsure' }
const NOT_FOUND: Verdict = { kind: 'Missing', reason: 'NotFound' }

/** The refusal rule. Needs an exact title with synced lyrics that pass the sanity checks. With an
 *  artist, only that artist's tracks count. Without one, exactly one artist must hold at least two
 *  entries, so a lone wrong-artist entry never wins. `spanSeconds` vetoes tracks too long for the
 *  song's slot in its stream. */
export function judgeCandidates(
  plan: SearchPlan,
  tracks: ReadonlyArray<LrclibTrack>,
  spanSeconds?: number,
): Verdict {
  const titleKey = normalizeTitle(plan.title)
  const candidates = tracks
    .filter(track => normalizeTitle(track.trackName) === titleKey)
    .flatMap(track => toCandidate(track, spanSeconds) ?? [])
  if (candidates.length === 0) return NOT_FOUND

  const artistKey =
    plan.artist === undefined ? '' : normalizeArtist(plan.artist)
  if (artistKey !== '') {
    const byArtist = candidates.filter(candidate =>
      candidate.artistKey.includes(artistKey),
    )
    if (byArtist.length > 0) return picked(byArtist)
    if (plan.isArtistTrusted) return NOT_FOUND
  }

  const groups = groupByArtist(candidates)
  const [only] = groups
  return groups.length === 1 && only !== undefined && only.length >= 2
    ? picked(only)
    : UNSURE
}

export function toLyrics(verdict: Verdict, offsetMs: number): Lyrics {
  if (verdict.kind === 'Missing') {
    return { _tag: 'Missing', reason: verdict.reason }
  }
  return {
    _tag: 'Synced',
    lines: verdict.lines,
    offsetMs,
    credit: {
      lrclibId: verdict.track.id,
      track: verdict.track.trackName,
      artist: verdict.track.artistName,
    },
  }
}

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseFix = (value: unknown, path: string): LyricsFix => {
  if (!isRecord(value)) throw new Error(`${path}: expected an object`)
  const known = new Set([
    'lrclibId',
    'artist',
    'hide',
    'offsetSeconds',
    'note',
    'songTitle',
  ])
  for (const key of Object.keys(value)) {
    if (!known.has(key)) throw new Error(`${path}.${key}: unknown field`)
  }
  const { lrclibId, artist, hide, offsetSeconds, note } = value
  const matches = [lrclibId, artist, hide].filter(item => item !== undefined)
  if (matches.length > 1) {
    throw new Error(`${path}: give only one of lrclibId, artist or hide`)
  }
  if (offsetSeconds !== undefined && !Number.isFinite(offsetSeconds)) {
    throw new Error(`${path}.offsetSeconds: expected a number`)
  }
  if (note !== undefined && typeof note !== 'string') {
    throw new Error(`${path}.note: expected a string`)
  }
  const match = ((): FixMatch | undefined => {
    if (lrclibId !== undefined) {
      if (typeof lrclibId !== 'number' || !Number.isSafeInteger(lrclibId)) {
        throw new Error(`${path}.lrclibId: expected an integer`)
      }
      return { lrclibId }
    }
    if (artist !== undefined) {
      if (typeof artist !== 'string' || artist.trim() === '') {
        throw new Error(`${path}.artist: expected a non-empty string`)
      }
      return { artist }
    }
    if (hide !== undefined) {
      if (hide !== true) throw new Error(`${path}.hide: expected true`)
      return { hide }
    }
    return undefined
  })()
  return {
    ...(match ? { match } : {}),
    ...(typeof offsetSeconds === 'number' ? { offsetSeconds } : {}),
    ...(typeof note === 'string' ? { note } : {}),
  }
}

/** Throws with a JSON path on the first problem, including title keys that are not already normalized. */
export function parseOverrides(json: unknown): Overrides {
  if (!isRecord(json)) throw new Error('$: expected an object')
  for (const key of Object.keys(json)) {
    if (key !== 'titles' && key !== 'songs') {
      throw new Error(`$.${key}: unknown section`)
    }
  }
  const titles = new Map<string, LyricsFix>()
  const titlesJson = json.titles ?? {}
  if (!isRecord(titlesJson)) throw new Error('$.titles: expected an object')
  for (const [key, value] of Object.entries(titlesJson)) {
    const path = `$.titles[${JSON.stringify(key)}]`
    if (key === '' || normalizeTitle(key) !== key) {
      throw new Error(
        `${path}: key must be normalized, use ${JSON.stringify(normalizeTitle(key))}`,
      )
    }
    if (isRecord(value) && 'songTitle' in value) {
      throw new Error(`${path}.songTitle: only song fixes take a songTitle`)
    }
    titles.set(key, parseFix(value, path))
  }
  const songs = new Map<string, SongFix>()
  const songsJson = json.songs ?? {}
  if (!isRecord(songsJson)) throw new Error('$.songs: expected an object')
  for (const [id, value] of Object.entries(songsJson)) {
    const path = `$.songs[${JSON.stringify(id)}]`
    const songTitle = isRecord(value) ? value.songTitle : undefined
    if (typeof songTitle !== 'string' || normalizeTitle(songTitle) === '') {
      throw new Error(`${path}.songTitle: required, the song's title`)
    }
    songs.set(id, { ...parseFix(value, path), songTitle })
  }
  return { titles, songs }
}
