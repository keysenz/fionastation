import { DateTime, Option, Schema } from 'effect'
import {
  Command,
  Mount,
  click,
  expect,
  given,
  inside,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { test } from 'vitest'

import type { PlayableSong } from '../../domain.ts'
import { Playlist } from '../../playlist.ts'
import { PlayerEvent } from '../../youtube'
import {
  Message,
  type Model,
  MountPlayer,
  WaitBeforeLoadTimeout,
  init,
  update,
} from './karaoke'
import { view } from './view'

const makeSong = (id: string): PlayableSong => ({
  id,
  song_title: `Song ${id}`,
  artist: '',
  original_title: '',
  version: '',
  note: '',
  timestamp: '00:01:00',
  created_at: 'x',
  video_url: `video-${id}`,
  title_text: 'Stream',
  membership: false,
  published_at: DateTime.makeUnsafe('2026-09-29T12:24:01Z'),
  kind: 'karaoke',
})
const [a, b] = [makeSong('a'), makeSong('b')]

const after = (...messages: ReadonlyArray<Message>): Model =>
  messages.reduce((model, message) => update(model, message).model, init())

const fetched = (...songs: ReadonlyArray<PlayableSong>) =>
  Message.SucceededFetchSongs({ songs, goneVideoIds: [] })
const reported = (event: PlayerEvent) =>
  Message.ReceivedPlayerEvent({ playId: 1, event })

const bar = selector('[data-player-bar]')
const button = (name: string) =>
  role('button', { name: new RegExp(`^${name}$`) })
const playerMounted = Mount.resolve(MountPlayer, Message.CompletedMountPlayer())

test('a gone stream with nothing to move to has a disabled play button and no Retry', () => {
  scene(
    { update, view },
    given(
      after(
        fetched(a),
        Message.ClickedSong({ song: a }),
        reported(PlayerEvent.VideoGone()),
      ),
    ),
    playerMounted,
    inside(
      bar,
      expect(button('Play')).toBeDisabled(),
      expect(button('Retry')).toBeAbsent(),
      expect(role('status')).toBeAbsent(),
    ),
  )
})

test('a gone stream that is moving on shows it is busy, with nothing to play, pause or retry', () => {
  scene(
    { update, view },
    given(
      after(
        fetched(a, b),
        Message.ClickedSong({ song: a }),
        reported(PlayerEvent.VideoGone()),
      ),
    ),
    playerMounted,
    inside(
      bar,
      expect(role('status')).toExist(),
      expect(button('Play')).toBeAbsent(),
      expect(button('Pause')).toBeAbsent(),
      expect(button('Retry')).toBeAbsent(),
    ),
  )
})

test('a failed load swaps play for Retry, and Retry brings the play button back', () => {
  scene(
    { update, view },
    given(
      after(
        fetched(a, b),
        Message.ClickedSong({ song: a }),
        reported(PlayerEvent.LoadFailed({ reason: 'VideoUnplayable' })),
      ),
    ),
    playerMounted,
    inside(
      bar,
      expect(button('Retry')).toBeEnabled(),
      expect(button('Play')).toBeAbsent(),
      expect(button('Pause')).toBeAbsent(),
      expect(role('status')).toBeAbsent(),
    ),
    click(button('Retry')),
    Command.resolve(
      WaitBeforeLoadTimeout,
      Message.CompletedWaitBeforeLoadTimeout({ playId: 99 }),
    ),
    inside(
      bar,
      expect(button('Retry')).toBeAbsent(),
      expect(button('Pause')).toBeEnabled(),
    ),
  )
})

test('an open player can always be closed, even after its video is gone', () => {
  scene(
    { update, view },
    given(
      after(
        fetched(a),
        Message.ClickedSong({ song: a }),
        reported(PlayerEvent.Ready()),
        Message.ClickedToggleExpanded(),
        reported(PlayerEvent.VideoGone()),
      ),
    ),
    playerMounted,
    inside(bar, expect(button('Collapse player')).toBeEnabled()),
  )
})

test('a player that is not open cannot be opened while its video cannot play', () => {
  scene(
    { update, view },
    given(
      after(
        fetched(a),
        Message.ClickedSong({ song: a }),
        reported(PlayerEvent.VideoGone()),
      ),
    ),
    playerMounted,
    inside(bar, expect(button('Expand player')).toBeDisabled()),
  )
})

const inStream = (id: string, timestamp: string): PlayableSong => ({
  ...makeSong(id),
  video_url: 'stream',
  timestamp,
})
const [first, second] = [
  inStream('first', '00:01:00'),
  inStream('second', '00:05:00'),
]
const firstLyricsFailed = Message.FailedFetchLyrics({
  songId: 'first',
  error: 'down',
})
const waitEnded = (waitId: number) =>
  Message.CompletedWaitBeforeRetryLyrics({ songId: 'first', waitId })
const singingFirst = [
  fetched(first, second),
  Message.ClickedSong({ song: first }),
  reported(PlayerEvent.Ready()),
  Message.ClickedToggleExpanded(),
  reported(PlayerEvent.Progressed({ seconds: 70 })),
  firstLyricsFailed,
]
const retryWaiting = selector('[data-lyrics-retry="Waiting"]')
const retryGaveUp = selector('[data-lyrics-retry="GaveUp"]')

test('failed lyrics show a retry on its way, with a button to retry now', () => {
  scene(
    { update, view },
    given(after(...singingFirst)),
    playerMounted,
    expect(retryWaiting).toExist(),
    expect(retryGaveUp).toBeAbsent(),
    inside(retryWaiting, expect(button('Try again')).toBeEnabled()),
  )
})

test('lyrics whose automatic retries ran out show that the radio gave up, and still offer a retry', () => {
  scene(
    { update, view },
    given(
      after(
        ...singingFirst,
        waitEnded(1),
        firstLyricsFailed,
        waitEnded(2),
        firstLyricsFailed,
        waitEnded(3),
        firstLyricsFailed,
      ),
    ),
    playerMounted,
    expect(retryGaveUp).toExist(),
    expect(retryWaiting).toBeAbsent(),
    inside(retryGaveUp, expect(button('Try again')).toBeEnabled()),
  )
})

const entryOf = (song: PlayableSong) => ({
  songId: song.id,
  videoUrl: song.video_url,
  timestamp: song.timestamp,
  title: song.song_title,
})

const playlistAB = Schema.decodeSync(Playlist)({
  id: 'Ab3dE5gH',
  name: 'Road trip',
  entries: [entryOf(a), entryOf(b)],
  version: 1,
  createdAt: 'x',
  updatedAt: 'x',
})

const askedAfter = (...setup: ReadonlyArray<Message>): Model =>
  after(
    fetched(a, b),
    ...setup,
    Message.OpenedPlaylist({
      id: playlistAB.id,
      maybeEditToken: Option.none(),
    }),
    Message.CompletedLoadSavedSetlist({ maybeJson: Option.none() }),
    Message.SucceededFetchPlaylist({ playlist: playlistAB }),
  )

const contextIs = (context: string) =>
  expect(selector(`[data-playlist-context="${context}"]`)).toExist()

test('the question says a song is playing when the queue is empty', () => {
  scene(
    { update, view },
    given(askedAfter(Message.ClickedSong({ song: a }))),
    playerMounted,
    contextIs('Playing'),
  )
})

test('the question says the queue has songs when nothing is playing', () => {
  scene(
    { update, view },
    given(askedAfter(Message.ClickedAddToQueue({ song: a }))),
    contextIs('Queued'),
  )
})

test('the question says both when a song plays over a queue', () => {
  scene(
    { update, view },
    given(
      askedAfter(
        Message.ClickedSong({ song: a }),
        Message.ClickedAddToQueue({ song: b }),
      ),
    ),
    playerMounted,
    contextIs('PlayingAndQueued'),
  )
})

const nothingToSave = selector('[data-playlist-problem="NothingToSave"]')

test('the save dialog tells a visitor with no songs to play or queue one first', () => {
  scene(
    { update, view },
    given(after(fetched(a, b), Message.ClickedSavePlaylist())),
    expect(nothingToSave).toExist(),
  )
})

test('the save dialog has no such hint once a song is queued', () => {
  scene(
    { update, view },
    given(
      after(
        fetched(a, b),
        Message.ClickedAddToQueue({ song: a }),
        Message.ClickedSavePlaylist(),
      ),
    ),
    expect(nothingToSave).toBeAbsent(),
  )
})
