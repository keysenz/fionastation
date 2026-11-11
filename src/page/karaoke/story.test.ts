import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { expect, test } from 'vitest'

import type { PlayableSong } from '../../domain.ts'
import { LyricCursor, type Lyrics } from '../../lyrics.ts'
import { PlayerEvent } from '../../youtube'
import {
  ApplyPlayback,
  ApplyVolume,
  FetchLyrics,
  FetchSongs,
  FocusInfoButton,
  FocusInfoPanel,
  FocusQueueHandle,
  LoadAutoplay,
  LoadLyricNudges,
  LoadRepeat,
  LoadSavedSetlist,
  LoadVolume,
  Message,
  type Model,
  PickRandomVideo,
  STREAM_GONE,
  SaveAutoplay,
  SaveLyricNudges,
  SaveRepeat,
  SaveSetlist,
  SaveVolume,
  ScrollListToTop,
  ScrollSetlistToTop,
  SyncUrl,
  type UpdateReturn,
  WaitBeforeDismissToast,
  WaitBeforeRetryLyrics,
  entered,
  init,
  nowSingingOf,
  update,
} from './karaoke'
import { layersToUrl, parseLayers } from './layers.ts'
import {
  defaultVolume,
  emptySetlist,
  parseVolume,
  restoreSaved,
  toPersistedJson,
  toVolumeJson,
} from './setlist.ts'

const makeSong = (
  id: string,
  video = `video-${id}`,
  kind: PlayableSong['kind'] = 'karaoke',
): PlayableSong => ({
  id,
  song_title: `Song ${id}`,
  artist: '',
  original_title: '',
  timestamp: '00:01:00',
  created_at: 'x',
  video_url: video,
  title_text: 'Stream',
  membership: false,
  kind,
})
const [a, b] = [makeSong('a'), makeSong('b')]
const a2 = makeSong('a2', a.video_url)
const synced = Command.resolve(SyncUrl, Message.CompletedSyncUrl())
const saved = Command.resolve(SaveSetlist, Message.CompletedSaveSetlist())

const pickedFor = (
  song: PlayableSong,
  playId: number,
  cause: 'Ended' | 'Unavailable' = 'Unavailable',
) =>
  Command.resolveAll(
    [SaveSetlist, Message.CompletedSaveSetlist()],
    [
      PickRandomVideo,
      Message.CompletedPickRandomVideo({ playId, song, cause }),
    ],
  )

const failVideo = (playId: number) =>
  Message.ReceivedPlayerEvent({
    playId,
    event: PlayerEvent.VideoFailed({ reason: 'gone' }),
  })
const waited = (dismissId: number) =>
  Command.resolve(
    WaitBeforeDismissToast,
    Message.CompletedWaitBeforeDismissToast({ dismissId }),
  )
const toastOf = (current: Model) =>
  Option.getOrUndefined(current.maybeSkipToast)

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

const loadErrorOf = (current: Model) =>
  Option.flatMap(
    current.setlist.maybeNowPlaying,
    ({ maybeLoadError }) => maybeLoadError,
  )

const currentIdOf = (current: Model) =>
  Option.map(current.setlist.maybeNowPlaying, ({ song }) => song.id)

test('an unavailable video moves on to the first song of a random other video', () => {
  story(
    update,
    given(init()),
    message(
      Message.SucceededFetchSongs({ songs: [a, a2, b], goneVideoIds: [] }),
    ),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(failVideo(1)),
    pickedFor(b, 1),
    saved,
    waited(99),
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('b'))
      expect(statusOf(current)).toEqual(Option.some('Playing'))
      expect(loadErrorOf(current)).toEqual(Option.none())
      expect(current.setlist.history).toEqual([])
    }),
  )
})

test('the only video being unavailable pauses and says why', () => {
  story(
    update,
    given(init()),
    message(Message.SucceededFetchSongs({ songs: [b], goneVideoIds: [] })),
    message(Message.ClickedSong({ song: b })),
    saved,
    message(failVideo(1)),
    saved,
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('b'))
      expect(statusOf(current)).toEqual(Option.some('Paused'))
      expect(loadErrorOf(current)).toEqual(Option.some(STREAM_GONE))
    }),
  )
})

test('a player that cannot load pauses and says why, and skips nothing', () => {
  story(
    update,
    given(init()),
    message(Message.SucceededFetchSongs({ songs: [a, b], goneVideoIds: [] })),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(
      Message.ReceivedPlayerEvent({
        playId: 1,
        event: PlayerEvent.PlayerFailed({ reason: 'blocked' }),
      }),
    ),
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('a'))
      expect(statusOf(current)).toEqual(Option.some('Paused'))
      expect(loadErrorOf(current)).toEqual(Option.some('blocked'))
    }),
    message(Message.ClickedSong({ song: b })),
    saved,
    model(current => {
      expect(loadErrorOf(current)).toEqual(Option.none())
    }),
  )
})

