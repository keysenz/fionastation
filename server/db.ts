import { DatabaseSync } from 'node:sqlite'

import type { KaraokeSong, KaraokeVideoJson, VideoKind } from '../src/domain.ts'
import type { PlaylistEntry } from '../src/playlist.ts'
import type { SongForLyrics } from './lyricsMatch.ts'

interface VideoRow {
  id: string
  video_title: string
  video_url: string
  membership: number
  kind: VideoKind
  published_at: string
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

export function listKaraokeVideos(): Omit<KaraokeVideoJson, 'is_gone'>[] {
  const videos = db()
    .prepare(
      `SELECT id, video_title, video_url, membership, kind, published_at
       FROM karaoke_video
       ORDER BY published_at DESC`,
    )
    .all() as unknown as VideoRow[]

  const songs = db()
    .prepare(
      `SELECT s.id, s.song_title, COALESCE(s.artist, '') AS artist,
              COALESCE(s.original_title, '') AS original_title,
              COALESCE(s.version, '') AS version, COALESCE(s.note, '') AS note,
              s.timestamp, s.created_at, s.video_id
       FROM karaoke_song s
       ORDER BY s.timestamp ASC`,
    )
    .all() as unknown as SongRow[]

  const songsByVideo = Map.groupBy(songs, song => song.video_id)

  return videos.map(video => ({
    ...video,
    membership: video.membership !== 0,
    karaoke_song: (songsByVideo.get(video.id) ?? []).map(
      ({ video_id: _videoId, ...song }) => song,
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

export function findSongsForPlaylist(ids: readonly string[]): PlaylistEntry[] {
  if (ids.length === 0) return []
  return db()
    .prepare(
      `SELECT s.id AS songId, v.video_url AS videoUrl, s.timestamp, s.song_title AS title
       FROM karaoke_song s
       JOIN karaoke_video v ON v.id = s.video_id
       WHERE s.id IN (${ids.map(() => '?').join(', ')})`,
    )
    .all(...ids) as unknown as PlaylistEntry[]
}

export type SongForStats = Readonly<{
  songId: string
  title: string
  artist: string
  videoId: string
  videoTitle: string
  videoUrl: string
}>

export function findSongsForStats(ids: readonly string[]): SongForStats[] {
  if (ids.length === 0) return []
  return db()
    .prepare(
      `SELECT s.id AS songId, s.song_title AS title, COALESCE(s.artist, '') AS artist,
              v.id AS videoId, v.video_title AS videoTitle, v.video_url AS videoUrl
       FROM karaoke_song s
       JOIN karaoke_video v ON v.id = s.video_id
       WHERE s.id IN (${ids.map(() => '?').join(', ')})`,
    )
    .all(...ids) as unknown as SongForStats[]
}
