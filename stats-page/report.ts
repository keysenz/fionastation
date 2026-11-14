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

export type OutcomeRow = Readonly<{
  origin: Origin
  plays: number
  finishes: number
  skips: number
  medianSecondsIntoSkip: number | null
}>

export type TransitionRow = Readonly<{
  prevSongId: string
  songId: string
  prevTitle: string | null
  title: string | null
  plays: number
  finishes: number
  skips: number
}>

export type SongMoodRow = Readonly<{
  songId: string
  title: string | null
  artist: string | null
  videoUrl: string | null
  votes: Readonly<Record<string, number>>
  total: number
}>

export type MoodDayRow = Readonly<{ day: string; votes: number }>

export type Report = Readonly<{
  days: number
  since: string
  songs: readonly SongRow[]
  videos: readonly VideoRow[]
  daily: readonly DayRow[]
  skipBuckets: readonly SkipBucket[]
  skipBucketSeconds: number
  skipBucketCount: number
  outcomes: readonly OutcomeRow[]
  transitions: readonly TransitionRow[]
  transitionMinPlays: number
  moodNames: readonly string[]
  moods: readonly SongMoodRow[]
  moodDaily: readonly MoodDayRow[]
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

const parseOutcome = (item: unknown): OutcomeRow | undefined => {
  const fields = record(item)
  const origin = ORIGINS.find(known => known === fields?.origin)
  const plays = count(fields?.plays)
  const finishes = count(fields?.finishes)
  const skips = count(fields?.skips)
  const median = fields?.medianSecondsIntoSkip
  if (
    origin === undefined ||
    plays === undefined ||
    finishes === undefined ||
    skips === undefined ||
    (median !== null && count(median) === undefined)
  ) {
    return undefined
  }
  return {
    origin,
    plays,
    finishes,
    skips,
    medianSecondsIntoSkip: median === null ? null : (median as number),
  }
}

const parseTransition = (item: unknown): TransitionRow | undefined => {
  const fields = record(item)
  const prevSongId = text(fields?.prevSongId)
  const songId = text(fields?.songId)
  const plays = count(fields?.plays)
  const finishes = count(fields?.finishes)
  const skips = count(fields?.skips)
  return prevSongId === undefined ||
    songId === undefined ||
    plays === undefined ||
    finishes === undefined ||
    skips === undefined
    ? undefined
    : {
        prevSongId,
        songId,
        prevTitle: text(fields?.prevTitle) ?? null,
        title: text(fields?.title) ?? null,
        plays,
        finishes,
        skips,
      }
}

const parseSongMoods = (
  item: unknown,
  moodNames: readonly string[],
): SongMoodRow | undefined => {
  const fields = record(item)
  const votes = record(fields?.votes)
  const songId = text(fields?.songId)
  const counts = moodNames.map(name => count(votes?.[name]))
  return songId === undefined || counts.some(amount => amount === undefined)
    ? undefined
    : {
        songId,
        title: text(fields?.title) ?? null,
        artist: text(fields?.artist) ?? null,
        videoUrl: text(fields?.videoUrl) ?? null,
        votes: Object.fromEntries(
          moodNames.map((name, index) => [name, counts[index] ?? 0]),
        ),
        total: counts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0),
      }
}

const parseMoodDay = (item: unknown): MoodDayRow | undefined => {
  const fields = record(item)
  const day = text(fields?.day)
  const votes = count(fields?.votes)
  return day !== undefined &&
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    votes !== undefined
    ? { day, votes }
    : undefined
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
  const outcomes = each(fields?.outcomes, parseOutcome)
  const transitions = each(fields?.transitions, parseTransition)
  const transitionMinPlays = count(fields?.transitionMinPlays)
  const moodDaily = each(fields?.moodDaily, parseMoodDay)
  const moodNames = each(fields?.moodNames, name => text(name))
  const moods = moodNames
    ? each(fields?.moods, item => parseSongMoods(item, moodNames))
    : undefined
  if (
    days === undefined ||
    since === undefined ||
    !songs ||
    !videos ||
    !daily ||
    !skipBuckets ||
    !skipBucketSeconds ||
    !skipBucketCount ||
    !outcomes ||
    !transitions ||
    transitionMinPlays === undefined ||
    !moodNames ||
    !moods ||
    !moodDaily
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
    outcomes,
    transitions,
    transitionMinPlays,
    moodNames,
    moods,
    moodDaily,
  }
}

