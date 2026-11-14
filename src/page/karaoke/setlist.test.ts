import { Array, DateTime, Option, Schema } from 'effect'
import { expect, test } from 'vitest'

import type { PlayableSong } from '../../domain.ts'
import { type PlaylistEntry, PlaylistId } from '../../playlist.ts'
import {
  emptySetlist,
  enqueue,
  enqueueAll,
  entrySongIds,
  loadPlaylist,
  moveInQueue,
  play,
  playFromQueue,
  playNext,
  playlistSongIds,
  removeFromQueue,
  resolvePlaylist,
  restoreSaved,
  toPersistedJson,
} from './setlist.ts'

const listId = Schema.decodeSync(PlaylistId)('Ab3dE5gH')

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
  const loaded = loadPlaylist(queued, [c!, d!], 'Replace', listId)
  expect(idsOf(loaded.queue)).toEqual(['d'])
  expect(Option.map(loaded.maybeNowPlaying, ({ song }) => song.id)).toEqual(
    Option.some('c'),
  )
})

test('replacing keeps the song that was playing in history', () => {
  const playing = play(emptySetlist, a!)
  const loaded = loadPlaylist(playing, [c!, d!], 'Replace', listId)
  expect(idsOf(loaded.history)).toEqual(['a'])
})

test('adding keeps the queue first, then the playlist in order, and starts nothing', () => {
  const queued = enqueueAll(emptySetlist, [a!, b!])
  const loaded = loadPlaylist(queued, [c!, d!], 'Append', listId)
  expect(idsOf(loaded.queue)).toEqual(['a', 'b', 'c', 'd'])
  expect(loaded.maybeNowPlaying).toEqual(queued.maybeNowPlaying)
})

test('adding drops songs already queued or playing', () => {
  const queued = play(enqueueAll(emptySetlist, [a!, b!]), c!)
  const loaded = loadPlaylist(queued, [b!, c!, d!], 'Append', listId)
  expect(idsOf(loaded.queue)).toEqual(['a', 'b', 'd'])
})

test('loading no songs changes nothing in either mode', () => {
  const queued = enqueueAll(emptySetlist, [a!])
  expect(loadPlaylist(queued, [], 'Replace', listId)).toBe(queued)
  expect(loadPlaylist(queued, [], 'Append', listId)).toBe(queued)
})

test('loading a playlist in either mode remembers which one was opened', () => {
  for (const mode of ['Replace', 'Append'] as const) {
    expect(
      loadPlaylist(emptySetlist, [c!], mode, listId).maybeOpenedPlaylistId,
    ).toEqual(Option.some(listId))
  }
})

test('the opened playlist is saved with the queue and restored on reload', () => {
  const loaded = loadPlaylist(
    enqueueAll(emptySetlist, [a!]),
    [c!, d!],
    'Append',
    listId,
  )
  const restored = restoreSaved(
    emptySetlist,
    Option.some(toPersistedJson(loaded)),
  )
  expect(restored.maybeOpenedPlaylistId).toEqual(Option.some(listId))
  expect(idsOf(restored.queue)).toEqual(['a', 'c', 'd'])
})

test('a queue saved before playlists existed restores with no opened playlist', () => {
  const old = JSON.stringify({ state: { queue: [], history: [] }, version: 0 })
  expect(
    restoreSaved(emptySetlist, Option.some(old)).maybeOpenedPlaylistId,
  ).toEqual(Option.none())
})

test('a visitor queue edit forgets the opened playlist, and playing through does not', () => {
  const opened = loadPlaylist(emptySetlist, [a!, b!, c!], 'Replace', listId)
  expect(Option.isSome(opened.maybeOpenedPlaylistId)).toBe(true)
  expect(Option.isSome(playNext(opened).maybeOpenedPlaylistId)).toBe(true)
  expect(Option.isSome(playFromQueue(opened, 0).maybeOpenedPlaylistId)).toBe(
    true,
  )
  for (const edited of [
    enqueue(opened, d!),
    removeFromQueue(opened, 0),
    moveInQueue(opened, 0, 1),
  ]) {
    expect(edited.maybeOpenedPlaylistId).toEqual(Option.none())
  }
})

const sessionOf = (
  played: ReadonlyArray<PlayableSong>,
  playing: PlayableSong,
  queued: ReadonlyArray<PlayableSong>,
) => enqueueAll([...played, playing].reduce(play, emptySetlist), queued)

test('Up next saves the queue in order and Played saves the history oldest first', () => {
  const setlist = sessionOf([a!, b!], c!, [d!, makeSong('e')])
  expect(playlistSongIds(setlist, 'Queue', noneGone).songIds).toEqual([
    'd',
    'e',
  ])
  expect(playlistSongIds(setlist, 'History', noneGone).songIds).toEqual([
    'a',
    'b',
  ])
})

test('Whole session saves played, then playing, then queued', () => {
  const setlist = sessionOf([a!, b!], c!, [d!, makeSong('e')])
  expect(playlistSongIds(setlist, 'Session', noneGone).songIds).toEqual([
    'a',
    'b',
    'c',
    'd',
    'e',
  ])
})

test('a song played twice is saved once, at its first place', () => {
  const setlist = sessionOf([a!, b!], a!, [b!, c!])
  expect(playlistSongIds(setlist, 'Session', noneGone).songIds).toEqual([
    'a',
    'b',
    'c',
  ])
})

test('a gone video is left out of every source', () => {
  const setlist = sessionOf([a!, b!], c!, [d!])
  const goneB = (song: PlayableSong) => song.video_url === b!.video_url
  expect(playlistSongIds(setlist, 'Session', goneB).songIds).toEqual([
    'a',
    'c',
    'd',
  ])
  expect(playlistSongIds(setlist, 'History', goneB).songIds).toEqual(['a'])
})

test('a source with no songs yields none', () => {
  const setlist = sessionOf([], a!, [])
  expect(playlistSongIds(setlist, 'Queue', noneGone).songIds).toEqual([])
  expect(playlistSongIds(setlist, 'History', noneGone).songIds).toEqual([])
})

test('a playlist keeps its first 100 songs and counts the rest', () => {
  const many = Array.makeBy(130, index => makeSong(`s${index}`))
  const selection = playlistSongIds(
    enqueueAll(emptySetlist, many),
    'Queue',
    noneGone,
  )
  expect(selection.songIds).toHaveLength(100)
  expect(selection.songIds[0]).toBe('s0')
  expect(selection.omittedCount).toBe(30)
})

test('entry song ids follow renamed songs and keep entries the archive lost', () => {
  const renamed = { ...entryOf(b!), songId: 'old-id' }
  const lost = {
    songId: 'lost',
    videoUrl: 'video-lost',
    timestamp: '00:00:01',
    title: 'Lost',
  }
  expect(entrySongIds([entryOf(a!), renamed, lost], archive)).toEqual([
    'a',
    'b',
    'lost',
  ])
})
