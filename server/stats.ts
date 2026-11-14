import { DatabaseSync } from 'node:sqlite'

import type { SongForStats } from './db.ts'
import { windowLimiter } from './playlists.ts'

export const COUNTED_KINDS = ['Click', 'Play', 'Finish'] as const
export const STAT_ORIGINS = ['Visitor', 'Autoplay'] as const
export type CountedKind = (typeof COUNTED_KINDS)[number]
export type StatOrigin = (typeof STAT_ORIGINS)[number]

export type StatEvent =
  | Readonly<{
      kind: CountedKind
      songId: string
      origin: StatOrigin
    }>
  | Readonly<{
      kind: 'Skip'
      songId: string
      origin: StatOrigin
      secondsIntoSong: number
    }>

export type StatTotal = Readonly<{
  songId: string
  kind: CountedKind
  origin: StatOrigin
  count: number
}>

export type SkipRow = Readonly<{
  songId: string
  origin: StatOrigin
  secondsIntoSong: number
}>

export type DayTotal = Readonly<{
  day: string
  kind: CountedKind | 'Skip'
  origin: StatOrigin
  count: number
}>

export type StatStore = Readonly<{
  record: (event: StatEvent) => void
  totalsSince: (firstDay: string) => StatTotal[]
  skipsSince: (firstDay: string) => SkipRow[]
  dailySince: (firstDay: string) => DayTotal[]
}>

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
export const MAX_REPORT_DAYS = 3650
export const DEFAULT_REPORT_DAYS = 30
const MAX_SONG_ID_LENGTH = 100
const MAX_SECONDS_INTO_SONG = 24 * 60 * 60

const dayOf = (date: Date) => date.toISOString().slice(0, 10)

export const openStatStore = ({
  path,
  now = () => new Date(),
}: Readonly<{ path: string; now?: () => Date }>): StatStore => {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA busy_timeout = 1000')
  db.exec(`
    CREATE TABLE IF NOT EXISTS song_stats (
      day TEXT NOT NULL,
      song_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      origin TEXT NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (day, song_id, kind, origin)
    ) WITHOUT ROWID
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS skips (
      day TEXT NOT NULL,
      song_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      seconds_into_song INTEGER NOT NULL
    )
  `)
  db.exec('CREATE INDEX IF NOT EXISTS skips_by_day ON skips (day)')
  const bump = db.prepare(`
    INSERT INTO song_stats (day, song_id, kind, origin, count)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT (day, song_id, kind, origin) DO UPDATE SET count = count + 1
  `)
  const addSkip = db.prepare(
    'INSERT INTO skips (day, song_id, origin, seconds_into_song) VALUES (?, ?, ?, ?)',
  )
  const skips = db.prepare(`
    SELECT song_id AS songId, origin, seconds_into_song AS secondsIntoSong
    FROM skips
    WHERE day >= ?
  `)
  const totals = db.prepare(`
    SELECT song_id AS songId, kind, origin, SUM(count) AS count
    FROM song_stats
    WHERE day >= ?
    GROUP BY song_id, kind, origin
  `)
  const dailyCounts = db.prepare(`
    SELECT day, kind, origin, SUM(count) AS count
    FROM song_stats
    WHERE day >= ?
    GROUP BY day, kind, origin
  `)
  const dailySkips = db.prepare(`
    SELECT day, 'Skip' AS kind, origin, COUNT(*) AS count
    FROM skips
    WHERE day >= ?
    GROUP BY day, origin
  `)
  return {
    record: event => {
      if (event.kind === 'Skip') {
        addSkip.run(
          dayOf(now()),
          event.songId,
          event.origin,
          event.secondsIntoSong,
        )
        return
      }
      bump.run(dayOf(now()), event.songId, event.kind, event.origin)
    },
    totalsSince: firstDay => totals.all(firstDay) as unknown as StatTotal[],
    skipsSince: firstDay => skips.all(firstDay) as unknown as SkipRow[],
    dailySince: firstDay =>
      [
        ...dailyCounts.all(firstDay),
        ...dailySkips.all(firstDay),
      ] as unknown as DayTotal[],
  }
}

export type StatReply = Readonly<{ status: number; body: unknown }>

const failure = (status: number, error: string): StatReply => ({
  status,
  body: { error },
})

const isOneOf = <T extends string>(
  options: readonly T[],
  value: unknown,
): value is T => options.some(option => option === value)

