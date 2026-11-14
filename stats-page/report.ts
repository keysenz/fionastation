export const ORIGINS = ['Visitor', 'Autoplay'] as const
export type Origin = (typeof ORIGINS)[number]
export type ByOrigin = Readonly<Record<Origin, number>>

export type Tally = Readonly<{
  clicks: number
  plays: ByOrigin
  finishes: ByOrigin
  skips: ByOrigin
}>

export type SongRow = Tally &
  Readonly<{
    songId: string
    title: string | null
    artist: string | null
    medianSecondsIntoSkip: number | null
  }>

export type VideoRow = Tally &
  Readonly<{ videoId: string; videoTitle: string; videoUrl: string }>

export type DayRow = Tally & Readonly<{ day: string }>

export type SkipBucket = Readonly<{
  songId: string
  bucket: number
  count: number
}>

export type Report = Readonly<{
  days: number
  since: string
  songs: readonly SongRow[]
  videos: readonly VideoRow[]
  daily: readonly DayRow[]
  skipBuckets: readonly SkipBucket[]
  skipBucketSeconds: number
  skipBucketCount: number
}>

const record = (value: unknown) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined

const byOrigin = (value: unknown): ByOrigin | undefined => {
  const fields = record(value)
  const Visitor = count(fields?.Visitor)
  const Autoplay = count(fields?.Autoplay)
  return Visitor === undefined || Autoplay === undefined
    ? undefined
    : { Visitor, Autoplay }
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined)

const tally = (value: unknown): Tally | undefined => {
  const fields = record(value)
  const clicks = count(fields?.clicks)
  const plays = byOrigin(fields?.plays)
  const finishes = byOrigin(fields?.finishes)
  const skips = byOrigin(fields?.skips)
  return clicks === undefined || !plays || !finishes || !skips
    ? undefined
    : { clicks, plays, finishes, skips }
}

const each = <T>(
  value: unknown,
  parse: (item: unknown) => T | undefined,
): T[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const parsed = value.map(parse)
  return parsed.every(item => item !== undefined) ? (parsed as T[]) : undefined
}

const parseSong = (item: unknown): SongRow | undefined => {
  const fields = record(item)
  const counts = tally(item)
  const songId = text(fields?.songId)
  const median = fields?.medianSecondsIntoSkip
  if (!counts || songId === undefined) return undefined
  if (median !== null && count(median) === undefined) return undefined
  return {
    ...counts,
    songId,
    title: text(fields?.title) ?? null,
    artist: text(fields?.artist) ?? null,
    medianSecondsIntoSkip: median === null ? null : (median as number),
  }
}

const parseVideo = (item: unknown): VideoRow | undefined => {
  const fields = record(item)
  const counts = tally(item)
  const videoId = text(fields?.videoId)
  const videoTitle = text(fields?.videoTitle)
  const videoUrl = text(fields?.videoUrl)
  return counts &&
    videoId !== undefined &&
    videoTitle !== undefined &&
    videoUrl !== undefined
    ? { ...counts, videoId, videoTitle, videoUrl }
    : undefined
}

const parseDay = (item: unknown): DayRow | undefined => {
  const counts = tally(item)
  const day = text(record(item)?.day)
  return counts && day !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? { ...counts, day }
    : undefined
}

const parseBucket = (item: unknown): SkipBucket | undefined => {
  const fields = record(item)
  const songId = text(fields?.songId)
  const bucket = count(fields?.bucket)
  const amount = count(fields?.count)
  return songId === undefined || bucket === undefined || amount === undefined
    ? undefined
    : { songId, bucket, count: amount }
}