test('a failed fetch keeps data it already has and reports the error', () => {
  story(
    update,
    given(init()),
    message(Message.SucceededFetchSongs({ songs: [a], goneVideoIds: [] })),
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
    LoadAutoplay.name,
    LoadRepeat.name,
    LoadVolume.name,
    LoadLyricNudges.name,
    FetchSongs.name,
  ])
  expect(entered(opened.model).commands?.map(({ name }) => name)).toEqual([
    LoadSavedSetlist.name,
    LoadAutoplay.name,
    LoadRepeat.name,
    LoadVolume.name,
    LoadLyricNudges.name,
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

test('a queue saved before songs had a kind restores as karaoke', () => {
  const { kind: _kind, ...withoutKind } = a
  const oldSave = JSON.stringify({
    state: { queue: [withoutKind], history: [] },
    version: 0,
  })
  const restored = restoreSaved(emptySetlist, Option.some(oldSave))
  expect(restored.queue).toEqual([{ ...withoutKind, kind: 'karaoke' }])
})

test('a saved cover keeps its kind', () => {
  const cover = makeSong('cover', 'cover-video', 'cover')
  const restored = restoreSaved(
    emptySetlist,
    Option.some(
      toPersistedJson({ ...emptySetlist, queue: [cover], history: [] }),
    ),
  )
  expect(restored.queue).toEqual([cover])
})

test('corrupt saved data changes nothing', () => {
  const current = restoreSaved(emptySetlist, Option.some('not json'))
  expect(current).toEqual(emptySetlist)
})

const c = makeSong('c')

test('a skipped video shows a toast naming the song and starts the dismiss timer', () => {
  story(
    update,
    given(init()),
    message(Message.SucceededFetchSongs({ songs: [a, b], goneVideoIds: [] })),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(failVideo(1)),
    pickedFor(b, 1),
    Command.resolveAll(
      [SaveSetlist, Message.CompletedSaveSetlist()],
      [
        WaitBeforeDismissToast,
        Message.CompletedWaitBeforeDismissToast({ dismissId: 99 }),
      ],
    ),
    model(current => {
      expect(toastOf(current)).toEqual({
        firstSkippedTitle: 'Song a',
        skippedCount: 1,
        dismissId: 2,
      })
    }),
  )
})

test('a second consecutive skip keeps the first title and counts two', () => {
  story(
    update,
    given(init()),
    message(
      Message.SucceededFetchSongs({ songs: [a, b, c], goneVideoIds: [] }),
    ),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(failVideo(1)),
    pickedFor(b, 1),
    saved,
    waited(99),
    message(failVideo(2)),
    pickedFor(c, 2),
    saved,
    waited(99),
    model(current => {
      expect(toastOf(current)).toEqual({
        firstSkippedTitle: 'Song a',
        skippedCount: 2,
        dismissId: 3,
      })
    }),
  )
})

test('a stale timer leaves a newer toast, and the matching timer clears it', () => {
  story(
    update,
    given(init()),
    message(
      Message.SucceededFetchSongs({ songs: [a, b, c], goneVideoIds: [] }),
    ),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(failVideo(1)),
    pickedFor(b, 1),
    saved,
    waited(99),
    message(failVideo(2)),
    pickedFor(c, 2),
    saved,
    waited(99),
    message(Message.CompletedWaitBeforeDismissToast({ dismissId: 2 })),
    model(current => {
      expect(toastOf(current)?.dismissId).toBe(3)
    }),
    message(Message.CompletedWaitBeforeDismissToast({ dismissId: 3 })),
    model(current => {
      expect(toastOf(current)).toBeUndefined()
    }),
  )
})

test('clicking dismiss clears the toast at once', () => {
  story(
    update,
    given(init()),
    message(Message.SucceededFetchSongs({ songs: [a, b], goneVideoIds: [] })),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(failVideo(1)),
    pickedFor(b, 1),
    saved,
    waited(99),
    message(Message.ClickedDismissToast()),
    model(current => {
      expect(toastOf(current)).toBeUndefined()
    }),
  )
})

test('an unavailable only video and a player that cannot load show no toast', () => {
  story(
    update,
    given(init()),
    message(Message.SucceededFetchSongs({ songs: [b], goneVideoIds: [] })),
    message(Message.ClickedSong({ song: b })),
    saved,
    message(failVideo(1)),
    saved,
    model(current => {
      expect(toastOf(current)).toBeUndefined()
    }),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(
      Message.ReceivedPlayerEvent({
        playId: 2,
        event: PlayerEvent.PlayerFailed({ reason: 'blocked' }),
      }),
    ),
    model(current => {
      expect(toastOf(current)).toBeUndefined()
    }),
  )
})

const savedAutoplay = Command.resolve(
  SaveAutoplay,
  Message.CompletedSaveAutoplay(),
)
const autoplayOff = [
  message(Message.ClickedToggleAutoplay()),
  savedAutoplay,
] as const

test('autoplay is on by default, and toggling it saves the choice', () => {
  expect(init().isAutoplay).toBe(true)
  story(
    update,
    given(init()),
    message(Message.ClickedToggleAutoplay()),
    savedAutoplay,
    model(current => {
      expect(current.isAutoplay).toBe(false)
    }),
    message(Message.ClickedToggleAutoplay()),
    savedAutoplay,
    model(current => {
      expect(current.isAutoplay).toBe(true)
    }),
  )
})

test('a saved off loads as off, and missing or corrupt data means on', () => {
  const loaded = (maybeValue: Option.Option<string>) =>
    update(
      { ...init(), isAutoplay: false },
      Message.CompletedLoadAutoplay({ maybeValue }),
    ).model.isAutoplay
  expect(loaded(Option.some('false'))).toBe(false)
  expect(loaded(Option.some('true'))).toBe(true)
  expect(loaded(Option.some('garbage'))).toBe(true)
  expect(loaded(Option.none())).toBe(true)
})

test('with autoplay off a video end stops on the same song, paused', () => {
  story(
    update,
    given(init()),
    message(Message.SucceededFetchSongs({ songs: [a, b], goneVideoIds: [] })),
    ...autoplayOff,
    message(Message.ClickedSong({ song: a })),
    saved,
    message(
      Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Ended() }),
    ),
    Command.resolve(ApplyPlayback, Message.CompletedApplyPlayback()),
    saved,
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('a'))
      expect(statusOf(current)).toEqual(Option.some('Paused'))
    }),
  )
})

test('with autoplay off the queue still plays at video end', () => {
  story(
    update,
    given(init()),
    message(
      Message.SucceededFetchSongs({ songs: [a, b, c], goneVideoIds: [] }),
    ),
    ...autoplayOff,
    message(Message.ClickedSong({ song: a })),
    saved,
    message(Message.ClickedAddToQueue({ song: c })),
    saved,
    message(
      Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Ended() }),
    ),
    saved,
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('c'))
      expect(statusOf(current)).toEqual(Option.some('Playing'))
    }),
  )
})

