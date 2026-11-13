import { DateTime } from 'effect'
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
