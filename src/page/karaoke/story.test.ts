import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { expect, test } from 'vitest'

import type { PlayableSong } from '../../domain.ts'
import { PlayerEvent } from '../../youtube'
import {
  ApplyPlayback,
  FetchSongs,
  LoadSavedSetlist,
  Message,
  type Model,
  SaveSetlist,
  entered,
  init,
  update,
} from './karaoke'
import { emptySetlist, restoreSaved } from './setlist.ts'

const makeSong = (id: string): PlayableSong => ({
  id,
  song_title: `Song ${id}`,
  timestamp: '00:01:00',
  created_at: 'x',
  video_url: `video-${id}`,
  title_text: 'Stream',
  membership: false,
})
const [a, b] = [makeSong('a'), makeSong('b')]
const saved = Command.resolve(SaveSetlist, Message.CompletedSaveSetlist())

const statusOf = (current: Model) =>
  Option.map(current.setlist.maybeNowPlaying, ({ status }) => status)

test('clicking a song plays it with no player Command, because mounting the player starts it', () => {
  story(
    update,
    given(init()),
    message(Message.ClickedSong({ song: a })),
    saved,
    model(current => {
      expect(statusOf(current)).toEqual(Option.some('Playing'))
    }),
  )
})

test('clicking the playing song pauses the real player', () => {
  story(
    update,
    given(init()),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(Message.ClickedSong({ song: a })),
    Command.resolve(ApplyPlayback, Message.CompletedApplyPlayback()),
    saved,
    model(current => {
      expect(statusOf(current)).toEqual(Option.some('Paused'))
    }),
  )
})

test('events from a replaced player are ignored, so a late end cannot skip a song', () => {
  story(
    update,
    given(init()),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(Message.ClickedSong({ song: b })),
    saved,
    message(
      Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Ended() }),
    ),
    model(current => {
      expect(
        Option.map(current.setlist.maybeNowPlaying, ({ song }) => song.id),
      ).toEqual(Option.some('b'))
    }),
  )
})

test('a player that reports its own pause changes the bar and sends nothing back', () => {
  story(
    update,
    given(init()),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(
      Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Paused() }),
    ),
    model(current => {
      expect(statusOf(current)).toEqual(Option.some('Paused'))
    }),
  )
})

test('an unavailable video pauses and says why, and the next song clears it', () => {
  story(
    update,
    given(init()),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(
      Message.ReceivedPlayerEvent({
        playId: 1,
        event: PlayerEvent.Failed({ reason: 'gone' }),
      }),
    ),
    model(current => {
      expect(statusOf(current)).toEqual(Option.some('Paused'))
      expect(
        Option.flatMap(
          current.setlist.maybeNowPlaying,
          ({ maybeLoadError }) => maybeLoadError,
        ),
      ).toEqual(Option.some('gone'))
    }),
    message(Message.ClickedSong({ song: b })),
    saved,
    model(current => {
      expect(
        Option.flatMap(
          current.setlist.maybeNowPlaying,
          ({ maybeLoadError }) => maybeLoadError,
        ),
      ).toEqual(Option.none())
    }),
  )
})

test('a failed fetch keeps data it already has and reports the error', () => {
  story(
    update,
    given(init()),
    message(Message.SucceededFetchSongs({ songs: [a] })),
    message(Message.FailedFetchSongs({ error: 'down' })),
    model(current => {
      expect(current.songs._tag).toBe('Stale')
    }),
  )
})

test('opening the page rereads saved data and fetches, and does not fetch twice', () => {
  const opened = entered(init())
  expect(opened.commands?.map(({ name }) => name)).toEqual([
    LoadSavedSetlist.name,
    FetchSongs.name,
  ])
  expect(entered(opened.model).commands?.map(({ name }) => name)).toEqual([
    LoadSavedSetlist.name,
  ])
})

test('a queue saved by the Next site still loads', () => {
  const nextSiteSave = JSON.stringify({
    state: { queue: [a], history: [b] },
    version: 0,
  })
  const restored = restoreSaved(emptySetlist, Option.some(nextSiteSave))
  expect(restored.queue).toEqual([a])
  expect(restored.history).toEqual([b])
})

test('corrupt saved data changes nothing', () => {
  const current = restoreSaved(emptySetlist, Option.some('not json'))
  expect(current).toEqual(emptySetlist)
})
