import { Effect, Schema } from 'effect'

export const VideoKind = Schema.Literals(['karaoke', 'cover', 'original'])
export type VideoKind = typeof VideoKind.Type

// NOTE: queues saved before these fields existed lack them, so they decode as empty.
const TextOrEmpty = Schema.String.pipe(
  Schema.withDecodingDefaultTypeKey(Effect.succeed('')),
)

export const KaraokeSong = Schema.Struct({
  id: Schema.String,
  song_title: Schema.String,
  artist: TextOrEmpty,
  original_title: TextOrEmpty,
  version: TextOrEmpty,
  note: TextOrEmpty,
  timestamp: Schema.String,
  created_at: Schema.String,
})
export type KaraokeSong = typeof KaraokeSong.Type

export const KaraokeVideo = Schema.Struct({
  id: Schema.String,
  video_title: Schema.String,
  video_url: Schema.String,
  membership: Schema.Boolean,
  is_gone: Schema.Boolean,
  kind: VideoKind,
  karaoke_song: Schema.Array(KaraokeSong),
})
export type KaraokeVideo = typeof KaraokeVideo.Type

export const PlayableSong = Schema.Struct({
  ...KaraokeSong.fields,
  video_url: Schema.String,
  title_text: Schema.String,
  membership: Schema.Boolean,
  kind: VideoKind.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed('karaoke' as const)),
  ),
})
export type PlayableSong = typeof PlayableSong.Type

export const songLabel = ({
  song_title,
  version,
  artist,
}: Pick<KaraokeSong, 'song_title' | 'version' | 'artist'>): string =>
  song_title +
  (version === '' ? '' : ` (${version})`) +
  (artist === '' ? '' : ` - ${artist}`)

export const toPlayableSongs = (
  videos: ReadonlyArray<KaraokeVideo>,
): ReadonlyArray<PlayableSong> =>
  videos.flatMap(video =>
    video.karaoke_song.map(song => ({
      ...song,
      video_url: video.video_url,
      title_text: video.video_title,
      membership: video.membership,
      kind: video.kind,
    })),
  )

// NOTE: an embedded player cannot play a members-only video and reports no error when one is loaded into it, so those count as gone.
export const goneVideoIdsOf = (
  videos: ReadonlyArray<KaraokeVideo>,
): ReadonlyArray<string> =>
  videos
    .filter(video => video.is_gone || video.membership)
    .map(video => video.video_url)

export const timestampToSeconds = (timestamp: string): number => {
  const seconds = timestamp
    .split(':')
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0)
  return Number.isNaN(seconds) ? 0 : seconds
}