test('a failed video is remembered as gone, so its row disables at once', () => {
  story(
    update,
    given(init()),
    message(Message.SucceededFetchSongs({ songs: [a, b], goneVideoIds: [] })),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(failVideo(1)),
    pickedFor(b, 1),
    saved,
    waited(99),
    model(current => {
      expect(current.goneVideoIds).toEqual([a.video_url])
    }),
  )
})

test('a refetch adds to the gone videos known this session', () => {
  story(
    update,
    given(init()),
    message(Message.SucceededFetchSongs({ songs: [a], goneVideoIds: ['x'] })),
    message(
      Message.SucceededFetchSongs({ songs: [a], goneVideoIds: ['y', 'x'] }),
    ),
    model(current => {
      expect([...current.goneVideoIds].sort()).toEqual(['x', 'y'])
    }),
  )
})

test('with autoplay off a failed video stays, says why, and shows no toast', () => {
  story(
    update,
    given(init()),
    message(Message.SucceededFetchSongs({ songs: [a, b], goneVideoIds: [] })),
    ...autoplayOff,
    message(Message.ClickedSong({ song: a })),
    saved,
    message(failVideo(1)),
    saved,
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('a'))
      expect(statusOf(current)).toEqual(Option.some('Paused'))
      expect(loadErrorOf(current)).toEqual(Option.some(STREAM_GONE))
      expect(toastOf(current)).toBeUndefined()
    }),
  )
})

test('a queued gone song is skipped with a toast naming it', () => {
  story(
    update,
    given(init()),
    message(
      Message.SucceededFetchSongs({
        songs: [a, b, c],
        goneVideoIds: [b.video_url],
      }),
    ),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(Message.ClickedAddToQueue({ song: b })),
    saved,
    message(Message.ClickedNext()),
    saved,
    message(failVideo(2)),
    pickedFor(c, 2),
    Command.resolveAll(
      [SaveSetlist, Message.CompletedSaveSetlist()],
      [
        WaitBeforeDismissToast,
        Message.CompletedWaitBeforeDismissToast({ dismissId: 99 }),
      ],
    ),
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('c'))
      expect(toastOf(current)?.firstSkippedTitle).toBe('Song b')
    }),
  )
})

const archive = [a, a2, b, c]
const d = makeSong('d', c.video_url)

const playing = (...messages: ReadonlyArray<Message>) =>
  [
    Message.SucceededFetchSongs({ songs: [...archive, d], goneVideoIds: [] }),
    ...messages,
  ].reduce<UpdateReturn>((previous, next) => update(previous.model, next), {
    model: init(),
  })

test('the next song of the same video plays at the end, with no random pick', () => {
  story(
    update,
    given(init()),
    message(
      Message.SucceededFetchSongs({ songs: [a, a2, b], goneVideoIds: [] }),
    ),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(
      Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Ended() }),
    ),
    saved,
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('a2'))
      expect(statusOf(current)).toEqual(Option.some('Playing'))
    }),
  )
})

test('the end of a video asks for a random video, among the first songs of other live videos', () => {
  const ended = playing(
    Message.ClickedSong({ song: a2 }),
    Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Ended() }),
  )
  expect(ended.commands?.map(({ name }) => name)).toEqual([
    PickRandomVideo.name,
  ])
  expect(ended.commands?.[0]?.args?.['candidates']).toEqual([b, c])
})

test('a cover ending with autoplay on plays the queue, or else asks for a random video that may be a cover', () => {
  const cover = makeSong('cover', 'cover-video', 'cover')
  const original = makeSong('original', 'original-video', 'original')
  const withCover = (...messages: ReadonlyArray<Message>) =>
    [
      Message.SucceededFetchSongs({
        songs: [cover, original, a],
        goneVideoIds: [],
      }),
      Message.ClickedSong({ song: cover }),
      ...messages,
    ].reduce<UpdateReturn>((previous, next) => update(previous.model, next), {
      model: init(),
    })
  const ended = Message.ReceivedPlayerEvent({
    playId: 1,
    event: PlayerEvent.Ended(),
  })

  const random = withCover(ended)
  expect(random.commands?.map(({ name }) => name)).toEqual([
    PickRandomVideo.name,
  ])
  expect(random.commands?.[0]?.args?.['candidates']).toEqual([original, a])

  const queued = withCover(Message.ClickedAddToQueue({ song: b }), ended)
  expect(currentIdOf(queued.model)).toEqual(Option.some('b'))
})

test('the random pick leaves out a gone video', () => {
  const ended = update(
    playing(Message.ClickedSong({ song: a2 })).model,
    Message.SucceededFetchSongs({
      songs: [...archive, d],
      goneVideoIds: [b.video_url],
    }),
  )
  const asked = update(
    ended.model,
    Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Ended() }),
  )
  expect(asked.commands?.[0]?.args?.['candidates']).toEqual([c])
})

test('a finished random pick plays the first song of the video, and records history', () => {
  story(
    update,
    given(init()),
    message(Message.SucceededFetchSongs({ songs: archive, goneVideoIds: [] })),
    message(Message.ClickedSong({ song: a2 })),
    saved,
    message(
      Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Ended() }),
    ),
    pickedFor(b, 1, 'Ended'),
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('b'))
      expect(statusOf(current)).toEqual(Option.some('Playing'))
      expect(current.setlist.history).toEqual([a2])
      expect(toastOf(current)).toBeUndefined()
    }),
  )
})

test('a pick that finishes after the visitor chose another song is ignored', () => {
  const chosen = playing(
    Message.ClickedSong({ song: a2 }),
    Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Ended() }),
    Message.ClickedSong({ song: c }),
  )
  const late = update(
    chosen.model,
    Message.CompletedPickRandomVideo({ playId: 1, song: b, cause: 'Ended' }),
  )
  expect(currentIdOf(late.model)).toEqual(Option.some('c'))
  expect(late.model.setlist).toEqual(chosen.model.setlist)
  expect(late.commands).toBeUndefined()
})

