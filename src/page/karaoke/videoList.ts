import { Array, type DateTime, Option } from 'effect'

import type { PlayableSong, VideoKind } from '../../domain.ts'
import { makeFuzzySearch } from '../../fuzzySearch'

export type VideoGroup = {
  videoId: string
  title: string
  kind: VideoKind
  isGone: boolean
  publishedAt: DateTime.Utc
  songs: ReadonlyArray<PlayableSong>
}

const FUZZY_THRESHOLD = 0.3

const SEARCHED_FIELDS = [
  'song_title',
  'artist',
  'version',
  'note',
  'original_title',
] as const

const fuzzySongs = makeFuzzySearch<PlayableSong>(
  SEARCHED_FIELDS,
  FUZZY_THRESHOLD,
)

/** Songs arrive newest video first, so first appearance fixes a video's place. */
export const groupByVideo = (
  songs: ReadonlyArray<PlayableSong>,
  goneVideoIds: ReadonlyArray<string>,
): ReadonlyArray<VideoGroup> => {
  const goneIds = new Set(goneVideoIds)
  const groups = [...Map.groupBy(songs, song => song.video_url)].flatMap(
    ([videoId, videoSongs]) =>
      Array.match(videoSongs, {
        onEmpty: () => [],
        onNonEmpty: ([first]) => [
          {
            videoId,
            title: first.title_text,
            kind: first.kind,
            isGone: goneIds.has(videoId),
            publishedAt: first.published_at,
            songs: videoSongs,
          },
        ],
      }),
  )
  return [
    ...groups.filter(group => !group.isGone),
    ...groups.filter(group => group.isGone),
  ]
}

const flatSongsCache = new WeakMap<
  ReadonlyArray<VideoGroup>,
  ReadonlyArray<PlayableSong>
>()

const flatSongsOf = (
  groups: ReadonlyArray<VideoGroup>,
): ReadonlyArray<PlayableSong> => {
  const cached = flatSongsCache.get(groups)
  if (cached) {
    return cached
  }
  const flat = groups.flatMap(group => group.songs)
  flatSongsCache.set(groups, flat)
  return flat
}

const keepMatching = (
  groups: ReadonlyArray<VideoGroup>,
  isMatch: (song: PlayableSong) => boolean,
): ReadonlyArray<VideoGroup> =>
  groups.flatMap(group => {
    const songs = group.songs.filter(isMatch)
    return Array.isReadonlyArrayNonEmpty(songs) ? [{ ...group, songs }] : []
  })

/** Groups keep archive order whatever the query, so results never reorder by score. */
export const searchVideos = (
  groups: ReadonlyArray<VideoGroup>,
  query: string,
): ReadonlyArray<VideoGroup> => {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return groups
  }
  const literal = keepMatching(groups, song =>
    [...SEARCHED_FIELDS.map(field => song[field]), song.title_text].some(text =>
      text.toLowerCase().includes(needle),
    ),
  )
  if (Array.isReadonlyArrayNonEmpty(literal)) {
    return literal
  }
  const fuzzyIds = new Set(
    fuzzySongs(flatSongsOf(groups), query).map(song => song.id),
  )
  return keepMatching(groups, song => fuzzyIds.has(song.id))
}

export type Selection = {
  maybeVideo: Option.Option<VideoGroup>
  isChosen: boolean
}

/** A choice the search hides falls back to the playing video, then to the
 *  first shown video, and comes back when the search clears. */
export const resolveSelection = (
  shown: ReadonlyArray<VideoGroup>,
  maybeSelectedVideoId: Option.Option<string>,
  maybePlayingVideoId: Option.Option<string>,
): Selection => {
  const findShown = (videoId: string) =>
    Array.findFirst(shown, group => group.videoId === videoId)
  return Option.match(Option.flatMap(maybeSelectedVideoId, findShown), {
    onNone: () => ({
      maybeVideo: Option.orElse(
        Option.flatMap(maybePlayingVideoId, findShown),
        () => Array.head(shown),
      ),
      isChosen: false,
    }),
    onSome: video => ({ maybeVideo: Option.some(video), isChosen: true }),
  })
}
