//   node server/lyricsAudit.ts [--from <get-karaoke.json path or url>] > audit.tsv
//   node server/lyricsAudit.ts "Title" ["Artist"]   one title: candidates and a paste-ready fix
// Reads the database named by DATABASE_PATH unless --from is given.
import { readFileSync } from 'node:fs'

import type { KaraokeVideoJson } from '../src/domain.ts'
import { LrclibUnavailable, searchTracks } from './lrclib.ts'
import {
  type LrclibTrack,
  type Overrides,
  type SearchPlan,
  type SongForLyrics,
  judgeCandidates,
  normalizeTitle,
  parseOverrides,
  planLookup,
} from './lyricsMatch.ts'

const PAUSE_MS = 1_000
const RETRY_PAUSE_MS = 5_000
const MAX_ATTEMPTS = 3

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const loadOverrides = (): Overrides =>
  parseOverrides(
    JSON.parse(
      readFileSync(new URL('./lyrics-overrides.json', import.meta.url), 'utf8'),
    ),
  )

async function loadVideos(
  from: string | undefined,
): Promise<KaraokeVideoJson[]> {
  if (from === undefined) {
    const { listKaraokeVideos } = await import('./db.ts')
    return listKaraokeVideos().map(video => ({ ...video, is_gone: false }))
  }
  const text = /^https?:\/\//u.test(from)
    ? await (await fetch(from)).text()
    : readFileSync(from, 'utf8')
  return JSON.parse(text)
}

const songsOf = (videos: ReadonlyArray<KaraokeVideoJson>): SongForLyrics[] =>
  videos.flatMap(video =>
    video.karaoke_song.map(song => ({
      id: song.id,
      title: song.song_title,
      videoTitle: video.video_title,
      kind: video.kind,
    })),
  )

async function searchWithRetry(plan: SearchPlan): Promise<LrclibTrack[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await searchTracks(plan)
    } catch (error) {
      if (!(error instanceof LrclibUnavailable) || attempt === MAX_ATTEMPTS) {
        throw error
      }
      console.error(`LRCLIB unavailable (${error.message}), pausing 5 s`)
      await sleep(RETRY_PAUSE_MS)
    }
  }
}

const artistCounts = (
  tracks: ReadonlyArray<LrclibTrack>,
  title: string,
): string => {
  const key = normalizeTitle(title)
  const counts = new Map<string, number>()
  for (const track of tracks) {
    if (track.syncedLyrics === null || normalizeTitle(track.trackName) !== key)
      continue
    counts.set(track.artistName, (counts.get(track.artistName) ?? 0) + 1)
  }
  return [...counts]
    .toSorted((a, b) => b[1] - a[1])
    .map(([artist, count]) => `${artist} x${count}`)
    .join('; ')
}

const cell = (value: string | number): string =>
  String(value).replace(/[\t\r\n]+/gu, ' ')

async function auditAll(from: string | undefined): Promise<void> {
  const overrides = loadOverrides()
  const byTitle = new Map<string, SongForLyrics>()
  for (const song of songsOf(await loadVideos(from))) {
    const key = normalizeTitle(song.title)
    const known = byTitle.get(key)
    if (!known || (known.kind === 'karaoke' && song.kind !== 'karaoke')) {
      byTitle.set(key, song)
    }
  }
  const tally = new Map<string, number>()
  console.log(
    [
      'title',
      'verdict',
      'artist_hint',
      'picked_artist',
      'picked_id',
      'candidate_artists',
      'kind',
      'song_id',
    ].join('\t'),
  )
  for (const [key, song] of byTitle) {
    const { plan } = planLookup(song, overrides)
    let verdict = 'Hidden'
    let pickedArtist = ''
    let pickedId = ''
    let candidates = ''
    if (plan.kind === 'ById') {
      verdict = 'Picked'
      pickedId = String(plan.lrclibId)
      candidates = 'override by id'
    } else if (plan.kind === 'Search') {
      try {
        const tracks = await searchWithRetry(plan)
        const judged = judgeCandidates(plan, tracks)
        if (judged.kind === 'Picked') {
          verdict = 'Picked'
          pickedArtist = judged.track.artistName
          pickedId = String(judged.track.id)
        } else {
          verdict = judged.reason
        }
        candidates = artistCounts(tracks, plan.title)
      } catch (error) {
        verdict = 'Error'
        candidates = error instanceof Error ? error.message : String(error)
      }
      await sleep(PAUSE_MS)
    }
    tally.set(verdict, (tally.get(verdict) ?? 0) + 1)
    console.log(
      [
        key,
        verdict,
        plan.kind === 'Search' ? (plan.artist ?? '') : '',
        pickedArtist,
        pickedId,
        candidates,
        song.kind,
        song.id,
      ]
        .map(cell)
        .join('\t'),
    )
  }
  console.error(
    `${byTitle.size} titles: ${[...tally].map(([verdict, count]) => `${verdict} ${count}`).join(', ')}`,
  )
}

async function auditOne(
  title: string,
  artist: string | undefined,
): Promise<void> {
  const plan: SearchPlan = {
    kind: 'Search',
    title,
    ...(artist === undefined ? {} : { artist }),
    isArtistTrusted: artist !== undefined,
  }
  const tracks = await searchWithRetry(plan)
  const key = normalizeTitle(title)
  for (const track of tracks) {
    const isExact = normalizeTitle(track.trackName) === key
    console.log(
      [
        track.id,
        track.artistName,
        track.trackName,
        `${Math.round(track.duration)}s`,
        track.syncedLyrics === null ? 'plain only' : 'synced',
        isExact ? 'exact' : '',
      ].join('\t'),
    )
  }
  const verdict = judgeCandidates(plan, tracks)
  console.log(
    verdict.kind === 'Picked'
      ? `verdict: Picked ${verdict.track.id} (${verdict.track.artistName})`
      : `verdict: ${verdict.reason}`,
  )
  console.log(
    `paste into titles: ${JSON.stringify(key)}: { "lrclibId": <id from above> }`,
  )
}

const args = process.argv.slice(2)
const fromIndex = args.indexOf('--from')
const from = fromIndex === -1 ? undefined : args[fromIndex + 1]
const positional = args.filter(
  (arg, index) =>
    !arg.startsWith('--') && (fromIndex === -1 || index !== fromIndex + 1),
)
const [title, artist] = positional

if (title === undefined) {
  await auditAll(from)
} else {
  await auditOne(title, artist)
}
