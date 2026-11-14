import { DateTime, Schema } from 'effect'
import { expect, test } from 'vitest'

import type { PlayableSong } from '../../domain.ts'
import { PlayerEvent } from '../../youtube'
import { Message, type Model, RecordStat, init, update } from './karaoke.ts'
import { PlayStat } from './playStats.ts'

const song = (id: string, video: string, timestamp: string): PlayableSong => ({
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

const s1 = song('s1', 'stream', '00:01:00')
const s2 = song('s2', 'stream', '00:05:00')
const solo = song('solo', 'single', '00:00:30')

const loaded = (): Model =>
  update(
    init(),
    Message.SucceededFetchSongs({ songs: [s1, s2, solo], goneVideoIds: [] }),
  ).model

const decodeStat = Schema.decodeUnknownSync(PlayStat)

type Session = Readonly<{ model: Model; stats: ReadonlyArray<PlayStat> }>

const send = (session: Session, message: Message): Session => {
  const result = update(session.model, message)
  return {
    model: result.model,
    stats: [
      ...session.stats,
      ...(result.commands ?? []).flatMap(command =>
        command.name === RecordStat.name
          ? [decodeStat(command.args?.['stat'])]
          : [],
      ),
    ],
  }
}

const run = (...messages: ReadonlyArray<Message>): Session =>
  messages.reduce(send, { model: loaded(), stats: [] })

const event = (playId: number, playerEvent: PlayerEvent) =>
  Message.ReceivedPlayerEvent({ playId, event: playerEvent })
const playing = (playId: number) => event(playId, PlayerEvent.Playing())
const at = (playId: number, seconds: number) =>
  event(playId, PlayerEvent.Progressed({ seconds }))
const ready = (playId: number) => event(playId, PlayerEvent.Ready())

const tags = (stats: ReadonlyArray<PlayStat>) =>
  stats.map(stat => [stat._tag, 'songId' in stat ? stat.songId : ''])

test('a click records the click, and the first Playing records the play once', () => {
  const session = run(
    Message.ClickedSong({ song: s1 }),
    ready(1),
    playing(1),
    playing(1),
    event(1, PlayerEvent.Paused()),
    playing(1),
  )
  expect(session.stats).toEqual([
    { _tag: 'Clicked', songId: 's1' },
    { _tag: 'Played', songId: 's1', origin: 'Visitor' },
  ])
})

test('adding to the queue records a click and no play', () => {
  const session = run(Message.ClickedAddToQueue({ song: s2 }))
  expect(session.stats).toEqual([{ _tag: 'Clicked', songId: 's2' }])
})

test('a play that never reaches Playing counts nothing', () => {
  const gone = run(
    Message.ClickedSong({ song: solo }),
    event(1, PlayerEvent.VideoGone()),
  )
  const failed = run(
    Message.ClickedSong({ song: solo }),
    event(1, PlayerEvent.LoadFailed({ reason: 'PlayerUnavailable' })),
  )
  expect(tags(gone.stats)).toEqual([['Clicked', 'solo']])
  expect(tags(failed.stats)).toEqual([['Clicked', 'solo']])
})

test('a stream playing into its second song finishes the first and plays the second', () => {
  const session = run(
    Message.ClickedSong({ song: s1 }),
    ready(1),
    playing(1),
    at(1, 70),
    at(1, 200),
    at(1, 301),
    at(1, 310),
  )
  expect(tags(session.stats)).toEqual([
    ['Clicked', 's1'],
    ['Played', 's1'],
    ['Finished', 's1'],
    ['Played', 's2'],
  ])
})

test('a song of a play counts once however often the playhead comes back to it', () => {
  const session = run(
    Message.ClickedSong({ song: s1 }),
    playing(1),
    at(1, 301),
    at(1, 70),
    at(1, 310),
  )
  expect(tags(session.stats).filter(([tag]) => tag === 'Played')).toEqual([
    ['Played', 's1'],
    ['Played', 's2'],
  ])
})

test('the player ending a play finishes its song once', () => {
  const session = run(
    Message.ClickedSong({ song: solo }),
    playing(1),
    event(1, PlayerEvent.Ended()),
    event(1, PlayerEvent.Ended()),
  )
  expect(tags(session.stats)).toEqual([
    ['Clicked', 'solo'],
    ['Played', 'solo'],
    ['Finished', 'solo'],
  ])
})

test('an end reported for an older play finishes nothing', () => {
  const session = run(
    Message.ClickedSong({ song: s1 }),
    playing(1),
    Message.ClickedSong({ song: solo }),
    event(1, PlayerEvent.Ended()),
  )
  expect(tags(session.stats).filter(([tag]) => tag === 'Finished')).toEqual([])
})

test('Next partway through a song skips it with the seconds into that song', () => {
  const session = run(
    Message.ClickedSong({ song: s1 }),
    playing(1),
    at(1, 100),
    Message.ClickedNext(),
  )
  expect(session.stats).toContainEqual({
    _tag: 'Skipped',
    songId: 's1',
    origin: 'Visitor',
    secondsIntoSong: 40,
  })
  expect(tags(session.stats).filter(([tag]) => tag === 'Finished')).toEqual([])
})

test('Next names the song the playhead is in, and a second Next cannot skip it again', () => {
  const session = run(
    Message.ClickedSong({ song: s1 }),
    playing(1),
    at(1, 305),
    Message.ClickedNext(),
    Message.ClickedNext(),
  )
  const skips = session.stats.filter(({ _tag }) => _tag === 'Skipped')
  expect(skips).toEqual([
    { _tag: 'Skipped', songId: 's2', origin: 'Visitor', secondsIntoSong: 5 },
  ])
})

test('Next before any playhead is known skips the song that was clicked from second 0', () => {
  const session = run(
    Message.ClickedSong({ song: s1 }),
    playing(1),
    Message.ClickedNext(),
  )
  expect(session.stats).toContainEqual({
    _tag: 'Skipped',
    songId: 's1',
    origin: 'Visitor',
    secondsIntoSong: 0,
  })
})

test('Next on a play that never played skips nothing', () => {
  const session = run(Message.ClickedSong({ song: s1 }), Message.ClickedNext())
  expect(tags(session.stats)).toEqual([['Clicked', 's1']])
})

test('a play the radio picked itself counts as Autoplay, and a click as Visitor', () => {
  const pending = run(
    Message.ClickedSong({ song: s1 }),
    playing(1),
    at(1, 10),
    Message.ClickedNext(),
  )
  const picked = send(
    pending,
    Message.CompletedPickRandomVideo({ playId: 1, song: solo }),
  )
  const next = send(picked, playing(2))
  expect(next.stats.at(-1)).toEqual({
    _tag: 'Played',
    songId: 'solo',
    origin: 'Autoplay',
  })
  expect(next.stats.find(({ _tag }) => _tag === 'Clicked')).toEqual({
    _tag: 'Clicked',
    songId: 's1',
  })
})

test('Playing again after the load failed in a counted play does not count it twice', () => {
  const session = run(
    Message.ClickedSong({ song: solo }),
    playing(1),
    event(1, PlayerEvent.LoadFailed({ reason: 'PlayerUnavailable' })),
    playing(1),
  )
  expect(tags(session.stats).filter(([tag]) => tag === 'Played')).toEqual([
    ['Played', 'solo'],
  ])
})

test('a retry of a counted play, under a new playId, does not count it again', () => {
  const session = run(
    Message.ClickedSong({ song: solo }),
    playing(1),
    event(1, PlayerEvent.LoadFailed({ reason: 'PlayerUnavailable' })),
    Message.ClickedSong({ song: solo }),
    playing(2),
  )
  expect(tags(session.stats).filter(([tag]) => tag === 'Played')).toEqual([
    ['Played', 'solo'],
  ])
})

test('a retry of a play that never played counts it when it does play', () => {
  const session = run(
    Message.ClickedSong({ song: solo }),
    event(1, PlayerEvent.LoadFailed({ reason: 'PlayerUnavailable' })),
    Message.ClickedSong({ song: solo }),
    playing(2),
  )
  expect(tags(session.stats).filter(([tag]) => tag === 'Played')).toEqual([
    ['Played', 'solo'],
  ])
})

test('a gone play finishes and skips nothing, whatever its player still reports', () => {
  const session = run(
    Message.ClickedSong({ song: s1 }),
    ready(1),
    event(1, PlayerEvent.VideoGone()),
    at(1, 300),
    event(1, PlayerEvent.Ended()),
  )
  expect(
    session.stats.filter(
      ({ _tag }) => _tag === 'Finished' || _tag === 'Skipped',
    ),
  ).toEqual([])
})

test('a failed load finishes and skips nothing, whatever its player still reports', () => {
  const session = run(
    Message.ClickedSong({ song: s1 }),
    ready(1),
    event(1, PlayerEvent.LoadFailed({ reason: 'PlayerUnavailable' })),
    at(1, 300),
    event(1, PlayerEvent.Ended()),
  )
  expect(
    session.stats.filter(
      ({ _tag }) => _tag === 'Finished' || _tag === 'Skipped',
    ),
  ).toEqual([])
})
