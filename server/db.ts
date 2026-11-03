import { DatabaseSync } from 'node:sqlite'

import type { Cover, KaraokeSong, KaraokeVideo } from '../src/domain.ts'

interface VideoRow {
  id: string
  video_title: string
  video_url: string
  membership: number
}

interface SongRow extends KaraokeSong {
  video_id: string
}

let connection: DatabaseSync | undefined

// The discord bot owns this file and its migrations. The site only ever reads it.
function db(): DatabaseSync {
  if (connection) return connection
  const path = process.env.DATABASE_PATH
  if (!path) throw new Error('DATABASE_PATH is not set')
  connection = new DatabaseSync(path, { readOnly: true })
  return connection
}

export function listKaraokeVideos(): Omit<KaraokeVideo, 'is_gone'>[] {
  const videos = db()
    .prepare(
      `SELECT id, video_title, video_url, membership
       FROM karaoke_video
       WHERE kind = 'karaoke'
       ORDER BY published_at DESC`,
    )
    .all() as unknown as VideoRow[]

  const songs = db()
    .prepare(
      `SELECT s.id, s.song_title, s.timestamp, s.created_at, s.video_id
       FROM karaoke_song s
       JOIN karaoke_video v ON v.id = s.video_id
       WHERE v.kind = 'karaoke'
       ORDER BY s.timestamp ASC`,
    )
    .all() as unknown as SongRow[]

  const songsByVideo = Map.groupBy(songs, song => song.video_id)

  return videos.map(video => ({
    ...video,
    membership: video.membership !== 0,
    karaoke_song: (songsByVideo.get(video.id) ?? []).map(
      ({ id, song_title, timestamp, created_at }) => ({
        id,
        song_title,
        timestamp,
        created_at,
      }),
    ),
  }))
}

export function listCovers(): Cover[] {
  return db()
    .prepare(
      `SELECT id, video_title AS title, video_url AS video_id, published_at
       FROM karaoke_video
       WHERE kind IN ('cover', 'original')
       ORDER BY published_at DESC`,
    )
    .all() as unknown as Cover[]
}
