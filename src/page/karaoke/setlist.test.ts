import { DateTime, Option } from 'effect'
import { expect, test } from 'vitest'

import type { PlayableSong } from '../../domain.ts'
import type { PlaylistEntry } from '../../playlist.ts'
import {
  emptySetlist,
  enqueueAll,
  loadPlaylist,
  play,
  resolvePlaylist,
} from './setlist.ts'

const makeSong = (
  id: string,
  video = `video-${id}`,
  timestamp = '00:01:00',
): PlayableSong => ({
  id,
  song_title: `Song ${id}`,
  artist: '',
  original_title: '',
  version: '',
  note: '',
  timestamp,
  created_at: 'x',
  video_url: video,
  title_text: 'Stream',
  membership: false,
  published_at: DateTime.makeUnsafe('2026-09-29T12:24:01Z'),
  kind: 'karaoke',
})

const entryOf = (song: PlayableSong): PlaylistEntry => ({
  songId: song.id,
  videoUrl: song.video_url,
  timestamp: song.timestamp,
  title: song.song_title,
})

const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(id => makeSong(id))
const archive = [a!, b!, c!, d!]
const noneGone = () => false

const idsOf = (songs: ReadonlyArray<PlayableSong>) => songs.map(song => song.id)

test('entries resolve to archive songs in the playlist order', () => {
  const resolved = resolvePlaylist(
    [entryOf(c!), entryOf(a!), entryOf(d!)],
    archive,
    noneGone,
  )
  expect(idsOf(resolved.songs)).toEqual(['c', 'a', 'd'])
  expect(resolved.unavailableCount).toBe(0)
})

test('a renamed song resolves by its video and timestamp', () => {
  const entry = { ...entryOf(b!), songId: 'old-id', title: 'Old title' }
  expect(idsOf(resolvePlaylist([entry], archive, noneGone).songs)).toEqual([
    'b',
  ])
})

test('a song with a new id and a new timestamp resolves by its video and title', () => {
  const entry = { ...entryOf(b!), songId: 'old-id', timestamp: '09:99:99' }
  expect(idsOf(resolvePlaylist([entry], archive, noneGone).songs)).toEqual([
    'b',
  ])
})

test('the song id wins over a video and timestamp that name another song', () => {
  const entry = { ...entryOf(b!), videoUrl: a!.video_url }
  expect(idsOf(resolvePlaylist([entry], archive, noneGone).songs)).toEqual([
    'b',
  ])
})

test('an entry the archive no longer has is counted, not queued', () => {
  const missing = {
    songId: 'missing',
    videoUrl: 'video-missing',
    timestamp: '00:00:01',
    title: 'Missing',
  }
  const resolved = resolvePlaylist([entryOf(a!), missing], archive, noneGone)
  expect(idsOf(resolved.songs)).toEqual(['a'])
  expect(resolved.unavailableCount).toBe(1)
})

test('a song whose video is gone is skipped and counted', () => {
  const resolved = resolvePlaylist(
    [entryOf(a!), entryOf(b!), entryOf(c!)],
    archive,
    song => song.video_url === b!.video_url,
  )
  expect(idsOf(resolved.songs)).toEqual(['a', 'c'])
  expect(resolved.unavailableCount).toBe(1)
})

test('two entries that resolve to one song queue it once and count nothing', () => {
  const renamed = { ...entryOf(a!), songId: 'old-id' }
  const resolved = resolvePlaylist([entryOf(a!), renamed], archive, noneGone)
  expect(idsOf(resolved.songs)).toEqual(['a'])
  expect(resolved.unavailableCount).toBe(0)
})

test('replacing the queue holds only the playlist and starts its first song', () => {
  const queued = enqueueAll(emptySetlist, [a!, b!])
  const loaded = loadPlaylist(queued, [c!, d!], 'Replace')
  expect(idsOf(loaded.queue)).toEqual(['d'])
  expect(Option.map(loaded.maybeNowPlaying, ({ song }) => song.id)).toEqual(
    Option.some('c'),
  )
})

test('replacing keeps the song that was playing in history', () => {
  const playing = play(emptySetlist, a!)
  const loaded = loadPlaylist(playing, [c!, d!], 'Replace')
  expect(idsOf(loaded.history)).toEqual(['a'])
})

test('adding keeps the queue first, then the playlist in order, and starts nothing', () => {
  const queued = enqueueAll(emptySetlist, [a!, b!])
  const loaded = loadPlaylist(queued, [c!, d!], 'Append')
  expect(idsOf(loaded.queue)).toEqual(['a', 'b', 'c', 'd'])
  expect(loaded.maybeNowPlaying).toEqual(queued.maybeNowPlaying)
})

test('adding drops songs already queued or playing', () => {
  const queued = play(enqueueAll(emptySetlist, [a!, b!]), c!)
  const loaded = loadPlaylist(queued, [b!, c!, d!], 'Append')
  expect(idsOf(loaded.queue)).toEqual(['a', 'b', 'd'])
})

test('loading no songs changes nothing in either mode', () => {
  const queued = enqueueAll(emptySetlist, [a!])
  expect(loadPlaylist(queued, [], 'Replace')).toBe(queued)
  expect(loadPlaylist(queued, [], 'Append')).toBe(queued)
})
