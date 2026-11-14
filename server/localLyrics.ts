// Lyrics for songs LRCLIB does not have, kept by hand in lyrics-local.json.
// The text is the whole of the lyrics; scripts/align-lyrics times it against
// Fiona's singing and writes the timed lines into lyrics-aligned.json.
import { existsSync, readFileSync } from 'node:fs'

import type { Lyrics } from '../src/lyrics.ts'
import { type AlignedSong, normalizeTitle } from './lyricsMatch.ts'

export type LocalSong = Readonly<{
  id: string
  songTitle: string
  track: string
  artist: string
  /** What the page credits under the lyrics, such as "the video description". */
  source: string
  note?: string
  lines: ReadonlyArray<string>
}>

export type LocalLyrics = ReadonlyMap<string, LocalSong>

export const noLocalLyrics: LocalLyrics = new Map()

type SongForLocal = Readonly<{ id: string; title: string }>

export function loadLocalLyrics(path: string): LocalLyrics {
  if (!existsSync(path)) return noLocalLyrics
  try {
    return parseLocalLyrics(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid local lyrics in ${path}: ${reason}`, {
      cause: error,
    })
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const knownFields = new Set([
  'songTitle',
  'track',
  'artist',
  'source',
  'note',
  'lines',
])

const textField = (
  value: unknown,
  path: string,
  { optional = false } = {},
): string => {
  if (value === undefined && optional) return ''
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path}: expected a non-empty string`)
  }
  return value
}

export function parseLocalLyrics(json: unknown): LocalLyrics {
  if (!isRecord(json)) throw new Error('$: expected an object')
  const local = new Map<string, LocalSong>()
  for (const [id, value] of Object.entries(json)) {
    const path = `$[${JSON.stringify(id)}]`
    if (!isRecord(value)) throw new Error(`${path}: expected an object`)
    for (const key of Object.keys(value)) {
      if (!knownFields.has(key)) throw new Error(`${path}.${key}: unknown field`)
    }
    const { lines } = value
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new Error(`${path}.lines: expected at least one line`)
    }
    const texts = lines.map((line: unknown, index) => {
      if (typeof line !== 'string' || line.trim() === '') {
        throw new Error(`${path}.lines[${index}]: expected a non-empty string`)
      }
      return line.trim()
    })
    local.set(id, {
      id,
      songTitle: textField(value.songTitle, `${path}.songTitle`),
      track: textField(value.track, `${path}.track`),
      artist: textField(value.artist, `${path}.artist`),
      source: textField(value.source, `${path}.source`),
      ...(value.note === undefined
        ? {}
        : { note: textField(value.note, `${path}.note`, { optional: true }) }),
      lines: texts,
    })
  }
  return local
}

/**
 * The lyrics to serve for a song whose text is local, or undefined to let
 * LRCLIB answer. The batch must have timed the text first: until then there is
 * nothing to show, because the lines have no times of their own.
 */
export function localLyricsFor(
  song: SongForLocal,
  local: LocalSong | undefined,
  aligned: AlignedSong | undefined,
  offsetMs: number,
): Lyrics | undefined {
  if (
    local === undefined ||
    aligned === undefined ||
    aligned.source !== 'Local' ||
    normalizeTitle(aligned.songTitle) !== normalizeTitle(song.title)
  ) {
    return undefined
  }
  return {
    _tag: 'Synced',
    lines: aligned.lines,
    offsetMs,
    credit: {
      source: local.source,
      track: local.track,
      artist: local.artist,
    },
  }
}