test('with autoplay off the end of a video never asks for a random video', () => {
  story(
    update,
    given(init()),
    message(Message.SucceededFetchSongs({ songs: archive, goneVideoIds: [] })),
    ...autoplayOff,
    message(Message.ClickedSong({ song: a2 })),
    saved,
    message(
      Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Ended() }),
    ),
    Command.resolve(ApplyPlayback, Message.CompletedApplyPlayback()),
    saved,
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('a2'))
      expect(statusOf(current)).toEqual(Option.some('Paused'))
    }),
  )
})

test('the end of the only live video pauses the same song', () => {
  story(
    update,
    given(init()),
    message(
      Message.SucceededFetchSongs({
        songs: archive,
        goneVideoIds: [b.video_url, c.video_url],
      }),
    ),
    message(Message.ClickedSong({ song: a2 })),
    saved,
    message(
      Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Ended() }),
    ),
    Command.resolve(ApplyPlayback, Message.CompletedApplyPlayback()),
    saved,
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('a2'))
      expect(statusOf(current)).toEqual(Option.some('Paused'))
    }),
  )
})

test('a dead video asks for a random other video even when it has later songs', () => {
  const failed = update(
    playing(Message.ClickedSong({ song: a })).model,
    failVideo(1),
  )
  expect(failed.commands?.map(({ name }) => name)).toEqual([
    SaveSetlist.name,
    PickRandomVideo.name,
  ])
  expect(failed.commands?.[1]?.args?.['candidates']).toEqual([b, c])
})

test('a finished pick after a dead video shows the toast for the new play and keeps history clean', () => {
  story(
    update,
    given(init()),
    message(Message.SucceededFetchSongs({ songs: archive, goneVideoIds: [] })),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(failVideo(1)),
    pickedFor(c, 1),
    saved,
    waited(99),
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('c'))
      expect(current.setlist.history).toEqual([])
      expect(toastOf(current)).toEqual({
        firstSkippedTitle: 'Song a',
        skippedCount: 1,
        dismissId: 2,
      })
    }),
  )
})

test('clicking a video selects it and scrolls its setlist to the top, and Back returns to the list', () => {
  story(
    update,
    given(init()),
    message(Message.ClickedVideo({ videoId: 'v1' })),
    Command.expectHas(ScrollSetlistToTop, SyncUrl),
    Command.resolve(ScrollSetlistToTop, Message.CompletedScrollSetlistToTop()),
    synced,
    message(Message.ClickedVideo({ videoId: 'v2' })),
    Command.resolve(ScrollSetlistToTop, Message.CompletedScrollSetlistToTop()),
    synced,
    model(current => {
      expect(current.maybeSelectedVideoId).toEqual(Option.some('v2'))
    }),
    message(Message.ClickedBackToVideos()),
    synced,
    model(current => {
      expect(current.maybeSelectedVideoId).toEqual(Option.none())
    }),
  )
})

test('searching keeps the chosen video, so clearing the search restores it', () => {
  story(
    update,
    given(init()),
    message(Message.ClickedVideo({ videoId: 'v1' })),
    Command.resolve(ScrollSetlistToTop, Message.CompletedScrollSetlistToTop()),
    synced,
    message(Message.UpdatedSearch({ value: 'tabako' })),
    Command.resolve(ScrollListToTop, Message.CompletedScrollListToTop()),
    Command.resolve(ScrollSetlistToTop, Message.CompletedScrollSetlistToTop()),
    message(Message.UpdatedSearch({ value: '' })),
    model(current => {
      expect(current.maybeSelectedVideoId).toEqual(Option.some('v1'))
    }),
  )
})

test('a search scrolls the list back to its first video, and clearing it does not', () => {
  story(
    update,
    given(init()),
    message(Message.UpdatedSearch({ value: 'satu' })),
    Command.expectHas(ScrollListToTop, ScrollSetlistToTop),
    Command.resolve(ScrollListToTop, Message.CompletedScrollListToTop()),
    Command.resolve(ScrollSetlistToTop, Message.CompletedScrollSetlistToTop()),
    message(Message.UpdatedSearch({ value: '' })),
    Command.expectNone(),
  )
})

const queueOf = (current: Model) => current.setlist.queue.map(song => song.id)

const withQueue = [
  message(Message.SucceededFetchSongs({ songs: [a, b, c], goneVideoIds: [] })),
  message(Message.ClickedAddToQueue({ song: a })),
  saved,
  message(Message.ClickedAddToQueue({ song: b })),
  saved,
  message(Message.ClickedAddToQueue({ song: c })),
  saved,
]

test('dropping the first queued song on the third slot reorders and saves', () => {
  story(
    update,
    given(init()),
    ...withQueue,
    message(Message.StartedQueueDrag({ index: 0 })),
    message(Message.DraggedOverQueueSlot({ index: 2 })),
    model(current => {
      expect(current.maybeQueueDrag).toEqual(
        Option.some({ from: 0, over: 2, startQueueIds: ['a', 'b', 'c'] }),
      )
    }),
    message(Message.DroppedQueueSong({ index: 2 })),
    saved,
    model(current => {
      expect(queueOf(current)).toEqual(['b', 'c', 'a'])
      expect(current.maybeQueueDrag).toEqual(Option.none())
    }),
  )
})

test('moving the last queued song down and the first up change nothing', () => {
  story(
    update,
    given(init()),
    ...withQueue,
    message(Message.PressedQueueMoveKey({ index: 2, by: 1 })),
    message(Message.PressedQueueMoveKey({ index: 0, by: -1 })),
    model(current => {
      expect(queueOf(current)).toEqual(['a', 'b', 'c'])
    }),
  )
})

test('the move key moves a queued song one place and saves', () => {
  story(
    update,
    given(init()),
    ...withQueue,
    message(Message.PressedQueueMoveKey({ index: 2, by: -1 })),
    Command.resolveAll(
      [SaveSetlist, Message.CompletedSaveSetlist()],
      [FocusQueueHandle, Message.CompletedFocusQueueHandle()],
    ),
    model(current => {
      expect(queueOf(current)).toEqual(['a', 'c', 'b'])
    }),
  )
})