export const parseStatEvent = (body: string): StatEvent | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { songId, kind, origin, secondsIntoSong, ...rest } = parsed as Record<
    string,
    unknown
  >
  if (
    Object.keys(rest).length > 0 ||
    typeof songId !== 'string' ||
    songId === '' ||
    songId.length > MAX_SONG_ID_LENGTH ||
    !isOneOf(STAT_ORIGINS, origin)
  ) {
    return undefined
  }
  if (kind === 'Skip') {
    return typeof secondsIntoSong === 'number' &&
      Number.isInteger(secondsIntoSong) &&
      secondsIntoSong >= 0 &&
      secondsIntoSong <= MAX_SECONDS_INTO_SONG
      ? { kind, songId, origin, secondsIntoSong }
      : undefined
  }
  if (
    !isOneOf(COUNTED_KINDS, kind) ||
    secondsIntoSong !== undefined ||
    (kind === 'Click' && origin !== 'Visitor')
  ) {
    return undefined
  }
  return { kind, songId, origin }
}

export const createStatApi = ({
  store,
  songExists,
  now = () => new Date(),
  perIpPerHour = 600,
}: Readonly<{
  store: StatStore
  songExists: (songId: string) => boolean
  now?: () => Date
  perIpPerHour?: number
}>) => {
  const allow = windowLimiter(perIpPerHour, HOUR_MS, now)
  return (request: Readonly<{ ip: string; body: string }>): StatReply => {
    if (!allow(request.ip)) return failure(429, 'Too many requests')
    const event = parseStatEvent(request.body)
    if (!event) return failure(400, 'Not a play statistic')
    try {
      if (!songExists(event.songId)) return failure(404, 'Unknown song')
      store.record(event)
      return { status: 204, body: undefined }
    } catch (error) {
      console.error('Stats store error:', error)
      return failure(500, 'Could not record the statistic')
    }
  }
}

export type ByOrigin = Readonly<Record<StatOrigin, number>>

type Tally = Readonly<{
  clicks: number
  plays: ByOrigin
  finishes: ByOrigin
  skips: ByOrigin
}>

export type SongReport = Tally &
  Readonly<{
    songId: string
    title: string | null
    artist: string | null
    videoId: string | null
    medianSecondsIntoSkip: number | null
  }>

export type VideoReport = Tally &
  Readonly<{ videoId: string; videoTitle: string; videoUrl: string }>

const noOrigins: ByOrigin = { Visitor: 0, Autoplay: 0 }
const emptyTally: Tally = {
  clicks: 0,
  plays: noOrigins,
  finishes: noOrigins,
  skips: noOrigins,
}

const sumOrigins = (left: ByOrigin, right: ByOrigin): ByOrigin => ({
  Visitor: left.Visitor + right.Visitor,
  Autoplay: left.Autoplay + right.Autoplay,
})

const merge = (left: Tally, right: Tally): Tally => ({
  clicks: left.clicks + right.clicks,
  plays: sumOrigins(left.plays, right.plays),
  finishes: sumOrigins(left.finishes, right.finishes),
  skips: sumOrigins(left.skips, right.skips),
})

const only = (origin: StatOrigin, count: number): ByOrigin => ({
  ...noOrigins,
  [origin]: count,
})

const tallyOfTotal = ({ kind, origin, count }: StatTotal): Tally => {
  switch (kind) {
    case 'Click':
      return { ...emptyTally, clicks: count }
    case 'Play':
      return { ...emptyTally, plays: only(origin, count) }
    case 'Finish':
      return { ...emptyTally, finishes: only(origin, count) }
  }
}

const tallyOfSkip = ({ origin }: SkipRow): Tally => ({
  ...emptyTally,
  skips: only(origin, 1),
})