export const FEW_MOOD_VOTES = 3

export type MoodShare = Readonly<{ mood: string; votes: number }>

export const moodMix = (
  rows: readonly SongMoodRow[],
  moodNames: readonly string[],
): MoodShare[] =>
  moodNames.map(mood => ({
    mood,
    votes: rows.reduce((total, row) => total + (row.votes[mood] ?? 0), 0),
  }))

export const topMoods = (
  row: SongMoodRow,
  moodNames: readonly string[],
): string[] => {
  const best = Math.max(0, ...moodNames.map(mood => row.votes[mood] ?? 0))
  return best === 0 ? [] : moodNames.filter(mood => row.votes[mood] === best)
}

export type MoodSummary = Readonly<{
  totalVotes: number
  songsWithVotes: number
  topMood: readonly string[]
}>

export const summarizeMoods = (report: Report): MoodSummary => {
  const mix = moodMix(report.moods, report.moodNames)
  const best = Math.max(0, ...mix.map(share => share.votes))
  return {
    totalVotes: mix.reduce((total, share) => total + share.votes, 0),
    songsWithVotes: report.moods.filter(row => row.total > 0).length,
    topMood:
      best === 0
        ? []
        : mix.filter(share => share.votes === best).map(share => share.mood),
  }
}

export const moodRowsFor = (
  rows: readonly SongMoodRow[],
  moodNames: readonly string[],
  mood: string | null,
): SongMoodRow[] =>
  [...rows]
    .filter(row => mood === null || topMoods(row, moodNames).includes(mood))
    .sort(
      (left, right) =>
        right.total - left.total || left.songId.localeCompare(right.songId),
    )

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

export const ratio = (part: number, whole: number) =>
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

export const TRANSITION_COLUMNS = [
  'transition',
  'plays',
  'finishRate',
  'skipRate',
] as const
export type TransitionColumn = (typeof TRANSITION_COLUMNS)[number]

export const MIN_PLAYS_CHOICES = [2, 5, 10] as const

const transitionValue = (
  row: TransitionRow,
  column: TransitionColumn,
): string | number | null => {
  switch (column) {
    case 'transition':
      return `${row.prevTitle ?? row.prevSongId} ${row.title ?? row.songId}`.toLowerCase()
    case 'plays':
      return row.plays
    case 'finishRate':
      return ratio(row.finishes, row.plays)
    case 'skipRate':
      return ratio(row.skips, row.plays)
  }
}

export const sortTransitions = (
  rows: readonly TransitionRow[],
  minPlays: number,
  column: TransitionColumn,
  direction: SortDirection,
): TransitionRow[] => {
  const sign = direction === 'asc' ? 1 : -1
  return rows
    .filter(row => row.plays >= minPlays)
    .toSorted((left, right) => {
      const a = transitionValue(left, column)
      const b = transitionValue(right, column)
      if (a === null || b === null) {
        return a === b ? 0 : a === null ? 1 : -1
      }
      const order =
        typeof a === 'string' && typeof b === 'string'
          ? a.localeCompare(b)
          : Number(a) - Number(b)
      return order * sign || right.plays - left.plays
    })
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

export const EXPORT_TABLES = [
  { table: 'events', label: 'Export listening trail' },
  { table: 'decisions', label: 'Export autoplay decisions' },
] as const

export const exportUrl = (table: string, days: number) =>
  `/api/stats-page/export?days=${days}&table=${table}`

export const RANGES = [
  { label: '24 h', days: 1 },
  { label: '7 d', days: 7 },
  { label: '30 d', days: 30 },
  { label: '90 d', days: 90 },
] as const