test('a drop after the queue changed under the drag moves nothing', () => {
  story(
    update,
    given(init()),
    ...withQueue,
    message(Message.StartedQueueDrag({ index: 0 })),
    message(Message.DraggedOverQueueSlot({ index: 1 })),
    message(Message.ClickedNext()),
    saved,
    message(Message.DroppedQueueSong({ index: 1 })),
    model(current => {
      expect(queueOf(current)).toEqual(['b', 'c'])
      expect(current.maybeQueueDrag).toEqual(Option.none())
    }),
  )
})

test('ending a drag without a drop leaves the queue unchanged', () => {
  story(
    update,
    given(init()),
    ...withQueue,
    message(Message.StartedQueueDrag({ index: 0 })),
    message(Message.DraggedOverQueueSlot({ index: 2 })),
    message(Message.EndedQueueDrag()),
    model(current => {
      expect(queueOf(current)).toEqual(['a', 'b', 'c'])
      expect(current.maybeQueueDrag).toEqual(Option.none())
    }),
  )
})

test('the info button opens the panel and moves focus into it', () => {
  story(
    update,
    given(init()),
    message(Message.ClickedToggleInfo()),
    Command.resolve(FocusInfoPanel, Message.CompletedFocusInfoPanel()),
    synced,
    model(current => {
      expect(current.isInfoOpen).toBe(true)
    }),
  )
})

test('the info button closes the panel and returns focus to itself', () => {
  story(
    update,
    given(init()),
    message(Message.ClickedToggleInfo()),
    Command.resolve(FocusInfoPanel, Message.CompletedFocusInfoPanel()),
    synced,
    message(Message.ClickedToggleInfo()),
    Command.resolve(FocusInfoButton, Message.CompletedFocusInfoButton()),
    synced,
    model(current => {
      expect(current.isInfoOpen).toBe(false)
    }),
  )
})

test('the close message, sent by Escape, the Close button and the backdrop, closes the panel and refocuses the button', () => {
  story(
    update,
    given({ ...init(), isInfoOpen: true }),
    message(Message.ClickedCloseInfo()),
    Command.resolve(FocusInfoButton, Message.CompletedFocusInfoButton()),
    synced,
    model(current => {
      expect(current.isInfoOpen).toBe(false)
    }),
  )
})

test('closing an already closed panel issues no focus Command', () => {
  story(
    update,
    given(init()),
    message(Message.ClickedCloseInfo()),
    model(current => {
      expect(current.isInfoOpen).toBe(false)
    }),
  )
})

test('removing a queued song drops that one and saves', () => {
  story(
    update,
    given(init()),
    ...withQueue,
    message(Message.ClickedRemoveFromQueue({ index: 1 })),
    saved,
    model(current => {
      expect(queueOf(current)).toEqual(['a', 'c'])
    }),
  )
})

test('playing a queued song starts it, takes it out of the queue and moves the current song to history', () => {
  story(
    update,
    given(init()),
    ...withQueue,
    message(Message.ClickedSong({ song: a2 })),
    saved,
    message(Message.ClickedQueuedSong({ index: 2 })),
    saved,
    model(current => {
      expect(queueOf(current)).toEqual(['a', 'b'])
      expect(
        Option.map(current.setlist.maybeNowPlaying, ({ song }) => song.id),
      ).toEqual(Option.some('c'))
      expect(current.setlist.history.map(song => song.id)).toEqual(['a2'])
    }),
  )
})

test('removing or playing a queue slot that does not exist changes nothing and saves nothing', () => {
  story(
    update,
    given(init()),
    ...withQueue,
    message(Message.ClickedRemoveFromQueue({ index: 3 })),
    message(Message.ClickedRemoveFromQueue({ index: -1 })),
    message(Message.ClickedQueuedSong({ index: 3 })),
    Command.expectNone(),
    model(current => {
      expect(queueOf(current)).toEqual(['a', 'b', 'c'])
      expect(current.setlist.maybeNowPlaying).toEqual(Option.none())
    }),
  )
})

test('queueing the history appends it oldest first and saves, and an empty history changes nothing', () => {
  story(
    update,
    given(init()),
    message(Message.ClickedQueueHistory()),
    Command.expectNone(),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(Message.ClickedSong({ song: b })),
    saved,
    message(Message.ClickedSong({ song: a2 })),
    saved,
    message(Message.ClickedQueueHistory()),
    saved,
    model(current => {
      expect(queueOf(current)).toEqual(['a', 'b'])
    }),
  )
})

const savedRepeat = Command.resolve(SaveRepeat, Message.CompletedSaveRepeat())
const endOf = (playId: number) =>
  Message.ReceivedPlayerEvent({ playId, event: PlayerEvent.Ended() })
const playIdOf = (current: Model) =>
  Option.map(current.setlist.maybeNowPlaying, ({ playId }) => playId)
const withRepeat = (steps: number) => [
  ...Array.from({ length: steps }, () => [
    message(Message.ClickedCycleRepeat()),
    savedRepeat,
  ]).flat(),
]

test('repeat starts Off, cycles Off, All, One, Off and saves each choice', () => {
  expect(init().repeat).toBe('Off')
  story(
    update,
    given(init()),
    message(Message.ClickedCycleRepeat()),
    savedRepeat,
    model(current => expect(current.repeat).toBe('All')),
    message(Message.ClickedCycleRepeat()),
    savedRepeat,
    model(current => expect(current.repeat).toBe('One')),
    message(Message.ClickedCycleRepeat()),
    savedRepeat,
    model(current => expect(current.repeat).toBe('Off')),
  )
})

test('a saved repeat mode loads, and missing or corrupt data means Off', () => {
  const loaded = (maybeValue: Option.Option<string>) =>
    update(init(), Message.CompletedLoadRepeat({ maybeValue })).model.repeat
  expect(loaded(Option.some('All'))).toBe('All')
  expect(loaded(Option.some('One'))).toBe('One')
  expect(loaded(Option.some('garbage'))).toBe('Off')
  expect(loaded(Option.none())).toBe('Off')
})