const medianOf = (values: readonly number[]): number | null => {
  if (values.length === 0) return null
  const sorted = values.toSorted((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
}

const mostPlayedFirst =
  <T extends Tally>(key: (report: T) => string) =>
  (left: T, right: T) =>
    right.plays.Visitor - left.plays.Visitor ||
    right.plays.Autoplay - left.plays.Autoplay ||
    right.clicks - left.clicks ||
    key(left).localeCompare(key(right))

export type DayReport = Tally & Readonly<{ day: string }>

export const SKIP_BUCKET_SECONDS = 10
export const SKIP_BUCKET_COUNT = 31

export type SkipBucket = Readonly<{
  songId: string
  bucket: number
  count: number
}>

const tallyOfDayTotal = ({ kind, origin, count }: DayTotal): Tally =>
  kind === 'Skip'
    ? { ...emptyTally, skips: only(origin, count) }
    : tallyOfTotal({ songId: '', kind, origin, count })

export const buildDailySeries = (
  rows: readonly DayTotal[],
  firstDay: string,
  lastDay: string,
): DayReport[] => {
  const byDay = Map.groupBy(rows, ({ day }) => day)
  const series: DayReport[] = []
  for (
    let time = Date.parse(firstDay);
    time <= Date.parse(lastDay);
    time += DAY_MS
  ) {
    const day = dayOf(new Date(time))
    series.push({
      day,
      ...(byDay.get(day) ?? []).map(tallyOfDayTotal).reduce(merge, emptyTally),
    })
  }
  return series
}

export const buildSkipBuckets = (skips: readonly SkipRow[]): SkipBucket[] => {
  const counts = new Map<string, number>()
  for (const { songId, secondsIntoSong } of skips) {
    const bucket = Math.min(
      Math.floor(secondsIntoSong / SKIP_BUCKET_SECONDS),
      SKIP_BUCKET_COUNT - 1,
    )
    const key = `${songId}\0${bucket}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts].map(([key, count]) => {
    const [songId = '', bucket = ''] = key.split('\0')
    return { songId, bucket: Number(bucket), count }
  })
}

export const parseReportDays = (raw: string | null): number | undefined => {
  if (raw === null) return DEFAULT_REPORT_DAYS
  if (!/^\d{1,4}$/.test(raw)) return undefined
  const days = Number(raw)
  return days >= 1 && days <= MAX_REPORT_DAYS ? days : undefined
}

export const buildStatReport = (
  totals: readonly StatTotal[],
  skips: readonly SkipRow[],
  songs: readonly SongForStats[],
) => {
  const known = new Map(songs.map(song => [song.songId, song]))
  const totalsBySong = Map.groupBy(totals, ({ songId }) => songId)
  const skipsBySong = Map.groupBy(skips, ({ songId }) => songId)
  const songIds = new Set([...totalsBySong.keys(), ...skipsBySong.keys()])
  const songReports: SongReport[] = [...songIds].map(songId => {
    const song = known.get(songId)
    const songSkips = skipsBySong.get(songId) ?? []
    return {
      songId,
      title: song?.title ?? null,
      artist: song?.artist ?? null,
      videoId: song?.videoId ?? null,
      medianSecondsIntoSkip: medianOf(
        songSkips.map(({ secondsIntoSong }) => secondsIntoSong),
      ),
      ...[
        ...(totalsBySong.get(songId) ?? []).map(tallyOfTotal),
        ...songSkips.map(tallyOfSkip),
      ].reduce(merge, emptyTally),
    }
  })
  const inVideos = songReports.flatMap(report => {
    const song = known.get(report.songId)
    return song ? [{ song, report }] : []
  })
  const videoReports = [
    ...Map.groupBy(inVideos, ({ song }) => song.videoId),
  ].flatMap(([videoId, group]): VideoReport[] => {
    const first = group[0]
    return first
      ? [
          {
            videoId,
            videoTitle: first.song.videoTitle,
            videoUrl: first.song.videoUrl,
            ...group.map(({ report }) => report).reduce(merge, emptyTally),
          },
        ]
      : []
  })
  return {
    songs: songReports.sort(mostPlayedFirst(report => report.songId)),
    videos: videoReports.sort(mostPlayedFirst(report => report.videoId)),
  }
}

export const createStatReport = ({
  store,
  findSongs,
  now = () => new Date(),
}: Readonly<{
  store: StatStore
  findSongs: (ids: readonly string[]) => readonly SongForStats[]
  now?: () => Date
}>) => {
  return (rawDays: string | null): StatReply => {
    const days = parseReportDays(rawDays)
    if (days === undefined) {
      return failure(400, `days is a whole number from 1 to ${MAX_REPORT_DAYS}`)
    }
    const today = dayOf(now())
    const since = dayOf(new Date(now().getTime() - (days - 1) * DAY_MS))
    try {
      const totals = store.totalsSince(since)
      const skips = store.skipsSince(since)
      const ids = [
        ...new Set([...totals, ...skips].map(({ songId }) => songId)),
      ]
      return {
        status: 200,
        body: {
          days,
          since,
          ...buildStatReport(totals, skips, findSongs(ids)),
          daily: buildDailySeries(store.dailySince(since), since, today),
          skipBuckets: buildSkipBuckets(skips),
          skipBucketSeconds: SKIP_BUCKET_SECONDS,
          skipBucketCount: SKIP_BUCKET_COUNT,
        },
      }
    } catch (error) {
      console.error('Stats report error:', error)
      return failure(500, 'Could not read the statistics')
    }
  }
}
