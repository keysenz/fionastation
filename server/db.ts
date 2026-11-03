import { DatabaseSync } from 'node:sqlite'

import type { KaraokeSong, KaraokeVideo, VideoKind } from '../src/domain.ts'
import type { SongForLyrics } from './lyricsMatch.ts'

interface VideoRow {
  id: string
  video_title: string
  video_url: string
  membership: number
  kind: VideoKind
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
      `SELECT id, video_title, video_url, membership, kind
       FROM karaoke_video
       ORDER BY published_at DESC`,
    )
    .all() as unknown as VideoRow[]

  const songs = db()
    .prepare(
      `SELECT s.id, s.song_title, s.timestamp, s.created_at, s.video_id
       FROM karaoke_song s
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

const toSeconds = (timestamp: string): number =>
  timestamp.split(':').reduce((total, part) => total * 60 + Number(part), 0)

export function listSongIds(): Set<string> {
  const rows = db().prepare('SELECT id FROM karaoke_song').all() as unknown as {
    id: string
  }[]
  return new Set(rows.map(row => row.id))
}

interface LyricsSongRow {
  song_title: string
  timestamp: string
  video_id: string
  video_title: string
  kind: VideoKind
}

/** The song with the length of its slot: the time up to the next song in the same video. */
export function findSongForLyrics(id: string): SongForLyrics | undefined {
  const row = db()
    .prepare(
      `SELECT s.song_title, s.timestamp, s.video_id, v.video_title, v.kind
       FROM karaoke_song s
       JOIN karaoke_video v ON v.id = s.video_id
       WHERE s.id = ?`,
    )
    .get(id) as unknown as LyricsSongRow | undefined
  if (!row) return undefined
  const start = toSeconds(row.timestamp)
  const timestamps = db()
    .prepare('SELECT timestamp FROM karaoke_song WHERE video_id = ?')
    .all(row.video_id) as unknown as { timestamp: string }[]
  const nextStart = Math.min(
    ...timestamps
      .map(({ timestamp }) => toSeconds(timestamp))
      .filter(t => t > start),
  )
  return {
    id,
    title: row.song_title,
    videoTitle: row.video_title,
    kind: row.kind,
    ...(Number.isFinite(nextStart) ? { spanSeconds: nextStart - start } : {}),
  }
}