test('repeat One restarts the ended song with a new player, ignoring the queue and autoplay', () => {
  story(
    update,
    given(init()),
    message(
      Message.SucceededFetchSongs({ songs: [a, b, c], goneVideoIds: [] }),
    ),
    ...autoplayOff,
    ...withRepeat(2),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(Message.ClickedAddToQueue({ song: c })),
    saved,
    message(endOf(1)),
    saved,
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('a'))
      expect(playIdOf(current)).toEqual(Option.some(2))
      expect(queueOf(current)).toEqual(['c'])
      expect(current.setlist.history).toEqual([])
    }),
  )
})

test('repeat All sends the ended song to the end of the queue and plays the head', () => {
  story(
    update,
    given(init()),
    message(
      Message.SucceededFetchSongs({ songs: [a, b, c], goneVideoIds: [] }),
    ),
    ...withRepeat(1),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(Message.ClickedAddToQueue({ song: b })),
    saved,
    message(Message.ClickedAddToQueue({ song: c })),
    saved,
    message(endOf(1)),
    saved,
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('b'))
      expect(queueOf(current)).toEqual(['c', 'a'])
    }),
  )
})

test('repeat All with an empty queue replays the ended song, even with autoplay off', () => {
  story(
    update,
    given(init()),
    message(Message.SucceededFetchSongs({ songs: [a, b], goneVideoIds: [] })),
    ...autoplayOff,
    ...withRepeat(1),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(endOf(1)),
    saved,
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('a'))
      expect(playIdOf(current)).toEqual(Option.some(2))
      expect(queueOf(current)).toEqual([])
    }),
  )
})

test('Next under repeat All also sends the current song to the end of the queue', () => {
  story(
    update,
    given(init()),
    ...withRepeat(1),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(Message.ClickedAddToQueue({ song: b })),
    saved,
    message(Message.ClickedNext()),
    saved,
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('b'))
      expect(queueOf(current)).toEqual(['a'])
    }),
  )
})

test('Next under repeat One still moves to the queue head and does not requeue', () => {
  story(
    update,
    given(init()),
    ...withRepeat(2),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(Message.ClickedAddToQueue({ song: b })),
    saved,
    message(Message.ClickedNext()),
    saved,
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('b'))
      expect(queueOf(current)).toEqual([])
    }),
  )
})

const syncOf = (result: UpdateReturn) =>
  result.commands?.find(({ name }) => name === SyncUrl.name)?.args

const run = (
  start: Model,
  messages: ReadonlyArray<Message>,
): ReadonlyArray<unknown> => {
  let current = start
  return messages.map(next => {
    const result = update(current, next)
    current = result.model
    return syncOf(result)
  })
}

test('layers read from and write to the address, in a fixed order', () => {
  expect(layersToUrl(parseLayers(''))).toBe('/')
  expect(layersToUrl(parseLayers('?v=abc&o=player,queue'))).toBe(
    '/?v=abc&o=queue%2Cplayer',
  )
  expect(parseLayers('?o=nonsense,info').overlays).toEqual(['info'])
  expect(parseLayers('?v=').maybeVideoId).toEqual(Option.none())
})

test('opening a layer asks to push its address, and closing asks to pop it', () => {
  expect(
    run(init(), [
      Message.ClickedQueueHandle(),
      Message.ClickedToggleExpanded(),
      Message.ClickedCollapse(),
      Message.ClickedQueueHandle(),
    ]),
  ).toEqual([
    { url: '/?o=queue', change: 'OpenOverlay' },
    { url: '/?o=queue%2Cplayer', change: 'OpenOverlay' },
    { url: '/?o=queue', change: 'Close' },
    { url: '/', change: 'Close' },
  ])
})

test('selecting a video pushes, choosing another replaces, and the list closes it', () => {
  expect(
    run(init(), [
      Message.ClickedVideo({ videoId: 'v1' }),
      Message.ClickedVideo({ videoId: 'v2' }),
      Message.ClickedBackToVideos(),
    ]),
  ).toEqual([
    { url: '/?v=v1', change: 'OpenVideo' },
    { url: '/?v=v2', change: 'Replace' },
    { url: '/', change: 'Close' },
  ])
})

test('an address change closes the layers it drops, and needs no URL command', () => {
  story(
    update,
    given({
      ...init(),
      isQueueOpen: true,
      isExpanded: true,
      maybeSelectedVideoId: Option.some('v1'),
    }),
    message(Message.ChangedLayers({ search: '?v=v1&o=queue' })),
    Command.expectNone(),
    model(current => {
      expect(current.isExpanded).toBe(false)
      expect(current.isQueueOpen).toBe(true)
    }),
    message(Message.ChangedLayers({ search: '' })),
    Command.expectNone(),
    model(current => {
      expect(current.isQueueOpen).toBe(false)
      expect(current.maybeSelectedVideoId).toEqual(Option.none())
    }),
  )
})

test('opening a direct link keeps the video, drops the overlays and repairs the address', () => {
  const result = update(
    init(),
    Message.OpenedFromUrl({ search: '?v=v1&o=player' }),
  )
  expect(syncOf(result)).toEqual({ url: '/?v=v1', change: 'Replace' })
  expect(result.model.maybeSelectedVideoId).toEqual(Option.some('v1'))
  expect(result.model.isExpanded).toBe(false)
  expect(
    syncOf(update(init(), Message.OpenedFromUrl({ search: '?v=v1' }))),
  ).toBeUndefined()
})

const volumeChanged = [
  Command.resolve(ApplyVolume, Message.CompletedApplyVolume()),
  Command.resolve(SaveVolume, Message.CompletedSaveVolume()),
] as const

test('volume starts at 100 and unmuted', () => {
  expect(init().volume).toEqual({ level: 100, isMuted: false })
})

