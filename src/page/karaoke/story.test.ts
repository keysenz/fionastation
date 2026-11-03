import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { expect, test } from 'vitest'

import type { PlayableSong } from '../../domain.ts'
import { PlayerEvent } from '../../youtube'
import {
  ApplyPlayback,
  FetchSongs,
  FocusQueueHandle,
  LoadAutoplay,
  LoadSavedSetlist,
  Message,
  type Model,
  PickRandomVideo,
  STREAM_GONE,
  SaveAutoplay,
  SaveSetlist,
  ScrollListToTop,
  ScrollSetlistToTop,
  type UpdateReturn,
  WaitBeforeDismissToast,
  entered,
  init,
  update,
} from './karaoke'
import { emptySetlist, restoreSaved } from './setlist.ts'

const makeSong = (id: string, video = `video-${id}`): PlayableSong => ({
  id,
  song_title: `Song ${id}`,
  timestamp: '00:01:00',
  created_at: 'x',
  video_url: video,
  title_text: 'Stream',
  membership: false,
})
const [a, b] = [makeSong('a'), makeSong('b')]
const a2 = makeSong('a2', a.video_url)
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
    FetchSongs.name,
  ])
  expect(entered(opened.model).commands?.map(({ name }) => name)).toEqual([
    LoadSavedSetlist.name,
    LoadAutoplay.name,
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
    Command.expectHas(ScrollSetlistToTop),
    Command.resolve(ScrollSetlistToTop, Message.CompletedScrollSetlistToTop()),
    message(Message.ClickedVideo({ videoId: 'v2' })),
    Command.resolve(ScrollSetlistToTop, Message.CompletedScrollSetlistToTop()),
    model(current => {
      expect(current.maybeSelectedVideoId).toEqual(Option.some('v2'))
    }),
    message(Message.ClickedBackToVideos()),
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