export const parseReport = (raw: unknown): Report | undefined => {
  const fields = record(raw)
  const days = count(fields?.days)
  const since = text(fields?.since)
  const songs = each(fields?.songs, parseSong)
  const videos = each(fields?.videos, parseVideo)
  const daily = each(fields?.daily, parseDay)
  const skipBuckets = each(fields?.skipBuckets, parseBucket)
  const skipBucketSeconds = count(fields?.skipBucketSeconds)
  const skipBucketCount = count(fields?.skipBucketCount)
  if (
    days === undefined ||
    since === undefined ||
    !songs ||
    !videos ||
    !daily ||
    !skipBuckets ||
    !skipBucketSeconds ||
    !skipBucketCount
  ) {
    return undefined
  }
  return {
    days,
    since,
    songs,
    videos,
    daily,
    skipBuckets,
    skipBucketSeconds,
    skipBucketCount,
  }
}

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0)

export type Totals = Readonly<{
  plays: ByOrigin
  totalPlays: number
  visitorShare: number | null
  clicks: number
  finishes: number
  skips: number
  finishRate: number | null
}>

const ratio = (part: number, whole: number) =>
  whole === 0 ? null : part / whole

export const totalsOf = (daily: readonly DayRow[]): Totals => {
  const plays = {
    Visitor: sum(daily.map(day => day.plays.Visitor)),
    Autoplay: sum(daily.map(day => day.plays.Autoplay)),
  }
  const totalPlays = plays.Visitor + plays.Autoplay
  const finishes = sum(
    daily.map(day => day.finishes.Visitor + day.finishes.Autoplay),
  )
  return {
    plays,
    totalPlays,
    visitorShare: ratio(plays.Visitor, totalPlays),
    clicks: sum(daily.map(day => day.clicks)),
    finishes,
    skips: sum(daily.map(day => day.skips.Visitor + day.skips.Autoplay)),
    finishRate: ratio(finishes, totalPlays),
  }
}

export const SONG_COLUMNS = [
  'title',
  'clicks',
  'visitorPlays',
  'autoplayPlays',
  'finishes',
  'skips',
  'medianSkip',
] as const
export type SongColumn = (typeof SONG_COLUMNS)[number]
export type SortDirection = 'asc' | 'desc'

const songValue = (
  song: SongRow,
  column: SongColumn,
): string | number | null => {
  switch (column) {
    case 'title':
      return (song.title ?? song.songId).toLowerCase()
    case 'clicks':
      return song.clicks
    case 'visitorPlays':
      return song.plays.Visitor
    case 'autoplayPlays':
      return song.plays.Autoplay
    case 'finishes':
      return song.finishes.Visitor + song.finishes.Autoplay
    case 'skips':
      return song.skips.Visitor + song.skips.Autoplay
    case 'medianSkip':
      return song.medianSecondsIntoSkip
  }
}

export const sortSongs = (
  songs: readonly SongRow[],
  column: SongColumn,
  direction: SortDirection,
): SongRow[] => {
  const sign = direction === 'asc' ? 1 : -1
  return songs.toSorted((left, right) => {
    const a = songValue(left, column)
    const b = songValue(right, column)
    if (a === null || b === null) {
      return a === b ? 0 : a === null ? 1 : -1
    }
    const order =
      typeof a === 'string' && typeof b === 'string'
        ? a.localeCompare(b)
        : Number(a) - Number(b)
    return order * sign
  })
}

export const histogramOf = (
  report: Report,
  songId: string | null,
): number[] => {
  const bars = Array.from({ length: report.skipBucketCount }, () => 0)
  for (const { songId: id, bucket, count: amount } of report.skipBuckets) {
    if ((songId === null || id === songId) && bucket < bars.length) {
      bars[bucket] = (bars[bucket] ?? 0) + amount
    }
  }
  return bars
}

export const formatCount = (value: number) => value.toLocaleString('en-US')

export const formatPercent = (value: number | null) =>
  value === null ? 'n/a' : `${Math.round(value * 100)}%`

export const formatSeconds = (value: number | null) =>
  value === null ? 'n/a' : `${Math.round(value)}s`

export const RANGES = [
  { label: '24 h', days: 1 },
  { label: '7 d', days: 7 },
  { label: '30 d', days: 30 },
  { label: '90 d', days: 90 },
] as const