test('the slider sets and clamps the level, applies it to the player and saves it', () => {
  story(
    update,
    given(init()),
    message(Message.ChangedVolume({ level: 40 })),
    ...volumeChanged,
    model(current =>
      expect(current.volume).toEqual({ level: 40, isMuted: false }),
    ),
    message(Message.ChangedVolume({ level: 250 })),
    ...volumeChanged,
    model(current => expect(current.volume.level).toBe(100)),
    message(Message.ChangedVolume({ level: -5 })),
    ...volumeChanged,
    model(current => expect(current.volume.level).toBe(0)),
  )
})

test('mute keeps the level, the slider above 0 unmutes, and 0 stays muted', () => {
  story(
    update,
    given(init()),
    message(Message.ChangedVolume({ level: 30 })),
    ...volumeChanged,
    message(Message.ClickedToggleMute()),
    ...volumeChanged,
    model(current =>
      expect(current.volume).toEqual({ level: 30, isMuted: true }),
    ),
    message(Message.ChangedVolume({ level: 0 })),
    ...volumeChanged,
    model(current =>
      expect(current.volume).toEqual({ level: 0, isMuted: true }),
    ),
    message(Message.ChangedVolume({ level: 20 })),
    ...volumeChanged,
    model(current =>
      expect(current.volume).toEqual({ level: 20, isMuted: false }),
    ),
  )
})

test('unmuting from level 0 goes to a middle level, so it is not still silent', () => {
  story(
    update,
    given({ ...init(), volume: { level: 0, isMuted: false } }),
    message(Message.ClickedToggleMute()),
    ...volumeChanged,
    model(current =>
      expect(current.volume).toEqual({ level: 50, isMuted: false }),
    ),
  )
})

test('a ready player gets the volume, so each new song keeps the level', () => {
  story(
    update,
    given({
      ...init(),
      volume: { level: 35, isMuted: true },
    }),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(
      Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Ready() }),
    ),
    Command.expectExact(ApplyVolume),
    Command.resolve(ApplyVolume, Message.CompletedApplyVolume()),
  )
})

test('a pause pressed while the video loads reaches the player once it is ready', () => {
  story(
    update,
    given(init()),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(Message.ClickedPlayPause()),
    saved,
    Command.resolve(ApplyPlayback, Message.CompletedApplyPlayback()),
    message(
      Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Ready() }),
    ),
    Command.expectExact(ApplyPlayback, ApplyVolume),
    Command.resolve(ApplyPlayback, Message.CompletedApplyPlayback()),
    Command.resolve(ApplyVolume, Message.CompletedApplyVolume()),
  )
})

test('saved volume round trips, and missing, corrupt or out of range data is clamped or defaulted', () => {
  const saved = { level: 42, isMuted: true }
  expect(parseVolume(Option.some(toVolumeJson(saved)))).toEqual(saved)
  expect(parseVolume(Option.none())).toEqual(defaultVolume)
  expect(parseVolume(Option.some('garbage'))).toEqual(defaultVolume)
  expect(parseVolume(Option.some('{"level":"loud","isMuted":false}'))).toEqual(
    defaultVolume,
  )
  expect(parseVolume(Option.some('{"level":900,"isMuted":false}')).level).toBe(
    100,
  )
  expect(parseVolume(Option.some('{"level":-3,"isMuted":false}')).level).toBe(0)
  const loaded = update(
    init(),
    Message.CompletedLoadVolume({
      maybeValue: Option.some(toVolumeJson(saved)),
    }),
  )
  expect(loaded.model.volume).toEqual(saved)
})

const lyricSong = (id: string, timestamp: string): PlayableSong => ({
  ...makeSong(id, 'stream'),
  timestamp,
})
const [early, late] = [
  lyricSong('early', '00:01:00'),
  lyricSong('late', '00:05:00'),
]

const playingStream = (): Model => {
  const fetched = update(
    init(),
    Message.SucceededFetchSongs({ songs: [early, late], goneVideoIds: [] }),
  ).model
  return update(fetched, Message.ClickedSong({ song: early })).model
}

const tick = (current: Model, seconds: number, playId = 1): UpdateReturn =>
  update(
    current,
    Message.ReceivedPlayerEvent({
      playId,
      event: PlayerEvent.Progressed({ seconds }),
    }),
  )

const fetchedIds = (result: UpdateReturn) =>
  result.commands
    ?.filter(({ name }) => name === FetchLyrics.name)
    .map(({ args }) => args?.['songId'])

const singingId = (current: Model) =>
  Option.map(nowSingingOf(current), ({ segment }) => segment.song.id)

const cursorOf = (current: Model) =>
  Option.flatMap(nowSingingOf(current), ({ maybeCursor }) => maybeCursor)

const threeLines: Lyrics = {
  _tag: 'Synced',
  lines: [
    { atMs: 0, text: 'one' },
    { atMs: 10000, text: 'two' },
    { atMs: 20000, text: 'three' },
  ],
  offsetMs: 0,
  credit: { lrclibId: 1, track: 'T', artist: 'A' },
}

test('a position report from another play changes nothing', () => {
  const stale = tick(playingStream(), 100, 99)
  expect(stale.model.maybePlayhead).toEqual(Option.none())
  expect(stale.commands).toBeUndefined()
})

test("the first position inside a song fetches its lyrics and the next song's, and later ticks fetch nothing", () => {
  const first = tick(playingStream(), 70)
  expect(fetchedIds(first)).toEqual(['early', 'late'])
  const second = tick(first.model, 72)
  expect(fetchedIds(second)).toEqual([])
  expect(second.model.maybePlayhead).toEqual(
    Option.some({ playId: 1, seconds: 72 }),
  )
})

test('a position before the first song fetches nothing and sings nothing', () => {
  const before = tick(playingStream(), 30)
  expect(before.commands).toBeUndefined()
  expect(singingId(before.model)).toEqual(Option.none())
})

test('crossing a timestamp switches the song being sung', () => {
  const inFirst = tick(playingStream(), 70).model
  expect(singingId(inFirst)).toEqual(Option.some('early'))
  const inSecond = tick(inFirst, 310)
  expect(singingId(inSecond.model)).toEqual(Option.some('late'))
  expect(fetchedIds(inSecond)).toEqual([])
})

test('lyrics that arrive put the cursor on the line being sung, and a nudge moves it', () => {
  const beforeLyrics = tick(playingStream(), 72).model
  expect(cursorOf(beforeLyrics)).toEqual(Option.none())
  const received = update(
    beforeLyrics,
    Message.SucceededFetchLyrics({ songId: 'early', lyrics: threeLines }),
  ).model
  expect(cursorOf(received)).toEqual(
    Option.some(LyricCursor.OnLine({ index: 1 })),
  )
  const atTwenty = tick(received, 80.2).model
  expect(cursorOf(atTwenty)).toEqual(
    Option.some(LyricCursor.OnLine({ index: 2 })),
  )
  const nudgedLater = update(
    atTwenty,
    Message.ClickedNudgeLyrics({ songId: 'early', by: 1 }),
  ).model
  expect(cursorOf(nudgedLater)).toEqual(
    Option.some(LyricCursor.OnLine({ index: 1 })),
  )
})

test('nudging saves the new nudges, and reset removes them', () => {
  const nudged = update(
    init(),
    Message.ClickedNudgeLyrics({ songId: 'early', by: 1 }),
  )
  expect(nudged.commands?.map(({ name }) => name)).toEqual([
    SaveLyricNudges.name,
  ])
  expect(nudged.commands?.[0]?.args?.['json']).toBe('{"early":1}')
  const reset = update(
    nudged.model,
    Message.ClickedResetLyricsNudge({ songId: 'early' }),
  )
  expect(reset.model.lyricNudges).toEqual({})
  expect(reset.commands?.[0]?.args?.['json']).toBe('{}')
})

test('saved nudges load, and garbage loads as none', () => {
  const loaded = update(
    init(),
    Message.CompletedLoadLyricNudges({
      maybeJson: Option.some('{"early":-3}'),
    }),
  )
  expect(loaded.model.lyricNudges).toEqual({ early: -3 })
  const garbage = update(
    loaded.model,
    Message.CompletedLoadLyricNudges({ maybeJson: Option.some('}{') }),
  )
  expect(garbage.model.lyricNudges).toEqual({})
})

test('retrying failed lyrics fetches again, and retrying anything else does nothing', () => {
  const failed = update(
    tick(playingStream(), 70).model,
    Message.FailedFetchLyrics({ songId: 'early', error: 'down' }),
  ).model
  expect(failed.lyricsBySongId['early']?._tag).toBe('Failure')
  const retried = update(
    failed,
    Message.ClickedRetryLyrics({ songId: 'early' }),
  )
  expect(fetchedIds(retried)).toEqual(['early'])
  expect(retried.model.lyricsBySongId['early']?._tag).toBe('Loading')
  expect(
    update(retried.model, Message.ClickedRetryLyrics({ songId: 'early' }))
      .commands,
  ).toBeUndefined()
})

const failedSinging = (): Model =>
  update(
    tick(playingStream(), 70).model,
    Message.FailedFetchLyrics({ songId: 'early', error: 'down' }),
  ).model

test('a failed fetch schedules a delayed retry', () => {
  const failed = update(
    tick(playingStream(), 70).model,
    Message.FailedFetchLyrics({ songId: 'early', error: 'down' }),
  )
  expect(failed.commands?.map(({ name }) => name)).toEqual([
    WaitBeforeRetryLyrics.name,
  ])
  expect(failed.commands?.[0]?.args?.['songId']).toBe('early')
})

test('the delayed retry fetches again while the song is still failed and current', () => {
  const retried = update(
    failedSinging(),
    Message.ElapsedLyricsRetryDelay({ songId: 'early' }),
  )
  expect(fetchedIds(retried)).toEqual(['early'])
  expect(retried.model.lyricsBySongId['early']?._tag).toBe('Loading')
})

test('the delayed retry also covers the next song', () => {
  const failed = update(
    tick(playingStream(), 70).model,
    Message.FailedFetchLyrics({ songId: 'late', error: 'down' }),
  ).model
  expect(
    fetchedIds(
      update(failed, Message.ElapsedLyricsRetryDelay({ songId: 'late' })),
    ),
  ).toEqual(['late'])
})

test('the delayed retry does nothing once the lyrics arrived', () => {
  const arrived = update(
    failedSinging(),
    Message.SucceededFetchLyrics({ songId: 'early', lyrics: threeLines }),
  ).model
  const elapsed = update(
    arrived,
    Message.ElapsedLyricsRetryDelay({ songId: 'early' }),
  )
  expect(elapsed.commands).toBeUndefined()
  expect(elapsed.model.lyricsBySongId['early']?._tag).toBe('Success')
})

test('the delayed retry does nothing once the song is no longer current or next', () => {
  const moved = tick(failedSinging(), 400).model
  expect(singingId(moved)).toEqual(Option.some('late'))
  expect(
    update(moved, Message.ElapsedLyricsRetryDelay({ songId: 'early' }))
      .commands,
  ).toBeUndefined()
})

test('automatic retries stop after three, and a manual retry starts the count again', () => {
  let current = failedSinging()
  for (let round = 1; round <= 3; round++) {
    const retried = update(
      current,
      Message.ElapsedLyricsRetryDelay({ songId: 'early' }),
    )
    expect(fetchedIds(retried)).toEqual(['early'])
    current = update(
      retried.model,
      Message.FailedFetchLyrics({ songId: 'early', error: 'down' }),
    ).model
  }
  const capped = update(
    current,
    Message.FailedFetchLyrics({ songId: 'early', error: 'down' }),
  )
  expect(capped.commands).toEqual([])
  const manual = update(
    capped.model,
    Message.ClickedRetryLyrics({ songId: 'early' }),
  )
  const failedAgain = update(
    manual.model,
    Message.FailedFetchLyrics({ songId: 'early', error: 'down' }),
  )
  expect(failedAgain.commands?.map(({ name }) => name)).toEqual([
    WaitBeforeRetryLyrics.name,
  ])
})
