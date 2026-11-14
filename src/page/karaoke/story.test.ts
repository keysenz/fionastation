import { DateTime, Effect, Option, Schema } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { expect, test } from 'vitest'

import { WriteFailure } from '../../api.ts'
import type { PlayableSong } from '../../domain.ts'
import { LyricCursor, type Lyrics } from '../../lyrics.ts'
import { Playlist, PlaylistId } from '../../playlist.ts'
import { PlayerEvent } from '../../youtube'
import { Account } from './account.ts'
import {
  ApplyPlayback,
  ApplyVolume,
  CopyLink,
  CreatePlaylist,
  FetchLyrics,
  FetchPlaylist,
  FetchSongs,
  FocusInfoButton,
  FocusInfoPanel,
  FocusPlaylistDialog,
  FocusPlaylistPrompt,
  FocusQueueHandle,
  LoadAccount,
  LoadAccountPlaylists,
  LoadAutoplay,
  LoadLyricNudges,
  LoadMyPlaylists,
  LoadRepeat,
  LoadSavedSetlist,
  LoadVolume,
  Logout,
  Message,
  type Model,
  PickRandomVideo,
  RecheckAccount,
  RecordStat,
  RefreshPlaylist,
  RemovePlaylist,
  ReplacePlaylist,
  SaveAutoplay,
  SaveClaimAttempts,
  SaveLyricNudges,
  SaveMyPlaylists,
  SaveRepeat,
  SaveSetlist,
  SaveVolume,
  ScrollListToTop,
  ScrollSetlistToTop,
  SeekPlayer,
  StartLogin,
  SyncUrl,
  type UpdateReturn,
  WaitBeforeDismissToast,
  WaitBeforeLoadTimeout,
  WaitBeforeRetryLoad,
  WaitBeforeRetryLyrics,
  entered,
  init,
  nowSingingOf,
  openedPlaylistNameOf,
  ownedOpenedOf,
  update as pageUpdate,
} from './karaoke'
import { layersToUrl, parseLayers } from './layers.ts'
import {
  EditToken,
  type Owned,
  OwnedChange,
  PlaylistForm,
  ownedToJson,
  parseOwned,
} from './playlists.ts'
import {
  defaultVolume,
  emptySetlist,
  intentOf,
  parseVolume,
  restoreSaved,
  toPersistedJson,
  toVolumeJson,
} from './setlist.ts'

const update = (current: Model, next: Message): UpdateReturn => {
  const result = pageUpdate(current, next)
  return result.commands === undefined
    ? result
    : {
        ...result,
        commands: result.commands.filter(
          ({ name }) =>
            name !== WaitBeforeLoadTimeout.name && name !== RecordStat.name,
        ),
      }
}

const makeSong = (
  id: string,
  video = `video-${id}`,
  kind: PlayableSong['kind'] = 'karaoke',
): PlayableSong => ({
  id,
  song_title: `Song ${id}`,
  artist: '',
  original_title: '',
  version: '',
  note: '',
  timestamp: '00:01:00',
  created_at: 'x',
  video_url: video,
  title_text: 'Stream',
  membership: false,
  published_at: DateTime.makeUnsafe('2026-09-29T12:24:01Z'),
  kind,
})
const [a, b] = [makeSong('a'), makeSong('b')]
const a2 = makeSong('a2', a.video_url)
const synced = Command.resolve(SyncUrl, Message.CompletedSyncUrl())
const saved = Command.resolve(SaveSetlist, Message.CompletedSaveSetlist())

const pickedFor = (song: PlayableSong, playId: number) =>
  Command.resolveAll(
    [SaveSetlist, Message.CompletedSaveSetlist()],
    [PickRandomVideo, Message.CompletedPickRandomVideo({ playId, song })],
  )

const failVideo = (playId: number) =>
  Message.ReceivedPlayerEvent({
    playId,
    event: PlayerEvent.VideoGone(),
  })
const waited = (dismissId: number) =>
  Command.resolve(
    WaitBeforeDismissToast,
    Message.CompletedWaitBeforeDismissToast({ dismissId }),
  )
// NOTE: a story must resolve every Command, and playId 99 is no play, so this stands for a retry timer that has not elapsed.
const retryNotYetDue = Command.resolve(
  WaitBeforeRetryLoad,
  Message.CompletedWaitBeforeRetryLoad({ playId: 99 }),
)
const toastOf = (current: Model) =>
  Option.getOrUndefined(current.maybeSkipToast)

const statusOf = (current: Model) =>
  Option.flatMap(current.setlist.maybeNowPlaying, ({ phase }) =>
    intentOf(phase),
  )

const phaseOf = (current: Model) =>
  Option.map(current.setlist.maybeNowPlaying, ({ phase }) => phase._tag)

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
      expect(phaseOf(current)).toEqual(Option.some('Loading'))
      expect(current.setlist.history).toEqual([])
    }),
  )
})

test('a gone video waits as moving on until the pick arrives, and Next asks again', () => {
  const movingOn = [
    Message.SucceededFetchSongs({ songs: [a, a2, b], goneVideoIds: [] }),
    Message.ClickedSong({ song: a }),
    failVideo(1),
  ].reduce<UpdateReturn>((previous, next) => update(previous.model, next), {
    model: init(),
  })
  expect(phaseOf(movingOn.model)).toEqual(Option.some('MovingOn'))
  const next = update(movingOn.model, Message.ClickedNext())
  expect(phaseOf(next.model)).toEqual(Option.some('MovingOn'))
  expect(next.commands?.map(({ name, args }) => [name, args])).toEqual([
    [PickRandomVideo.name, { playId: 1, candidates: [b] }],
  ])
})

test('a gone video ignores what its player still reports, so it is never paused, ended or recorded', () => {
  const gone = [
    Message.SucceededFetchSongs({ songs: [b], goneVideoIds: [] }),
    Message.ClickedSong({ song: b }),
    failVideo(1),
  ].reduce<UpdateReturn>((previous, next) => update(previous.model, next), {
    model: init(),
  }).model
  const late = [
    PlayerEvent.Ready(),
    PlayerEvent.Playing(),
    PlayerEvent.Paused(),
    PlayerEvent.Ended(),
    PlayerEvent.LoadFailed({ reason: 'PlayerUnavailable' }),
    PlayerEvent.VideoGone(),
  ].map(event =>
    update(gone, Message.ReceivedPlayerEvent({ playId: 1, event })),
  )
  expect(late.map(({ model: after }) => after)).toEqual(late.map(() => gone))
  expect(late.flatMap(({ commands }) => commands ?? [])).toEqual([])
})

test('the only video being gone stays on the bar, marked gone', () => {
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
      expect(phaseOf(current)).toEqual(Option.some('Gone'))
    }),
  )
})

test('a player that cannot load fails the load and skips nothing', () => {
  story(
    update,
    given(init()),
    message(Message.SucceededFetchSongs({ songs: [a, b], goneVideoIds: [] })),
    message(Message.ClickedSong({ song: a })),
    saved,
    message(
      Message.ReceivedPlayerEvent({
        playId: 1,
        event: PlayerEvent.LoadFailed({ reason: 'PlayerUnavailable' }),
      }),
    ),
    retryNotYetDue,
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('a'))
      expect(phaseOf(current)).toEqual(Option.some('LoadFailed'))
    }),
    message(Message.ClickedSong({ song: b })),
    saved,
    model(current => {
      expect(phaseOf(current)).toEqual(Option.some('Loading'))
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
    LoadMyPlaylists.name,
    LoadAccount.name,
    LoadAutoplay.name,
    LoadRepeat.name,
    LoadVolume.name,
    LoadLyricNudges.name,
    FetchSongs.name,
  ])
  const known = update(
    opened.model,
    Message.FailedLoadAccount({ kind: 'SignedOut' }),
  )
  expect(entered(known.model).commands?.map(({ name }) => name)).toEqual([
    LoadSavedSetlist.name,
    LoadMyPlaylists.name,
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

test('a queue saved before songs had artist, version and note restores with them empty', () => {
  const {
    artist: _artist,
    original_title: _originalTitle,
    version: _version,
    note: _note,
    ...oldSong
  } = a
  const oldSave = JSON.stringify({
    state: { queue: [oldSong], history: [oldSong] },
    version: 0,
  })
  const restored = restoreSaved(emptySetlist, Option.some(oldSave))
  expect(restored.queue).toEqual([a])
  expect(restored.history).toEqual([a])
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
        _tag: 'SkippedSongs',
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
        _tag: 'SkippedSongs',
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
        event: PlayerEvent.LoadFailed({ reason: 'PlayerUnavailable' }),
      }),
    ),
    retryNotYetDue,
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

test('with autoplay off a gone video stays, marked gone, and shows no toast', () => {
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
      expect(phaseOf(current)).toEqual(Option.some('Gone'))
      expect(toastOf(current)).toBeUndefined()
    }),
  )
})

test('a failed song left on the bar stays out of history, so Previous does not bring it back', () => {
  story(
    update,
    given(init()),
    message(Message.SucceededFetchSongs({ songs: [a, b], goneVideoIds: [] })),
    ...autoplayOff,
    message(Message.ClickedSong({ song: b })),
    saved,
    message(Message.ClickedSong({ song: a })),
    saved,
    message(failVideo(2)),
    saved,
    message(Message.ClickedSong({ song: b })),
    saved,
    model(current => {
      expect(current.setlist.history).toEqual([b])
    }),
    message(Message.ClickedPrevious()),
    saved,
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('b'))
      expect(current.setlist.queue).toEqual([b])
      expect(current.setlist.history).toEqual([])
    }),
  )
})

test('a song clicked while the pick after a failed video is on its way leaves the failed song out of history', () => {
  const clicked = [
    Message.SucceededFetchSongs({ songs: [a, b], goneVideoIds: [] }),
    Message.ClickedSong({ song: a }),
    failVideo(1),
    Message.ClickedSong({ song: b }),
  ].reduce<UpdateReturn>((previous, next) => update(previous.model, next), {
    model: init(),
  })
  expect(currentIdOf(clicked.model)).toEqual(Option.some('b'))
  expect(clicked.model.setlist.history).toEqual([])
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
      expect(toastOf(current)).toMatchObject({ firstSkippedTitle: 'Song b' })
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

test('the end of a stream clicked on its first song asks for another video, and does not replay the stream', () => {
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
    Command.resolve(
      PickRandomVideo,
      Message.CompletedPickRandomVideo({ playId: 1, song: b }),
    ),
    saved,
    model(current => {
      expect(currentIdOf(current)).toEqual(Option.some('b'))
      expect(current.setlist.history).toEqual([a])
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
    pickedFor(b, 1),
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
    Message.CompletedPickRandomVideo({ playId: 1, song: b }),
  )
  expect(currentIdOf(late.model)).toEqual(Option.some('c'))
  expect(late.model.setlist).toEqual(chosen.model.setlist)
  expect(late.commands).toBeUndefined()
})

const refetchGone = (...goneVideoIds: ReadonlyArray<string>) =>
  Message.SucceededFetchSongs({ songs: archive, goneVideoIds })

test('a pick that lands on a video reported gone since it was asked for draws again among the live ones', () => {
  const repicked = playing(
    Message.ClickedSong({ song: a2 }),
    Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Ended() }),
    refetchGone(b.video_url),
    Message.CompletedPickRandomVideo({ playId: 1, song: b }),
  )
  expect(currentIdOf(repicked.model)).toEqual(Option.some('a2'))
  expect(repicked.commands?.map(({ name, args }) => [name, args])).toEqual([
    [PickRandomVideo.name, { playId: 1, candidates: [c] }],
  ])
})

test('a pick after an end whose videos have all gone since pauses the same song', () => {
  const stopped = playing(
    Message.ClickedSong({ song: a2 }),
    Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Ended() }),
    refetchGone(b.video_url, c.video_url),
    Message.CompletedPickRandomVideo({ playId: 1, song: b }),
  )
  expect(currentIdOf(stopped.model)).toEqual(Option.some('a2'))
  expect(statusOf(stopped.model)).toEqual(Option.some('Paused'))
  expect(
    stopped.commands?.some(({ name }) => name === PickRandomVideo.name),
  ).toBe(false)
})

test('a pick after a gone video whose videos have all gone since leaves the gone song on the bar, marked gone', () => {
  const stopped = playing(
    Message.ClickedSong({ song: a }),
    failVideo(1),
    refetchGone(b.video_url, c.video_url),
    Message.CompletedPickRandomVideo({ playId: 1, song: b }),
  )
  expect(currentIdOf(stopped.model)).toEqual(Option.some('a'))
  expect(phaseOf(stopped.model)).toEqual(Option.some('Gone'))
  expect(stopped.commands).toBeUndefined()
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
        _tag: 'SkippedSongs',
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
  credit: { source: 'LRCLIB', lrclibId: 1, track: 'T', artist: 'A' },
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

test('next jumps to the next song in the same video and leaves the queue alone', () => {
  const inFirst = tick(playingStream(), 70).model
  const skipped = update(inFirst, Message.ClickedNext())
  expect(
    skipped.commands?.map(({ name, args }) => [name, args]),
  ).toContainEqual([SeekPlayer.name, { seconds: 300 }])
  expect(skipped.model.maybePlayhead).toEqual(
    Option.some({ playId: 1, seconds: 300 }),
  )
  expect(singingId(skipped.model)).toEqual(Option.some('late'))
  expect(skipped.model.setlist).toEqual(inFirst.setlist)
})

test('previous jumps back to the start of the song before it in the same video', () => {
  const inLast = tick(playingStream(), 310).model
  const back = update(inLast, Message.ClickedPrevious())
  expect(back.commands?.map(({ name, args }) => [name, args])).toContainEqual([
    SeekPlayer.name,
    { seconds: 60 },
  ])
  expect(singingId(back.model)).toEqual(Option.some('early'))
  expect(back.model.setlist).toEqual(inLast.setlist)
})

test('next with a queue plays the queue head even when the video has a next song', () => {
  const queued = makeSong('queued', 'elsewhere')
  const inFirst = tick(playingStream(), 70).model
  const withQueue = update(
    inFirst,
    Message.ClickedAddToQueue({ song: queued }),
  ).model
  const next = update(withQueue, Message.ClickedNext())
  expect(next.commands?.some(({ name }) => name === SeekPlayer.name)).toBe(
    false,
  )
  expect(
    Option.map(next.model.setlist.maybeNowPlaying, ({ song }) => song.id),
  ).toEqual(Option.some('queued'))
})

test('next on the last song of a video with an empty queue picks another live video', () => {
  const other = makeSong('other', 'elsewhere')
  const fetched = update(
    init(),
    Message.SucceededFetchSongs({
      songs: [early, late, other],
      goneVideoIds: [],
    }),
  ).model
  const inLast = tick(
    update(fetched, Message.ClickedSong({ song: early })).model,
    310,
  ).model
  const next = update(inLast, Message.ClickedNext())
  expect(next.commands?.map(({ name, args }) => [name, args])).toEqual([
    [PickRandomVideo.name, { playId: 1, candidates: [other] }],
  ])
})

const seeksOf = (result: UpdateReturn) =>
  result.commands
    ?.filter(({ name }) => name === SeekPlayer.name)
    .map(({ args }) => args?.['seconds'])

test('next before the first position report seeks to the next song of the stream', () => {
  const clicked = playingStream()
  const next = update(clicked, Message.ClickedNext())
  expect(seeksOf(next)).toEqual([300])
  expect(singingId(next.model)).toEqual(Option.some('late'))
  expect(next.model.setlist).toEqual(clicked.setlist)
})

test('previous before the first position report seeks to the song before the clicked one', () => {
  const fetched = update(
    init(),
    Message.SucceededFetchSongs({ songs: [early, late], goneVideoIds: [] }),
  ).model
  const clicked = update(fetched, Message.ClickedSong({ song: late })).model
  const back = update(clicked, Message.ClickedPrevious())
  expect(seeksOf(back)).toEqual([60])
  expect(singingId(back.model)).toEqual(Option.some('early'))
  expect(back.model.setlist).toEqual(clicked.setlist)
})

test('next with the playhead before the first song seeks to the first song', () => {
  const next = update(tick(playingStream(), 30).model, Message.ClickedNext())
  expect(seeksOf(next)).toEqual([60])
  expect(singingId(next.model)).toEqual(Option.some('early'))
})

test('next on a play that failed asks for another video instead of seeking in it', () => {
  const other = makeSong('other', 'elsewhere')
  const fetched = update(
    init(),
    Message.SucceededFetchSongs({
      songs: [early, late, other],
      goneVideoIds: [],
    }),
  ).model
  const failed = update(
    update(fetched, Message.ClickedSong({ song: early })).model,
    Message.ReceivedPlayerEvent({
      playId: 1,
      event: PlayerEvent.LoadFailed({ reason: 'PlayerUnavailable' }),
    }),
  ).model
  const next = update(failed, Message.ClickedNext())
  expect(seeksOf(next)).toEqual([])
  expect(next.commands?.map(({ name }) => name)).toEqual([PickRandomVideo.name])
})

test('a position before the first song fetches nothing and sings nothing', () => {
  const before = tick(playingStream(), 30)
  expect(before.commands).toEqual([])
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

const waitElapsed = (args: Record<string, unknown>) =>
  Message.CompletedWaitBeforeRetryLyrics({
    songId: String(args['songId']),
    waitId: Number(args['waitId']),
  })

const lyricsWaitOf = (result: UpdateReturn) => {
  const waits = (result.commands ?? []).filter(
    ({ name }) => name === WaitBeforeRetryLyrics.name,
  )
  expect(waits).toHaveLength(1)
  return waitElapsed(waits[0]?.args ?? {})
}

const failLyrics = (current: Model, songId: string) =>
  update(current, Message.FailedFetchLyrics({ songId, error: 'down' }))

test('retrying failed lyrics fetches again, and retrying anything else does nothing', () => {
  const failed = failLyrics(tick(playingStream(), 70).model, 'early').model
  expect(failed.lyricsBySongId['early']?._tag).toBe('Failed')
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

test('a failed fetch schedules a delayed retry', () => {
  const failed = failLyrics(tick(playingStream(), 70).model, 'early')
  expect(failed.commands?.map(({ name }) => name)).toEqual([
    WaitBeforeRetryLyrics.name,
  ])
  expect(failed.commands?.[0]?.args?.['songId']).toBe('early')
})

test('the delayed retry fetches again while the song is still failed and current', () => {
  const failed = failLyrics(tick(playingStream(), 70).model, 'early')
  const retried = update(failed.model, lyricsWaitOf(failed))
  expect(fetchedIds(retried)).toEqual(['early'])
  expect(retried.model.lyricsBySongId['early']?._tag).toBe('Loading')
})

test('the delayed retry also covers the next song', () => {
  const failed = failLyrics(tick(playingStream(), 70).model, 'late')
  expect(fetchedIds(update(failed.model, lyricsWaitOf(failed)))).toEqual([
    'late',
  ])
})

test('the delayed retry does nothing once the lyrics arrived', () => {
  const failed = failLyrics(tick(playingStream(), 70).model, 'early')
  const arrived = update(
    failed.model,
    Message.SucceededFetchLyrics({ songId: 'early', lyrics: threeLines }),
  ).model
  const elapsed = update(arrived, lyricsWaitOf(failed))
  expect(elapsed.commands).toBeUndefined()
  expect(elapsed.model.lyricsBySongId['early']?._tag).toBe('Loaded')
})

test("a position past the song's end gives up its retry, and the wait then does nothing", () => {
  const failed = failLyrics(tick(playingStream(), 70).model, 'early')
  const moved = tick(failed.model, 400).model
  expect(singingId(moved)).toEqual(Option.some('late'))
  expect(moved.lyricsBySongId['early']?._tag).toBe('GaveUp')
  const elapsed = update(moved, lyricsWaitOf(failed))
  expect(elapsed.commands).toBeUndefined()
  expect(elapsed.model).toEqual(moved)
})

test('automatic retries stop after three, and a manual retry starts the count again', () => {
  const capped = Array.from({ length: 3 }).reduce<UpdateReturn>(
    retry => {
      const retried = update(retry.model, lyricsWaitOf(retry))
      expect(fetchedIds(retried)).toEqual(['early'])
      return failLyrics(retried.model, 'early')
    },
    failLyrics(tick(playingStream(), 70).model, 'early'),
  )
  expect(capped.commands).toBeUndefined()
  expect(capped.model.lyricsBySongId['early']?._tag).toBe('GaveUp')
  const manual = update(
    capped.model,
    Message.ClickedRetryLyrics({ songId: 'early' }),
  )
  expect(lyricsWaitOf(failLyrics(manual.model, 'early'))).toBeDefined()
})

test('a lyrics retry that waits past the song gives up, and singing the song again fetches its lyrics', () => {
  const failed = failLyrics(tick(playingStream(), 70).model, 'early')
  const elapsed = lyricsWaitOf(failed)
  const pastIt = tick(failed.model, 400).model
  const late = update(pastIt, elapsed)
  expect(fetchedIds(late) ?? []).toEqual([])
  expect(fetchedIds(tick(late.model, 70))).toEqual(['early'])
})

test("a lyrics retry fires for a song that is neither sung nor next, as long as the playhead is before the song's end", () => {
  const two = lyricSong('two', '00:03:00')
  const songs = [
    lyricSong('one', '00:01:00'),
    two,
    lyricSong('three', '00:05:00'),
  ]
  const fetched = update(
    init(),
    Message.SucceededFetchSongs({ songs, goneVideoIds: [] }),
  ).model
  const inTwo = tick(
    update(fetched, Message.ClickedSong({ song: two })).model,
    200,
  ).model
  const failed = failLyrics(inTwo, 'three')
  const backInOne = tick(failed.model, 70).model
  expect(fetchedIds(update(backInOne, lyricsWaitOf(failed)))).toEqual(['three'])
})

test("the last song's lyrics retry until six minutes after its start", () => {
  const failed = failLyrics(tick(playingStream(), 310).model, 'late')
  const elapsed = lyricsWaitOf(failed)
  expect(fetchedIds(update(tick(failed.model, 650).model, elapsed))).toEqual([
    'late',
  ])
  expect(
    fetchedIds(update(tick(failed.model, 670).model, elapsed)) ?? [],
  ).toEqual([])
})

test('a lyrics retry wait that a later failure replaced fetches nothing', () => {
  const first = failLyrics(tick(playingStream(), 70).model, 'early')
  const retried = update(
    first.model,
    Message.ClickedRetryLyrics({ songId: 'early' }),
  )
  const second = failLyrics(retried.model, 'early')
  const stale = update(second.model, lyricsWaitOf(first))
  expect(fetchedIds(stale) ?? []).toEqual([])
  expect(fetchedIds(update(stale.model, lyricsWaitOf(second)))).toEqual([
    'early',
  ])
})

test('a lyrics retry wait fetches nothing once another video plays', () => {
  const other = makeSong('other', 'elsewhere')
  const fetched = update(
    init(),
    Message.SucceededFetchSongs({
      songs: [early, late, other],
      goneVideoIds: [],
    }),
  ).model
  const failed = failLyrics(
    tick(update(fetched, Message.ClickedSong({ song: early })).model, 70).model,
    'early',
  )
  const moved = update(failed.model, Message.ClickedSong({ song: other }))
  expect(fetchedIds(update(moved.model, lyricsWaitOf(failed))) ?? []).toEqual(
    [],
  )
})

test('a lyrics retry wait stays given up when the video changes and comes back before it ends, and the next position fetches again', () => {
  const other = makeSong('other', 'elsewhere')
  const fetched = update(
    init(),
    Message.SucceededFetchSongs({
      songs: [early, late, other],
      goneVideoIds: [],
    }),
  ).model
  const failed = failLyrics(
    tick(update(fetched, Message.ClickedSong({ song: early })).model, 70).model,
    'early',
  )
  const away = update(failed.model, Message.ClickedSong({ song: other })).model
  const back = update(away, Message.ClickedSong({ song: early })).model
  const elapsed = update(back, lyricsWaitOf(failed))
  expect(fetchedIds(elapsed) ?? []).toEqual([])
  expect(fetchedIds(tick(elapsed.model, 70, 3))).toEqual(['early'])
})

test('after the automatic retries run out, later ticks in the same song fetch nothing, and the retry button still fetches', () => {
  const exhausted = Array.from({ length: 3 }).reduce<UpdateReturn>(
    retry =>
      failLyrics(update(retry.model, lyricsWaitOf(retry)).model, 'early'),
    failLyrics(tick(playingStream(), 70).model, 'early'),
  )
  expect(
    (exhausted.commands ?? []).filter(
      ({ name }) => name === WaitBeforeRetryLyrics.name,
    ),
  ).toEqual([])
  expect(fetchedIds(tick(exhausted.model, 80)) ?? []).toEqual([])
  expect(
    fetchedIds(
      update(exhausted.model, Message.ClickedRetryLyrics({ songId: 'early' })),
    ),
  ).toEqual(['early'])
})

const failLoadOf = (playId: number) =>
  Message.ReceivedPlayerEvent({
    playId,
    event: PlayerEvent.LoadFailed({ reason: 'VideoUnplayable' }),
  })
const retryElapsed = (playId: number) =>
  Message.CompletedWaitBeforeRetryLoad({ playId })
const attemptOf = (current: Model) =>
  Option.map(current.setlist.maybeNowPlaying, ({ attempt }) => attempt)
const retryWaitsOf = (result: UpdateReturn) =>
  (result.commands ?? [])
    .filter(({ name }) => name === WaitBeforeRetryLoad.name)
    .map(({ args }) => args)
const through = (
  drive: typeof update,
  ...messages: ReadonlyArray<Message>
): UpdateReturn =>
  messages.reduce<UpdateReturn>(
    (previous, next) => drive(previous.model, next),
    { model: init() },
  )
const loadFailed = (...more: ReadonlyArray<Message>): UpdateReturn =>
  through(
    update,
    Message.SucceededFetchSongs({ songs: [a, a2, b], goneVideoIds: [] }),
    Message.ClickedAddToQueue({ song: b }),
    Message.ClickedSong({ song: a }),
    failLoadOf(1),
    ...more,
  )

test('a load that failed stays on its song, marks nothing gone, and waits before it tries again', () => {
  const failed = loadFailed()
  expect(currentIdOf(failed.model)).toEqual(Option.some('a'))
  expect(phaseOf(failed.model)).toEqual(Option.some('LoadFailed'))
  expect(failed.model.goneVideoIds).toEqual([])
  expect(queueOf(failed.model)).toEqual(['b'])
  expect(failed.model.setlist.history).toEqual([])
  expect(toastOf(failed.model)).toBeUndefined()
  expect(failed.commands?.map(({ name }) => name)).toEqual([
    WaitBeforeRetryLoad.name,
  ])
})

test('each automatic retry loads the same song as a new play, waits twice as long as the one before, and the fourth failure waits for nothing', () => {
  let current = loadFailed()
  const waits = [retryWaitsOf(current)]
  for (const playId of [1, 2, 3]) {
    const retried = update(current.model, retryElapsed(playId))
    expect(playIdOf(retried.model)).toEqual(Option.some(playId + 1))
    expect(currentIdOf(retried.model)).toEqual(Option.some('a'))
    expect(phaseOf(retried.model)).toEqual(Option.some('Loading'))
    expect(queueOf(retried.model)).toEqual(['b'])
    expect(retried.model.setlist.history).toEqual([])
    current = update(retried.model, failLoadOf(playId + 1))
    waits.push(retryWaitsOf(current))
  }
  expect(waits).toEqual([
    [{ playId: 1, delaySeconds: 2 }],
    [{ playId: 2, delaySeconds: 4 }],
    [{ playId: 3, delaySeconds: 8 }],
    [],
  ])
  expect(phaseOf(current.model)).toEqual(Option.some('LoadFailed'))
})

test('a retry timer that elapses after the visitor chose another song does nothing', () => {
  const clicked = loadFailed(Message.ClickedSong({ song: b }))
  const late = update(clicked.model, retryElapsed(1))
  expect(late.model).toEqual(clicked.model)
  expect(late.commands).toBeUndefined()
})

test('a manual retry never shortens the next automatic wait: it loads at once as the next attempt and leaves the old timer stale', () => {
  const secondFailure = loadFailed(retryElapsed(1), failLoadOf(2))
  expect(retryWaitsOf(secondFailure)).toEqual([{ playId: 2, delaySeconds: 4 }])

  const manual = update(secondFailure.model, Message.ClickedRetryLoad())
  expect(playIdOf(manual.model)).toEqual(Option.some(3))
  expect(currentIdOf(manual.model)).toEqual(Option.some('a'))
  expect(phaseOf(manual.model)).toEqual(Option.some('Loading'))
  expect(attemptOf(manual.model)).toEqual(Option.some(3))
  expect(retryWaitsOf(manual)).toEqual([])

  const staleTimer = update(manual.model, retryElapsed(2))
  expect(staleTimer.model).toEqual(manual.model)

  const thirdFailure = update(manual.model, failLoadOf(3))
  expect(retryWaitsOf(thirdFailure)).toEqual([{ playId: 3, delaySeconds: 8 }])
})

test('once the automatic retries are spent, a manual retry still loads the song and starts no automatic retries again', () => {
  let current = loadFailed()
  for (const playId of [1, 2, 3]) {
    current = update(
      update(current.model, retryElapsed(playId)).model,
      failLoadOf(playId + 1),
    )
  }
  for (const playId of [4, 5]) {
    const manual = update(current.model, Message.ClickedRetryLoad())
    expect(playIdOf(manual.model)).toEqual(Option.some(playId + 1))
    expect(phaseOf(manual.model)).toEqual(Option.some('Loading'))
    current = update(manual.model, failLoadOf(playId + 1))
    expect(phaseOf(current.model)).toEqual(Option.some('LoadFailed'))
    expect(retryWaitsOf(current)).toEqual([])
  }
})

test('a retried song that plays starts the count again, so a later failure waits the shortest time', () => {
  const failedLater = loadFailed(
    retryElapsed(1),
    Message.ReceivedPlayerEvent({ playId: 2, event: PlayerEvent.Ready() }),
    Message.ReceivedPlayerEvent({ playId: 2, event: PlayerEvent.Playing() }),
    failLoadOf(2),
  )
  expect(retryWaitsOf(failedLater)).toEqual([{ playId: 2, delaySeconds: 2 }])
})

test('a retried load that gets ready and fails before it plays keeps counting, so the retries end', () => {
  const failedAgain = loadFailed(
    retryElapsed(1),
    Message.ReceivedPlayerEvent({ playId: 2, event: PlayerEvent.Ready() }),
    failLoadOf(2),
  )
  expect(retryWaitsOf(failedAgain)).toEqual([{ playId: 2, delaySeconds: 4 }])
})

test('clicking the row of the song that failed to load retries it', () => {
  const retried = loadFailed(Message.ClickedSong({ song: a }))
  expect(playIdOf(retried.model)).toEqual(Option.some(2))
  expect(phaseOf(retried.model)).toEqual(Option.some('Loading'))
  expect(retried.model.setlist.history).toEqual([])
})

test('clicking the row the stream was entered on retries that song, even when a later one was being sung', () => {
  const failed = update(tick(playingStream(), 320).model, failLoadOf(1))
  const retried = update(failed.model, Message.ClickedSong({ song: early }))
  expect(currentIdOf(retried.model)).toEqual(Option.some('early'))
  expect(playIdOf(retried.model)).toEqual(Option.some(2))
  expect(attemptOf(retried.model)).toEqual(Option.some(2))
  expect(retried.model.setlist.history).toEqual([])
})

test('a pause from before the failure survives the automatic retry, and a manual retry plays', () => {
  const pausedThenFailed = through(
    update,
    Message.ClickedSong({ song: a }),
    Message.ClickedPlayPause(),
    failLoadOf(1),
  )
  const byTimer = update(pausedThenFailed.model, retryElapsed(1))
  expect(statusOf(byTimer.model)).toEqual(Option.some('Paused'))
  const byVisitor = update(pausedThenFailed.model, Message.ClickedRetryLoad())
  expect(statusOf(byVisitor.model)).toEqual(Option.some('Playing'))
})

test('a retry reloads the song being sung, not the one the stream was entered on', () => {
  const failed = update(tick(playingStream(), 320).model, failLoadOf(1))
  const retried = update(failed.model, Message.ClickedRetryLoad())
  expect(currentIdOf(retried.model)).toEqual(Option.some('late'))
  expect(playIdOf(retried.model)).toEqual(Option.some(2))
})

test('a song whose load failed is still a real song: leaving it records it in history', () => {
  const left = loadFailed(Message.ClickedNext())
  expect(currentIdOf(left.model)).toEqual(Option.some('b'))
  expect(left.model.setlist.history.map(({ id }) => id)).toEqual(['a'])
  expect(left.model.goneVideoIds).toEqual([])
})

test('a failed load does nothing on Play/Pause, and a video that starts late plays after all', () => {
  const failed = loadFailed()
  const toggled = update(failed.model, Message.ClickedPlayPause())
  expect(phaseOf(toggled.model)).toEqual(Option.some('LoadFailed'))
  expect(
    toggled.commands?.some(({ name }) => name === ApplyPlayback.name),
  ).toBe(false)
  const paused = update(
    failed.model,
    Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Paused() }),
  )
  expect(paused.model).toEqual(failed.model)
  const started = update(
    failed.model,
    Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Playing() }),
  )
  expect(phaseOf(started.model)).toEqual(Option.some('Playing'))
  const lateTimer = update(started.model, retryElapsed(1))
  expect(lateTimer.model).toEqual(started.model)
})

test('a failed load whose video turns out gone takes the gone path', () => {
  const gone = loadFailed(failVideo(1))
  expect(gone.model.goneVideoIds).toEqual([a.video_url])
  expect(currentIdOf(gone.model)).toEqual(Option.some('b'))
  expect(gone.model.setlist.history).toEqual([])
})

const loadTimeoutsOf = (result: UpdateReturn) =>
  (result.commands ?? [])
    .filter(({ name }) => name === WaitBeforeLoadTimeout.name)
    .map(({ args }) => args)
const loadTimedOut = (playId: number) =>
  Message.CompletedWaitBeforeLoadTimeout({ playId })

test('every new play starts its own load timeout, and a seek or a pause starts none', () => {
  const clicked = through(pageUpdate, Message.ClickedSong({ song: a }))
  expect(loadTimeoutsOf(clicked)).toEqual([{ playId: 1 }])
  const paused = pageUpdate(clicked.model, Message.ClickedPlayPause())
  expect(loadTimeoutsOf(paused)).toEqual([])
  const failed = pageUpdate(clicked.model, failLoadOf(1))
  const retried = pageUpdate(failed.model, retryElapsed(1))
  expect(loadTimeoutsOf(retried)).toEqual([{ playId: 2 }])
  const picked = through(
    pageUpdate,
    Message.SucceededFetchSongs({ songs: [a, b], goneVideoIds: [] }),
    Message.ClickedSong({ song: a }),
    failVideo(1),
    Message.CompletedPickRandomVideo({ playId: 1, song: b }),
  )
  expect(loadTimeoutsOf(picked)).toEqual([{ playId: 2 }])
})

test('a play still loading when its timeout elapses fails as an attempt and waits before it retries', () => {
  const stuck = through(
    update,
    Message.ClickedSong({ song: a }),
    loadTimedOut(1),
  )
  expect(phaseOf(stuck.model)).toEqual(Option.some('LoadFailed'))
  expect(currentIdOf(stuck.model)).toEqual(Option.some('a'))
  expect(stuck.model.goneVideoIds).toEqual([])
  expect(retryWaitsOf(stuck)).toEqual([{ playId: 1, delaySeconds: 2 }])
  const stuckAgain = update(
    update(stuck.model, retryElapsed(1)).model,
    loadTimedOut(2),
  )
  expect(retryWaitsOf(stuckAgain)).toEqual([{ playId: 2, delaySeconds: 4 }])
})

test('a load timeout that elapses after the player got ready, or for an older play, does nothing', () => {
  const ready = through(
    update,
    Message.ClickedSong({ song: a }),
    Message.ReceivedPlayerEvent({ playId: 1, event: PlayerEvent.Ready() }),
  )
  expect(update(ready.model, loadTimedOut(1)).model).toEqual(ready.model)
  const replaced = through(
    update,
    Message.ClickedSong({ song: a }),
    Message.ClickedSong({ song: b }),
  )
  const late = update(replaced.model, loadTimedOut(1))
  expect(late.model).toEqual(replaced.model)
  expect(late.commands).toBeUndefined()
})

const openingId = Schema.decodeSync(Playlist)({
  id: 'Ab3dE5gH',
  name: 'Road trip',
  entries: [{ songId: 'x', videoUrl: 'v', timestamp: 't', title: 'T' }],
  version: 1,
  createdAt: 'x',
  updatedAt: 'x',
}).id

const entryOf = (song: PlayableSong) => ({
  songId: song.id,
  videoUrl: song.video_url,
  timestamp: song.timestamp,
  title: song.song_title,
})

const otherId = Schema.decodeSync(PlaylistId)('Zy9xW8vU')

const playlistWithId = (
  id: PlaylistId,
  first: PlayableSong,
  ...more: ReadonlyArray<PlayableSong>
): Playlist =>
  Schema.decodeSync(Playlist)({
    id,
    name: 'Road trip',
    entries: [entryOf(first), ...more.map(entryOf)],
    version: 1,
    createdAt: 'x',
    updatedAt: 'x',
  })

const playlistOf = (
  first: PlayableSong,
  ...more: ReadonlyArray<PlayableSong>
): Playlist => playlistWithId(openingId, first, ...more)

const savedQueue = (...queue: ReadonlyArray<PlayableSong>) =>
  Message.CompletedLoadSavedSetlist({
    maybeJson: Option.some(
      toPersistedJson({ ...emptySetlist, queue, history: [] }),
    ),
  })
const noSavedQueue = Message.CompletedLoadSavedSetlist({
  maybeJson: Option.none(),
})
const fetchedPlaylist = (playlist: Playlist) =>
  Command.resolve(FetchPlaylist, Message.SucceededFetchPlaylist({ playlist }))
const failedPlaylist = (failure: 'Deleted' | 'NotFound' | 'Unreachable') =>
  Command.resolve(
    FetchPlaylist,
    Message.FailedFetchPlaylist({ id: openingId, failure }),
  )
const focusedPrompt = Command.resolve(
  FocusPlaylistPrompt,
  Message.CompletedFocusPlaylistPrompt(),
)
const archiveLoaded = (
  songs: ReadonlyArray<PlayableSong>,
  goneVideoIds: ReadonlyArray<string> = [],
) => Message.SucceededFetchSongs({ songs, goneVideoIds })
const queueIdsOf = (current: Model) => current.setlist.queue.map(({ id }) => id)
const playingIdOf = (current: Model) =>
  Option.map(current.setlist.maybeNowPlaying, ({ song }) => song.id)
const openedNameOf = (current: Model) => openedPlaylistNameOf(current)

test('opening a link with nothing queued plays the playlist at once and names the page', () => {
  story(
    update,
    given(init()),
    message(
      Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
    ),
    message(noSavedQueue),
    fetchedPlaylist(playlistOf(b, a, c)),
    message(archiveLoaded([a, b, c])),
    saved,
    model(current => {
      expect(playingIdOf(current)).toEqual(Option.some('b'))
      expect(queueIdsOf(current)).toEqual(['a', 'c'])
      expect(openedNameOf(current)).toEqual(Option.some('Road trip'))
    }),
  )
})

test('the archive may load before the playlist and the result is the same', () => {
  story(
    update,
    given(init()),
    message(
      Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
    ),
    message(archiveLoaded([a, b, c])),
    message(noSavedQueue),
    fetchedPlaylist(playlistOf(b, a, c)),
    saved,
    model(current => {
      expect(playingIdOf(current)).toEqual(Option.some('b'))
      expect(queueIdsOf(current)).toEqual(['a', 'c'])
    }),
  )
})

test('the playlist is not fetched until the saved queue is known', () => {
  const opened = update(
    init(),
    Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
  )
  expect(opened.commands).toBeUndefined()
  const restored = update(opened.model, noSavedQueue)
  expect(restored.commands?.map(({ name }) => name)).toEqual([
    FetchPlaylist.name,
  ])
})

test('a saved queue makes the link ask, and nothing changes until the visitor answers', () => {
  story(
    update,
    given(init()),
    message(
      Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
    ),
    message(savedQueue(a, b)),
    fetchedPlaylist(playlistOf(c)),
    message(archiveLoaded([a, b, c])),
    focusedPrompt,
    model(current => {
      expect(current.playlistOpen._tag).toBe('Asking')
      expect(queueIdsOf(current)).toEqual(['a', 'b'])
      expect(current.setlist.maybeNowPlaying).toEqual(Option.none())
    }),
  )
})

const asked = (first: PlayableSong, ...more: ReadonlyArray<PlayableSong>) =>
  through(
    update,
    Message.SucceededFetchSongs({ songs: [a, b, c], goneVideoIds: [] }),
    Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
    savedQueue(a, b),
    Message.SucceededFetchPlaylist({ playlist: playlistOf(first, ...more) }),
  )

test('answering Replace queue plays the playlist instead of the queue', () => {
  const answered = update(
    asked(c).model,
    Message.ClickedReplaceQueueWithPlaylist(),
  )
  expect(playingIdOf(answered.model)).toEqual(Option.some('c'))
  expect(queueIdsOf(answered.model)).toEqual([])
  expect(answered.model.playlistOpen._tag).toBe('Opened')
})

test('answering Add to queue keeps the queue and puts the playlist behind it without repeats', () => {
  const answered = update(
    asked(b, c).model,
    Message.ClickedAddPlaylistToQueue(),
  )
  expect(queueIdsOf(answered.model)).toEqual(['a', 'b', 'c'])
  expect(answered.model.setlist.maybeNowPlaying).toEqual(Option.none())
  expect(answered.model.playlistOpen._tag).toBe('Opened')
})

test('answering Cancel leaves the queue as it was and closes the question', () => {
  const answered = update(asked(c).model, Message.ClickedCancelPlaylist())
  expect(queueIdsOf(answered.model)).toEqual(['a', 'b'])
  expect(answered.model.setlist.maybeNowPlaying).toEqual(Option.none())
  expect(answered.model.playlistOpen._tag).toBe('Idle')
  expect(openedNameOf(answered.model)).toEqual(Option.none())
})

test('an answer with no question open changes nothing', () => {
  const idle = through(
    update,
    Message.SucceededFetchSongs({ songs: [a], goneVideoIds: [] }),
  )
  for (const answer of [
    Message.ClickedReplaceQueueWithPlaylist(),
    Message.ClickedAddPlaylistToQueue(),
    Message.ClickedCancelPlaylist(),
  ]) {
    expect(update(idle.model, answer).model).toEqual(idle.model)
  }
})

const toastOfFailure = (failure: 'Deleted' | 'NotFound' | 'Unreachable') =>
  through(
    update,
    Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
    noSavedQueue,
    Message.FailedFetchPlaylist({ id: openingId, failure }),
  )

test('a deleted playlist shows its own toast, returns the address to the radio and opens nothing', () => {
  story(
    update,
    given(init()),
    message(
      Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
    ),
    message(noSavedQueue),
    failedPlaylist('Deleted'),
    synced,
    waited(99),
    model(current => {
      expect(toastOf(current)?._tag).toBe('PlaylistDeleted')
      expect(current.playlistOpen._tag).toBe('Idle')
      expect(current.setlist.maybeNowPlaying).toEqual(Option.none())
    }),
  )
})

test('the radio keeps its address bar at the radio when the playlist is gone', () => {
  const failed = toastOfFailure('Deleted')
  const sync = failed.commands?.find(({ name }) => name === SyncUrl.name)
  expect(sync?.args).toEqual({ url: '/', change: 'Replace' })
})

test('a playlist that never existed shows the unknown toast and returns to the radio', () => {
  const failed = toastOfFailure('NotFound')
  expect(toastOf(failed.model)?._tag).toBe('PlaylistNotFound')
  expect(failed.commands?.some(({ name }) => name === SyncUrl.name)).toBe(true)
})

test('a playlist that could not be reached keeps its address so a reload can retry', () => {
  const failed = toastOfFailure('Unreachable')
  expect(toastOf(failed.model)?._tag).toBe('PlaylistUnreachable')
  expect(failed.commands?.some(({ name }) => name === SyncUrl.name)).toBe(false)
})

test('a failure after the link was left behind is ignored', () => {
  const idle = update(
    init(),
    Message.FailedFetchPlaylist({ id: openingId, failure: 'Deleted' }),
  )
  expect(idle.model).toEqual(init())
  expect(idle.commands).toBeUndefined()
})

test('songs whose video is gone are skipped and the toast counts them', () => {
  const opened = through(
    update,
    Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
    noSavedQueue,
    Message.SucceededFetchPlaylist({ playlist: playlistOf(a, b, c) }),
    archiveLoaded([a, b, c], [b.video_url]),
  )
  expect(queueIdsOf(opened.model)).toEqual(['c'])
  expect(playingIdOf(opened.model)).toEqual(Option.some('a'))
  expect(toastOf(opened.model)).toMatchObject({
    _tag: 'PlaylistSongsUnavailable',
    count: 1,
  })
})

test('a playlist whose songs are all unavailable loads nothing and says so', () => {
  const opened = through(
    update,
    Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
    noSavedQueue,
    Message.SucceededFetchPlaylist({ playlist: playlistOf(a, b) }),
    archiveLoaded([a, b], [a.video_url, b.video_url]),
  )
  expect(opened.model.setlist.maybeNowPlaying).toEqual(Option.none())
  expect(queueIdsOf(opened.model)).toEqual([])
  expect(opened.model.playlistOpen._tag).toBe('Idle')
  expect(toastOf(opened.model)).toMatchObject({
    _tag: 'PlaylistSongsUnavailable',
    count: 2,
  })
})

test('a playlist that arrives for a link the visitor left is ignored', () => {
  const stray = update(
    init(),
    Message.SucceededFetchPlaylist({ playlist: playlistOf(a) }),
  )
  expect(stray.model).toEqual(init())
})

test('the playlist waits for a failed archive and opens once a retry succeeds', () => {
  const waiting = through(
    update,
    Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
    noSavedQueue,
    Message.SucceededFetchPlaylist({ playlist: playlistOf(a) }),
    Message.FailedFetchSongs({ error: 'down' }),
  )
  expect(waiting.model.playlistOpen._tag).toBe('Fetched')
  const retried = update(waiting.model, archiveLoaded([a]))
  expect(playingIdOf(retried.model)).toEqual(Option.some('a'))
})

const openedAndPlaying = () =>
  through(
    update,
    archiveLoaded([a, b, c]),
    Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
    noSavedQueue,
    Message.SucceededFetchPlaylist({ playlist: playlistOf(a, b, c) }),
  )

test('entering the route of the playlist already opened changes nothing and asks nothing', () => {
  const opened = openedAndPlaying()
  expect(queueIdsOf(opened.model)).toEqual(['b', 'c'])
  const again = update(
    opened.model,
    Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
  )
  expect(again.model).toEqual(opened.model)
  expect(again.commands).toBeUndefined()
  const reread = through(
    update,
    Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
    Message.CompletedLoadSavedSetlist({
      maybeJson: Option.some(toPersistedJson(opened.model.setlist)),
    }),
  )
  expect(reread.model.playlistOpen._tag).not.toBe('Asking')
})

test('entering the route of the same playlist while it loads does not start a second load', () => {
  const awaiting = update(
    init(),
    Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
  )
  const again = update(
    awaiting.model,
    Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
  )
  expect(again.model).toEqual(awaiting.model)
})

test('a reload of the opened playlist link while its songs are queued does not ask again', () => {
  const opened = openedAndPlaying()
  const reloaded = through(
    update,
    archiveLoaded([a, b, c]),
    Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
    Message.CompletedLoadSavedSetlist({
      maybeJson: Option.some(toPersistedJson(opened.model.setlist)),
    }),
    Message.SucceededFetchPlaylist({ playlist: playlistOf(a, b, c) }),
  )
  expect(reloaded.model.playlistOpen._tag).toBe('Opened')
  expect(queueIdsOf(reloaded.model)).toEqual(['b', 'c'])
  expect(reloaded.model.setlist.maybeNowPlaying).toEqual(Option.none())
})

const reopenedAfter = (...changes: ReadonlyArray<Message>) => {
  const changed = changes.reduce<UpdateReturn>(
    (previous, next) => update(previous.model, next),
    openedAndPlaying(),
  )
  return {
    changed,
    reopened: [
      Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
      Message.CompletedLoadSavedSetlist({
        maybeJson: Option.some(toPersistedJson(changed.model.setlist)),
      }),
      Message.SucceededFetchPlaylist({ playlist: playlistOf(a, b, c) }),
    ].reduce<UpdateReturn>(
      (previous, next) => update(previous.model, next),
      changed,
    ),
  }
}

test('opening the same link again asks once the visitor queued another song', () => {
  const { changed, reopened } = reopenedAfter(
    Message.ClickedAddToQueue({ song: d }),
  )
  expect(openedNameOf(changed.model)).toEqual(Option.none())
  expect(reopened.model.playlistOpen._tag).toBe('Asking')
})

test('opening the same link again asks once the visitor removed a queued song', () => {
  const { reopened } = reopenedAfter(
    Message.ClickedRemoveFromQueue({ index: 0 }),
  )
  expect(reopened.model.playlistOpen._tag).toBe('Asking')
})

test('playing through the queue keeps the opened playlist, so its link stays a no-op', () => {
  const { changed, reopened } = reopenedAfter(Message.ClickedNext())
  expect(openedNameOf(changed.model)).toEqual(Option.some('Road trip'))
  expect(reopened.model.playlistOpen._tag).toBe('Opened')
})

test('opening the same link again with a song playing and an empty queue asks', () => {
  const { changed, reopened } = reopenedAfter(
    Message.ClickedRemoveFromQueue({ index: 0 }),
    Message.ClickedRemoveFromQueue({ index: 0 }),
  )
  expect(queueIdsOf(changed.model)).toEqual([])
  expect(playingIdOf(changed.model)).toEqual(Option.some('a'))
  expect(reopened.model.playlistOpen._tag).toBe('Asking')
})

test('a reload on a different playlist link still asks', () => {
  const opened = openedAndPlaying()
  const reloaded = through(
    update,
    archiveLoaded([a, b, c]),
    Message.OpenedPlaylist({ id: otherId, maybeEditToken: Option.none() }),
    Message.CompletedLoadSavedSetlist({
      maybeJson: Option.some(toPersistedJson(opened.model.setlist)),
    }),
    Message.SucceededFetchPlaylist({ playlist: playlistWithId(otherId, c) }),
  )
  expect(reloaded.model.playlistOpen._tag).toBe('Asking')
})

test('a slow playlist asks when the visitor started a song meanwhile', () => {
  const slow = through(
    update,
    archiveLoaded([a, b, c]),
    Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
    noSavedQueue,
    Message.ClickedSong({ song: a }),
    Message.SucceededFetchPlaylist({ playlist: playlistOf(c) }),
  )
  expect(slow.model.playlistOpen._tag).toBe('Asking')
  expect(playingIdOf(slow.model)).toEqual(Option.some('a'))
})

test('a playlist that arrives after the visitor left the link is dropped', () => {
  const left = through(
    update,
    archiveLoaded([a, b, c]),
    Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
    noSavedQueue,
    Message.LeftPlaylist(),
    Message.SucceededFetchPlaylist({ playlist: playlistOf(c) }),
  )
  expect(left.model.playlistOpen._tag).toBe('Idle')
  expect(queueIdsOf(left.model)).toEqual([])
  expect(left.model.setlist.maybeNowPlaying).toEqual(Option.none())
})

test('leaving the link before the saved queue is read starts no fetch', () => {
  const left = through(
    update,
    Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
    Message.LeftPlaylist(),
  )
  expect(update(left.model, noSavedQueue).commands).toBeUndefined()
})

test('leaving the link closes its question but keeps an opened playlist opened', () => {
  expect(
    through(update, ...[Message.LeftPlaylist()]).model.playlistOpen._tag,
  ).toBe('Idle')
  expect(
    update(asked(c).model, Message.LeftPlaylist()).model.playlistOpen._tag,
  ).toBe('Idle')
  const opened = openedAndPlaying()
  expect(
    update(opened.model, Message.LeftPlaylist()).model.playlistOpen._tag,
  ).toBe('Opened')
})

test('a late failure of one link does not cancel the link now loading', () => {
  const other = through(
    update,
    archiveLoaded([a, b, c]),
    Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
    noSavedQueue,
    Message.OpenedPlaylist({ id: otherId, maybeEditToken: Option.none() }),
    noSavedQueue,
    Message.FailedFetchPlaylist({ id: openingId, failure: 'NotFound' }),
  )
  expect(other.model.playlistOpen._tag).toBe('Fetching')
  expect(toastOf(other.model)).toBeUndefined()
  const failed = update(
    other.model,
    Message.FailedFetchPlaylist({ id: otherId, failure: 'NotFound' }),
  )
  expect(failed.model.playlistOpen._tag).toBe('Idle')
})

test('every answer to the question returns focus to the page', () => {
  for (const answer of [
    Message.ClickedReplaceQueueWithPlaylist(),
    Message.ClickedAddPlaylistToQueue(),
    Message.ClickedCancelPlaylist(),
  ]) {
    const answered = update(asked(c).model, answer)
    expect(answered.commands?.map(({ name }) => name)).toContain(
      FocusInfoButton.name,
    )
  }
})
const token = Schema.decodeSync(EditToken)('tok_ABC-123')
const sessionBefore = (...more: ReadonlyArray<Message>): UpdateReturn =>
  through(
    update,
    Message.SucceededFetchSongs({ songs: [a, b, c], goneVideoIds: [] }),
    Message.ClickedSong({ song: a }),
    Message.ClickedSong({ song: b }),
    Message.ClickedAddToQueue({ song: c }),
    ...more,
  )
const commandNamed = (result: UpdateReturn, name: string) =>
  result.commands?.find(command => command.name === name)
const dialogOf = (current: Model) => current.playlistDialog
const formOf = (current: Model) =>
  current.playlistDialog._tag === 'Editing' ||
  current.playlistDialog._tag === 'Sending'
    ? current.playlistDialog.form
    : undefined
const writeFailureOf = (current: Model) =>
  current.playlistDialog._tag === 'Editing'
    ? Option.getOrUndefined(current.playlistDialog.maybeFailure)?._tag
    : undefined

const submitSave = (
  source: 'Queue' | 'History' | 'Session',
  name: string,
): UpdateReturn =>
  sessionBefore(
    Message.ClickedSavePlaylist(),
    Message.SelectedSaveSource({ source }),
    Message.UpdatedPlaylistName({ value: name }),
    Message.SubmittedPlaylistForm(),
  )

test.each([
  ['Queue', ['c']],
  ['History', ['a']],
  ['Session', ['a', 'b', 'c']],
] as const)(
  'saving %s sends the songs of that source in play order',
  (source, ids) => {
    const sent = submitSave(source, 'Rainy day Fio')
    expect(dialogOf(sent.model)._tag).toBe('Sending')
    expect(commandNamed(sent, CreatePlaylist.name)?.args).toEqual({
      name: 'Rainy day Fio',
      songIds: ids,
    })
  },
)

test('the save dialog starts on the first source that has songs', () => {
  const opened = through(
    update,
    Message.SucceededFetchSongs({ songs: [a, b, c], goneVideoIds: [] }),
    Message.ClickedSong({ song: a }),
    Message.ClickedSong({ song: b }),
    Message.ClickedSavePlaylist(),
  )
  expect(formOf(opened.model)).toEqual(
    PlaylistForm.Save({ source: 'History', name: '' }),
  )
  expect(opened.commands?.map(({ name }) => name)).toContain(
    FocusPlaylistDialog.name,
  )
})

test('a name is cleaned before it is sent and an empty one becomes the default', () => {
  expect(
    commandNamed(submitSave('Queue', '  𝓕𝓲𝓸𝓷𝓪  '), CreatePlaylist.name)?.args?.[
      'name'
    ],
  ).toBe('Fiona')
  expect(
    commandNamed(submitSave('Queue', '   '), CreatePlaylist.name)?.args?.[
      'name'
    ],
  ).toBe('Untitled playlist')
})

test('a name that is too long or a source with no songs sends nothing', () => {
  const tooLong = submitSave('Queue', 'x'.repeat(61))
  expect(tooLong.commands).toBeUndefined()
  expect(dialogOf(tooLong.model)._tag).toBe('Editing')
  const empty = through(
    update,
    Message.ClickedSavePlaylist(),
    Message.SubmittedPlaylistForm(),
  )
  expect(empty.commands).toBeUndefined()
  expect(dialogOf(empty.model)._tag).toBe('Editing')
})

const createdId = Schema.decodeSync(Playlist)({
  id: 'Zz9Yy8Xx',
  name: 'Rainy day Fio',
  entries: [{ songId: 'c', videoUrl: 'v', timestamp: 't', title: 'T' }],
  version: 1,
  createdAt: 'x',
  updatedAt: 'x',
}).id
const created = Message.SucceededCreatePlaylist({
  id: createdId,
  editToken: token,
  name: 'Rainy day Fio',
  songIds: ['c'],
})

test('a saved playlist is remembered with its token and shown with its links', () => {
  const done = update(submitSave('Queue', 'Rainy day Fio').model, created)
  expect(done.model.mine).toEqual([
    {
      id: createdId,
      name: 'Rainy day Fio',
      editToken: token,
      origin: 'Created',
    },
  ])
  expect(commandNamed(done, SaveMyPlaylists.name)?.args?.['change']).toEqual(
    OwnedChange.Remember({
      entry: {
        id: createdId,
        name: 'Rainy day Fio',
        editToken: token,
        origin: 'Created',
      },
    }),
  )
  expect(dialogOf(done.model)).toMatchObject({
    _tag: 'Shared',
    id: createdId,
    remembered: 'Pending',
    maybeEditToken: Option.some(token),
  })
  expect(ownedOpenedOf(done.model)._tag).toBe('Some')
})

test('the dialog learns whether this browser kept the token', () => {
  const done = update(submitSave('Queue', 'x').model, created)
  const kept = update(done.model, Message.SucceededSaveMyPlaylists())
  expect(dialogOf(kept.model)).toMatchObject({ remembered: 'Yes' })
  const lost = update(done.model, Message.FailedSaveMyPlaylists())
  expect(dialogOf(lost.model)).toMatchObject({ remembered: 'No' })
  expect(lost.model.mine).toHaveLength(1)
})

test('copy puts only the view link on the clipboard, and the edit link on request', () => {
  const origin = 'https://fio.example'
  const done = update(
    update(
      sessionBefore(
        Message.CompletedLoadMyPlaylists({
          maybeJson: Option.none(),
          maybeAttemptsJson: Option.none(),
          origin,
        }),
        Message.ClickedSavePlaylist(),
        Message.SubmittedPlaylistForm(),
      ).model,
      created,
    ).model,
    Message.ClickedCopyLink({ target: 'View' }),
  )
  expect(commandNamed(done, CopyLink.name)?.args).toEqual({
    text: `${origin}/p/${createdId}`,
    target: 'View',
  })
  const edit = update(done.model, Message.ClickedCopyLink({ target: 'Edit' }))
  expect(commandNamed(edit, CopyLink.name)?.args?.['text']).toBe(
    `${origin}/p/${createdId}#edit=${token}`,
  )
  const copied = update(
    edit.model,
    Message.SucceededCopyLink({ target: 'Edit' }),
  )
  expect(dialogOf(copied.model)).toMatchObject({
    maybeCopyResult: Option.some({ _tag: 'Copied', target: 'Edit' }),
  })
})

test('a failed save keeps the dialog open with the reason and leaves the queue alone', () => {
  const sent = submitSave('Queue', 'x')
  const limited = update(
    sent.model,
    Message.FailedWritePlaylist({
      failure: WriteFailure.RateLimited(),
      maybeEditToken: Option.none(),
    }),
  )
  expect(dialogOf(limited.model)._tag).toBe('Editing')
  expect(writeFailureOf(limited.model)).toBe('RateLimited')
  expect(queueIdsOf(limited.model)).toEqual(['c'])
  expect(limited.model.mine).toEqual([])
  const retry = update(limited.model, Message.SubmittedPlaylistForm())
  expect(commandNamed(retry, CreatePlaylist.name)).toBeDefined()
})

test.each(['Unreachable', 'TooLarge', 'Unavailable'] as const)(
  'a %s save is reported in the dialog',
  tag => {
    const failed = update(
      submitSave('Queue', 'x').model,
      Message.FailedWritePlaylist({
        failure: WriteFailure[tag](),
        maybeEditToken: Option.none(),
      }),
    )
    expect(writeFailureOf(failed.model)).toBe(tag)
  },
)

test('the dialog cannot be closed while a save is on its way, and Cancel closes it otherwise', () => {
  const sent = submitSave('Queue', 'x')
  expect(
    dialogOf(update(sent.model, Message.ClickedClosePlaylistDialog()).model)
      ._tag,
  ).toBe('Sending')
  const opened = through(update, Message.ClickedSavePlaylist())
  expect(
    dialogOf(update(opened.model, Message.ClickedClosePlaylistDialog()).model)
      ._tag,
  ).toBe('Closed')
})

const ownedJson = (value: string) => Option.some(value)
const openedAs = (
  maybeEditToken: Option.Option<EditToken>,
  playlist: Playlist = playlistOf(a, b),
) =>
  through(
    update,
    Message.SucceededFetchSongs({ songs: [a, b, c], goneVideoIds: [] }),
    Message.OpenedPlaylist({ id: openingId, maybeEditToken }),
    noSavedQueue,
    Message.SucceededFetchPlaylist({ playlist }),
  )
const urlSyncs = (result: UpdateReturn) =>
  result.commands
    ?.filter(({ name }) => name === SyncUrl.name)
    .map(({ args }) => args?.['url'])

test('opening an edit link remembers the token, then drops the fragment from the address bar', () => {
  const opened = openedAs(Option.some(token))
  expect(opened.model.mine).toEqual([
    { id: openingId, name: 'Road trip', editToken: token, origin: 'PickedUp' },
  ])
  expect(commandNamed(opened, SaveMyPlaylists.name)).toBeDefined()
  expect(urlSyncs(opened)).toContain(`/p/${openingId}`)
  expect(ownedOpenedOf(opened.model)._tag).toBe('Some')
})

test('opening a plain link remembers nothing and offers no edit rights', () => {
  const opened = openedAs(Option.none())
  expect(opened.model.mine).toEqual([])
  expect(commandNamed(opened, SaveMyPlaylists.name)).toBeUndefined()
  expect(ownedOpenedOf(opened.model)._tag).toBe('None')
})

test('an edit link entered while its playlist is already open is picked up', () => {
  const plain = openedAs(Option.none())
  const picked = update(
    plain.model,
    Message.PickedUpEditToken({ id: openingId, editToken: token }),
  )
  expect(picked.model.mine).toHaveLength(1)
  expect(urlSyncs(picked)).toContain(`/p/${openingId}`)
  expect(ownedOpenedOf(picked.model)._tag).toBe('Some')
})

test('an edit link for another playlist is ignored', () => {
  const plain = openedAs(Option.none())
  const other = Schema.decodeSync(Playlist)({
    id: 'Qq1Ww2Ee',
    name: 'x',
    entries: [{ songId: 'x', videoUrl: 'v', timestamp: 't', title: 'T' }],
    version: 1,
    createdAt: 'x',
    updatedAt: 'x',
  }).id
  const picked = update(
    plain.model,
    Message.PickedUpEditToken({ id: other, editToken: token }),
  )
  expect(picked.model.mine).toEqual([])
})

test('a token stored from an earlier visit gives edit rights without any fragment', () => {
  const stored = update(
    openedAs(Option.none()).model,
    Message.CompletedLoadMyPlaylists({
      maybeJson: ownedJson(
        JSON.stringify([
          { id: openingId, name: 'Road trip', editToken: token },
        ]),
      ),
      maybeAttemptsJson: Option.none(),
      origin: 'https://fio.example',
    }),
  )
  expect(ownedOpenedOf(stored.model)._tag).toBe('Some')
})

const ownerOf = () => openedAs(Option.some(token)).model
const settledOwner = () =>
  update(ownerOf(), Message.SucceededSaveMyPlaylists()).model

test('renaming sends the new name with the stored songs, the version and the token', () => {
  const renaming = update(settledOwner(), Message.ClickedRenamePlaylist())
  expect(formOf(renaming.model)).toEqual(
    PlaylistForm.Rename({ name: 'Road trip' }),
  )
  const submitted = update(
    update(
      renaming.model,
      Message.UpdatedPlaylistName({ value: 'Night drive' }),
    ).model,
    Message.SubmittedPlaylistForm(),
  )
  expect(commandNamed(submitted, ReplacePlaylist.name)?.args).toEqual({
    id: openingId,
    maybeEditToken: Option.some(token),
    name: 'Night drive',
    songIds: ['a', 'b'],
    version: 1,
  })
})

test('a rename that succeeds updates the page, the stored name and the version', () => {
  const submitted = update(
    update(
      update(settledOwner(), Message.ClickedRenamePlaylist()).model,
      Message.UpdatedPlaylistName({ value: 'Night drive' }),
    ).model,
    Message.SubmittedPlaylistForm(),
  )
  const done = update(
    submitted.model,
    Message.SucceededReplacePlaylist({
      name: 'Night drive',
      songIds: ['a', 'b'],
      version: 2,
      maybeEditToken: Option.some(token),
    }),
  )
  expect(openedPlaylistNameOf(done.model)).toEqual(Option.some('Night drive'))
  expect(done.model.mine[0]?.name).toBe('Night drive')
  expect(dialogOf(done.model)._tag).toBe('Closed')
  expect(toastOf(done.model)?._tag).toBe('PlaylistUpdated')
  const again = update(done.model, Message.ClickedUpdatePlaylist())
  const next = update(
    update(done.model, Message.ClickedRenamePlaylist()).model,
    Message.SubmittedPlaylistForm(),
  )
  expect(commandNamed(next, ReplacePlaylist.name)?.args?.['version']).toBe(2)
  expect(formOf(again.model)?._tag).toBe('Update')
})

test('updating from the queue sends the queued songs under the same name', () => {
  const withQueue = through(
    update,
    Message.SucceededFetchSongs({ songs: [a, b, c], goneVideoIds: [] }),
    Message.OpenedPlaylist({
      id: openingId,
      maybeEditToken: Option.some(token),
    }),
    noSavedQueue,
    Message.SucceededFetchPlaylist({ playlist: playlistOf(a, b) }),
    Message.ClickedAddToQueue({ song: c }),
    Message.ClickedUpdatePlaylist(),
    Message.SubmittedPlaylistForm(),
  )
  expect(commandNamed(withQueue, ReplacePlaylist.name)?.args).toMatchObject({
    name: 'Road trip',
    songIds: ['b', 'c'],
    version: 1,
  })
})

test('updating with an empty queue sends nothing', () => {
  const single = update(
    openedAs(Option.some(token), playlistOf(a)).model,
    Message.SucceededSaveMyPlaylists(),
  ).model
  const empty = update(
    update(single, Message.ClickedUpdatePlaylist()).model,
    Message.SubmittedPlaylistForm(),
  )
  expect(commandNamed(empty, ReplacePlaylist.name)).toBeUndefined()
})

test('a stale edit reloads the playlist, tells the visitor, and holds the newer version', () => {
  const submitted = update(
    update(settledOwner(), Message.ClickedRenamePlaylist()).model,
    Message.SubmittedPlaylistForm(),
  )
  const conflict = update(
    submitted.model,
    Message.FailedWritePlaylist({
      failure: WriteFailure.Conflict(),
      maybeEditToken: Option.none(),
    }),
  )
  expect(toastOf(conflict.model)?._tag).toBe('PlaylistConflict')
  expect(dialogOf(conflict.model)._tag).toBe('Closed')
  expect(commandNamed(conflict, RefreshPlaylist.name)?.args).toEqual({
    id: openingId,
  })
  const newer = Schema.decodeSync(Playlist)({
    id: openingId,
    name: 'Changed elsewhere',
    entries: [entryOf(c)],
    version: 5,
    createdAt: 'x',
    updatedAt: 'x',
  })
  const reloaded = update(
    conflict.model,
    Message.SucceededRefreshPlaylist({ playlist: newer }),
  )
  expect(openedPlaylistNameOf(reloaded.model)).toEqual(
    Option.some('Changed elsewhere'),
  )
  expect(reloaded.model.mine[0]?.name).toBe('Changed elsewhere')
  const retried = update(
    update(reloaded.model, Message.ClickedRenamePlaylist()).model,
    Message.SubmittedPlaylistForm(),
  )
  expect(commandNamed(retried, ReplacePlaylist.name)?.args).toMatchObject({
    version: 5,
    songIds: ['c'],
  })
})

test('a playlist that vanished while reloading after a conflict sends the visitor home', () => {
  const failed = update(
    settledOwner(),
    Message.FailedRefreshPlaylist({ failure: 'Deleted' }),
  )
  expect(failed.model.playlistOpen._tag).toBe('Idle')
  expect(toastOf(failed.model)?._tag).toBe('PlaylistDeleted')
  expect(urlSyncs(failed)).toContain('/')
})

test('deleting asks first, then removes the playlist and forgets its token', () => {
  const asked = update(settledOwner(), Message.ClickedDeletePlaylist())
  expect(formOf(asked.model)?._tag).toBe('Delete')
  const sent = update(asked.model, Message.SubmittedPlaylistForm())
  expect(commandNamed(sent, RemovePlaylist.name)?.args).toEqual({
    id: openingId,
    maybeEditToken: Option.some(token),
  })
  const done = update(sent.model, Message.SucceededRemovePlaylist())
  expect(done.model.playlistOpen._tag).toBe('Idle')
  expect(done.model.mine).toEqual([])
  expect(dialogOf(done.model)._tag).toBe('Closed')
  expect(toastOf(done.model)?._tag).toBe('PlaylistDeleted')
  expect(
    commandNamed(done, SaveMyPlaylists.name)?.args?.['change'],
  ).toMatchObject({ _tag: 'Forget', id: openingId })
})

test('a visitor without the token cannot rename, update or delete', () => {
  const visitor = openedAs(Option.none()).model
  for (const click of [
    Message.ClickedRenamePlaylist(),
    Message.ClickedUpdatePlaylist(),
    Message.ClickedDeletePlaylist(),
  ]) {
    const clicked = update(visitor, click)
    expect(dialogOf(clicked.model)._tag).toBe('Closed')
  }
})

test('a wrong token is reported in the dialog', () => {
  const submitted = update(
    update(settledOwner(), Message.ClickedDeletePlaylist()).model,
    Message.SubmittedPlaylistForm(),
  )
  const failed = update(
    submitted.model,
    Message.FailedWritePlaylist({
      failure: WriteFailure.Forbidden(),
      maybeEditToken: Option.none(),
    }),
  )
  expect(writeFailureOf(failed.model)).toBe('Forbidden')
})

test("saving a copy of someone else's playlist creates a new one and leaves the original alone", () => {
  const visitor = openedAs(Option.none()).model
  const asked = update(visitor, Message.ClickedSaveCopyOfPlaylist())
  expect(formOf(asked.model)).toEqual(
    PlaylistForm.Copy({ name: 'Road trip (copy)' }),
  )
  const sent = update(asked.model, Message.SubmittedPlaylistForm())
  expect(commandNamed(sent, CreatePlaylist.name)?.args).toEqual({
    name: 'Road trip (copy)',
    songIds: ['a', 'b'],
  })
  const done = update(
    sent.model,
    Message.SucceededCreatePlaylist({
      id: createdId,
      editToken: token,
      name: 'Road trip (copy)',
      songIds: ['a', 'b'],
    }),
  )
  expect(done.model.mine).toEqual([
    {
      id: createdId,
      name: 'Road trip (copy)',
      editToken: token,
      origin: 'Created',
    },
  ])
  expect(ownedOpenedOf(done.model)).toMatchObject({
    value: { opened: { id: createdId, version: 1, songIds: ['a', 'b'] } },
  })
})

test('sharing an open playlist shows the view link, and the edit link only to its owner', () => {
  const visitor = update(
    openedAs(Option.none()).model,
    Message.ClickedSharePlaylist(),
  )
  expect(dialogOf(visitor.model)).toMatchObject({
    _tag: 'Shared',
    maybeEditToken: Option.none(),
  })
  const owner = update(settledOwner(), Message.ClickedSharePlaylist())
  expect(dialogOf(owner.model)).toMatchObject({
    maybeEditToken: Option.some(token),
  })
})

test('playlist dialogs do not change the queue or the song playing', () => {
  const before = sessionBefore()
  const opened = update(before.model, Message.ClickedSavePlaylist())
  expect(opened.model.setlist).toEqual(before.model.setlist)
})

test('a saved playlist counts as the opened one, so a reload of its link does not ask', () => {
  const done = update(submitSave('Queue', 'Rainy day Fio').model, created)
  expect(done.model.setlist.maybeOpenedPlaylistId).toEqual(
    Option.some(createdId),
  )
  expect(commandNamed(done, SaveSetlist.name)).toBeDefined()
})

test('opening the saved link again after a save neither asks nor refetches', () => {
  const done = update(submitSave('Queue', 'Rainy day Fio').model, created)
  const again = update(
    done.model,
    Message.OpenedPlaylist({ id: createdId, maybeEditToken: Option.none() }),
  )
  expect(again.model.playlistOpen._tag).toBe('Opened')
  expect(again.commands ?? []).toEqual([])
})

test('an #edit link for the opened playlist is picked up even though re-entry is a no-op', () => {
  const done = update(submitSave('Queue', 'Rainy day Fio').model, created)
  const forgotten = { ...done.model, mine: [] }
  const again = update(
    forgotten,
    Message.OpenedPlaylist({
      id: createdId,
      maybeEditToken: Option.some(token),
    }),
  )
  expect(again.model.playlistOpen._tag).toBe('Opened')
  expect(again.model.mine).toEqual([
    {
      id: createdId,
      name: 'Rainy day Fio',
      editToken: token,
      origin: 'PickedUp',
    },
  ])
})

const forgedToken = Schema.decodeSync(EditToken)('forged-token-XYZ')
const MY_PLAYLISTS_STORAGE_KEY = 'karaoke-my-playlists'
const ownerWithFragment = (fragment: EditToken) =>
  through(
    update,
    Message.SucceededFetchSongs({ songs: [a, b, c], goneVideoIds: [] }),
    Message.CompletedLoadMyPlaylists({
      maybeJson: Option.some(
        ownedToJson([
          {
            id: openingId,
            name: 'Road trip',
            editToken: token,
            origin: 'Created',
          },
        ]),
      ),
      maybeAttemptsJson: Option.none(),
      origin: 'https://fio.example',
    }),
    Message.OpenedPlaylist({
      id: openingId,
      maybeEditToken: Option.some(fragment),
    }),
    noSavedQueue,
    Message.SucceededFetchPlaylist({ playlist: playlistOf(a, b) }),
  )
const renameSubmitted = (current: Model) =>
  update(
    update(
      update(current, Message.ClickedRenamePlaylist()).model,
      Message.UpdatedPlaylistName({ value: 'Night drive' }),
    ).model,
    Message.SubmittedPlaylistForm(),
  )
const tokenSent = (result: UpdateReturn) => {
  const maybeToken = commandNamed(result, ReplacePlaylist.name)?.args?.[
    'maybeEditToken'
  ]
  return Option.isOption(maybeToken)
    ? Option.getOrUndefined(maybeToken)
    : undefined
}

test('a save in one tab keeps the entries another tab stored meanwhile', async () => {
  const other: Owned = {
    id: createdId,
    name: 'Other tab',
    editToken: forgedToken,
    origin: 'Created',
  }
  window.localStorage.setItem(MY_PLAYLISTS_STORAGE_KEY, ownedToJson([other]))
  const mineHere: Owned = {
    id: openingId,
    name: 'Road trip',
    editToken: token,
    origin: 'Created',
  }
  await Effect.runPromise(
    SaveMyPlaylists({ change: OwnedChange.Remember({ entry: mineHere }) })
      .effect,
  )
  expect(
    parseOwned(
      Option.fromNullishOr(
        window.localStorage.getItem(MY_PLAYLISTS_STORAGE_KEY),
      ),
    ),
  ).toEqual([other, mineHere])
  await Effect.runPromise(
    SaveMyPlaylists({ change: OwnedChange.Forget({ id: openingId }) }).effect,
  )
  expect(
    parseOwned(
      Option.fromNullishOr(
        window.localStorage.getItem(MY_PLAYLISTS_STORAGE_KEY),
      ),
    ),
  ).toEqual([other])
  window.localStorage.removeItem(MY_PLAYLISTS_STORAGE_KEY)
})

test('a change made in another tab reaches this tab', () => {
  const other: Owned = {
    id: createdId,
    name: 'Other tab',
    editToken: forgedToken,
    origin: 'Created',
  }
  const synced = update(
    init(),
    Message.ChangedMyPlaylistsElsewhere({
      maybeJson: Option.some(ownedToJson([other])),
    }),
  )
  expect(synced.model.mine).toEqual([other])
  const cleared = update(
    synced.model,
    Message.ChangedMyPlaylistsElsewhere({ maybeJson: Option.none() }),
  )
  expect(cleared.model.mine).toEqual([])
})

test('an edit link for a playlist that already has a stored token leaves the stored token alone', () => {
  const opened = ownerWithFragment(forgedToken)
  expect(opened.model.mine).toEqual([
    { id: openingId, name: 'Road trip', editToken: token, origin: 'Created' },
  ])
  expect(commandNamed(opened, SaveMyPlaylists.name)).toBeUndefined()
  expect(tokenSent(renameSubmitted(opened.model))).toBe(token)
})

test('a stored token that the server rejects falls back to the edit link token, which is kept once it works', () => {
  const real = Schema.decodeSync(EditToken)('real-token-123')
  const submitted = renameSubmitted(ownerWithFragment(real).model)
  const retried = update(
    submitted.model,
    Message.FailedWritePlaylist({
      failure: WriteFailure.Forbidden(),
      maybeEditToken: Option.some(token),
    }),
  )
  expect(tokenSent(retried)).toBe(real)
  expect(dialogOf(retried.model)._tag).toBe('Sending')
  expect(retried.model.mine[0]?.editToken).toBe(token)
  const done = update(
    retried.model,
    Message.SucceededReplacePlaylist({
      name: 'Night drive',
      songIds: ['a', 'b'],
      version: 2,
      maybeEditToken: Option.some(real),
    }),
  )
  expect(done.model.mine).toEqual([
    { id: openingId, name: 'Night drive', editToken: real, origin: 'PickedUp' },
  ])
  expect(done.model.maybeCandidate).toEqual(Option.none())
})

test('when the edit link token is rejected too, the playlist is a visitor view and nothing is kept', () => {
  const submitted = renameSubmitted(ownerWithFragment(forgedToken).model)
  const retried = update(
    submitted.model,
    Message.FailedWritePlaylist({
      failure: WriteFailure.Forbidden(),
      maybeEditToken: Option.some(token),
    }),
  )
  const failed = update(
    retried.model,
    Message.FailedWritePlaylist({
      failure: WriteFailure.Forbidden(),
      maybeEditToken: Option.some(forgedToken),
    }),
  )
  expect(ownedOpenedOf(failed.model)._tag).toBe('None')
  expect(failed.model.maybeCandidate).toEqual(Option.none())
  expect(failed.model.mine).toEqual([])
  expect(writeFailureOf(failed.model)).toBe('Forbidden')
  expect(commandNamed(failed, SaveMyPlaylists.name)?.args?.['change']).toEqual(
    OwnedChange.Forget({ id: openingId }),
  )
})

test('a rejected token turns the owner bar into a visitor bar', () => {
  const submitted = renameSubmitted(settledOwner())
  const failed = update(
    submitted.model,
    Message.FailedWritePlaylist({
      failure: WriteFailure.Forbidden(),
      maybeEditToken: Option.some(token),
    }),
  )
  expect(ownedOpenedOf(failed.model)._tag).toBe('None')
  expect(failed.model.playlistOpen._tag).toBe('Opened')
})

test('a playlist deleted by someone else leaves the owner in the deleted state', () => {
  const submitted = renameSubmitted(settledOwner())
  const failed = update(
    submitted.model,
    Message.FailedWritePlaylist({
      failure: WriteFailure.Deleted(),
      maybeEditToken: Option.some(token),
    }),
  )
  expect(failed.model.playlistOpen._tag).toBe('Idle')
  expect(failed.model.mine).toEqual([])
  expect(dialogOf(failed.model)._tag).toBe('Closed')
  expect(toastOf(failed.model)?._tag).toBe('PlaylistDeleted')
  expect(urlSyncs(failed)).toContain('/')
})

const connectedAs = (
  base: Model,
  name = 'Fake Fan',
  playlists: ReadonlyArray<{ id: PlaylistId; name: string }> = [],
): Model =>
  update(
    update(base, Message.SucceededLoadAccount({ discordId: '1', name })).model,
    Message.SucceededLoadAccountPlaylists({
      accountId: '1',
      playlists,
      attempted: [],
    }),
  ).model

const argsOf = (result: UpdateReturn, name: string) =>
  commandNamed(result, name)?.args

test('the account is asked for once, then connecting lists the account playlists', () => {
  const asked = entered(init())
  expect(commandNamed(asked, LoadAccount.name)).toBeDefined()
  const connected = update(
    asked.model,
    Message.SucceededLoadAccount({ discordId: '1', name: 'Fake Fan' }),
  )
  expect(connected.model.account._tag).toBe('Connected')
  expect(argsOf(connected, LoadAccountPlaylists.name)).toEqual({
    owned: [],
    accountId: '1',
    attempted: [],
  })
  const listed = update(
    connected.model,
    Message.SucceededLoadAccountPlaylists({
      accountId: '1',
      playlists: [{ id: openingId, name: 'Road trip' }],
      attempted: [],
    }),
  )
  expect(listed.model.account).toEqual(
    Account.Connected({
      name: 'Fake Fan',
      playlists: [{ id: openingId, name: 'Road trip' }],
    }),
  )
})

test('connecting sends the tokens this browser already holds to be claimed', () => {
  const held = update(
    init(),
    Message.CompletedLoadMyPlaylists({
      maybeJson: ownedJson(
        JSON.stringify([
          { id: openingId, name: 'Road trip', editToken: token },
        ]),
      ),
      maybeAttemptsJson: Option.none(),
      origin: 'https://fio.example',
    }),
  )
  const connected = update(
    held.model,
    Message.SucceededLoadAccount({ discordId: '1', name: 'Fake Fan' }),
  )
  expect(argsOf(connected, LoadAccountPlaylists.name)).toEqual({
    owned: [
      { id: openingId, name: 'Road trip', editToken: token, origin: 'Created' },
    ],
    accountId: '1',
    attempted: [],
  })
})

test.each([
  ['SignedOut', 'SignedOut'],
  ['Unavailable', 'Unavailable'],
] as const)(
  'no account (%s) is the account state %s, never a failure',
  (kind, tag) => {
    const result = update(
      entered(init()).model,
      Message.FailedLoadAccount({ kind }),
    )
    expect(result.model.account._tag).toBe(tag)
    expect(result.commands).toBeUndefined()
    expect(toastOf(result.model)).toBeUndefined()
  },
)

test('Connect Discord starts the login only when login is offered and nobody is connected', () => {
  const signedOut = update(
    init(),
    Message.FailedLoadAccount({ kind: 'SignedOut' }),
  )
  expect(
    commandNamed(
      update(signedOut.model, Message.ClickedConnectDiscord()),
      StartLogin.name,
    ),
  ).toBeDefined()
  for (const account of [
    Account.Loading(),
    Account.Unavailable(),
    Account.Connected({ name: 'x', playlists: [] }),
  ]) {
    const clicked = update(
      { ...init(), account },
      Message.ClickedConnectDiscord(),
    )
    expect(clicked.commands).toBeUndefined()
  }
})

test('a connected account owns its playlists with no edit token held', () => {
  const visitor = openedAs(Option.none()).model
  expect(ownedOpenedOf(visitor)._tag).toBe('None')
  const connected = connectedAs(visitor, 'Fake Fan', [
    { id: openingId, name: 'Road trip' },
  ])
  const owned = ownedOpenedOf(connected)
  expect(Option.map(owned, ({ maybeEditToken }) => maybeEditToken)).toEqual(
    Option.some(Option.none()),
  )
})

test('another account sees no owner actions on a playlist it does not own', () => {
  const other = connectedAs(openedAs(Option.none()).model, 'User B', [
    { id: otherId, name: 'Theirs' },
  ])
  expect(ownedOpenedOf(other)._tag).toBe('None')
})

test('an owner renames without a token, and the account list follows the name', () => {
  const owner = connectedAs(openedAs(Option.none()).model, 'Fake Fan', [
    { id: openingId, name: 'Road trip' },
  ])
  const submitted = update(
    update(
      update(owner, Message.ClickedRenamePlaylist()).model,
      Message.UpdatedPlaylistName({ value: 'Night drive' }),
    ).model,
    Message.SubmittedPlaylistForm(),
  )
  expect(argsOf(submitted, ReplacePlaylist.name)).toMatchObject({
    id: openingId,
    maybeEditToken: Option.none(),
    name: 'Night drive',
  })
  const done = update(
    submitted.model,
    Message.SucceededReplacePlaylist({
      name: 'Night drive',
      songIds: ['a', 'b'],
      version: 2,
      maybeEditToken: Option.none(),
    }),
  )
  expect(done.model.mine).toEqual([])
  expect(commandNamed(done, SaveMyPlaylists.name)).toBeUndefined()
  expect(done.model.account).toEqual(
    Account.Connected({
      name: 'Fake Fan',
      playlists: [{ id: openingId, name: 'Night drive' }],
    }),
  )
  expect(toastOf(done.model)?._tag).toBe('PlaylistUpdated')
})

test('an owner deletes without a token, and the playlist leaves the account list', () => {
  const owner = connectedAs(openedAs(Option.none()).model, 'Fake Fan', [
    { id: openingId, name: 'Road trip' },
  ])
  const sent = update(
    update(owner, Message.ClickedDeletePlaylist()).model,
    Message.SubmittedPlaylistForm(),
  )
  expect(argsOf(sent, RemovePlaylist.name)).toEqual({
    id: openingId,
    maybeEditToken: Option.none(),
  })
  const done = update(sent.model, Message.SucceededRemovePlaylist())
  expect(done.model.account).toEqual(
    Account.Connected({ name: 'Fake Fan', playlists: [] }),
  )
  expect(done.model.playlistOpen._tag).toBe('Idle')
  expect(toastOf(done.model)?._tag).toBe('PlaylistDeleted')
})

test('a connected owner who also holds the token sends the token along', () => {
  const owner = connectedAs(openedAs(Option.some(token)).model, 'Fake Fan', [
    { id: openingId, name: 'Road trip' },
  ])
  const sent = update(
    update(
      update(owner, Message.ClickedRenamePlaylist()).model,
      Message.UpdatedPlaylistName({ value: 'Night drive' }),
    ).model,
    Message.SubmittedPlaylistForm(),
  )
  expect(tokenSent(sent)).toBe(token)
})

test('saving while connected lists the new playlist on the account', () => {
  const created = update(
    connectedAs(init()),
    Message.SucceededCreatePlaylist({
      id: openingId,
      editToken: token,
      name: 'Rainy day Fio',
      songIds: ['a'],
    }),
  )
  expect(created.model.account).toEqual(
    Account.Connected({
      name: 'Fake Fan',
      playlists: [{ id: openingId, name: 'Rainy day Fio' }],
    }),
  )
})

test('disconnecting asks the server, then leaves no account while token playlists stay editable', () => {
  const owner = connectedAs(openedAs(Option.some(token)).model, 'Fake Fan', [
    { id: openingId, name: 'Road trip' },
  ])
  const asked = update(owner, Message.ClickedDisconnectDiscord())
  expect(commandNamed(asked, Logout.name)).toBeDefined()
  const gone = update(asked.model, Message.SucceededLogout())
  expect(gone.model.account._tag).toBe('SignedOut')
  expect(ownedOpenedOf(gone.model)._tag).toBe('Some')
  expect(gone.model.mine).toHaveLength(1)
})

test('a disconnect the server refuses keeps the account and says so', () => {
  const owner = connectedAs(init())
  const failed = update(owner, Message.FailedLogout())
  expect(failed.model.account._tag).toBe('Connected')
  expect(toastOf(failed.model)?._tag).toBe('DisconnectFailed')
})

test('only a disconnected visitor is asked to disconnect nothing', () => {
  const signedOut = update(
    init(),
    Message.FailedLoadAccount({ kind: 'SignedOut' }),
  ).model
  expect(
    update(signedOut, Message.ClickedDisconnectDiscord()).commands,
  ).toBeUndefined()
})

test.each(['state', 'limit', 'refused'] as const)(
  'landing on /?login=%s shows that failure and clears it from the address bar',
  reason => {
    const landed = update(
      init(),
      Message.OpenedFromUrl({ search: `?login=${reason}` }),
    )
    expect(toastOf(landed.model)).toMatchObject({
      _tag: 'LoginFailed',
      reason,
    })
    expect(urlSyncs(landed)).toEqual(['/'])
  },
)

test('an unknown login reason shows no toast but is still cleared from the address bar', () => {
  const landed = update(
    init(),
    Message.OpenedFromUrl({ search: '?login=<script>' }),
  )
  expect(toastOf(landed.model)).toBeUndefined()
  expect(urlSyncs(landed)).toEqual(['/'])
})

test('opening a playlist from the list closes the list', () => {
  const listing = update(init(), Message.ClickedOpenMyPlaylists())
  expect(dialogOf(listing.model)._tag).toBe('Account')
  const opened = update(
    listing.model,
    Message.OpenedPlaylist({ id: openingId, maybeEditToken: Option.none() }),
  )
  expect(dialogOf(opened.model)._tag).toBe('Closed')
})

const accountOwnerRenaming = () => {
  const owner = connectedAs(openedAs(Option.none()).model, 'Fake Fan', [
    { id: openingId, name: 'Road trip' },
  ])
  return update(
    update(
      update(owner, Message.ClickedRenamePlaylist()).model,
      Message.UpdatedPlaylistName({ value: 'Night drive' }),
    ).model,
    Message.SubmittedPlaylistForm(),
  )
}

test('a refused account write asks who the session is before it blames the edit link', () => {
  const refused = update(
    accountOwnerRenaming().model,
    Message.FailedWritePlaylist({
      failure: WriteFailure.Forbidden(),
      maybeEditToken: Option.none(),
    }),
  )
  expect(commandNamed(refused, RecheckAccount.name)).toBeDefined()
  expect(dialogOf(refused.model)._tag).toBe('Sending')
})

test('an account write refused after the session ended shows the signed-out account, not a failure', () => {
  const refused = update(
    accountOwnerRenaming().model,
    Message.FailedWritePlaylist({
      failure: WriteFailure.Forbidden(),
      maybeEditToken: Option.none(),
    }),
  )
  const rechecked = update(
    refused.model,
    Message.CompletedRecheckAccount({ signedOut: true }),
  )
  expect(rechecked.model.account._tag).toBe('SignedOut')
  expect(dialogOf(rechecked.model)._tag).toBe('Account')
})

test('an account write refused for a session that is still good shows the refusal', () => {
  const refused = update(
    accountOwnerRenaming().model,
    Message.FailedWritePlaylist({
      failure: WriteFailure.Forbidden(),
      maybeEditToken: Option.none(),
    }),
  )
  const rechecked = update(
    refused.model,
    Message.CompletedRecheckAccount({ signedOut: false }),
  )
  expect(rechecked.model.account._tag).toBe('Connected')
  expect(writeFailureOf(rechecked.model)).toBe('Forbidden')
})

test('a refused write that carried a token never re-checks the account', () => {
  const refused = update(
    renameSubmitted(ownerWithFragment(token).model).model,
    Message.FailedWritePlaylist({
      failure: WriteFailure.Forbidden(),
      maybeEditToken: Option.some(forgedToken),
    }),
  )
  expect(commandNamed(refused, RecheckAccount.name)).toBeUndefined()
})

const originsOf = (model: Model) => model.mine.map(({ origin }) => origin)

test('a playlist this browser saved is remembered as created', () => {
  const done = update(submitSave('Queue', 'Rainy day Fio').model, created)
  expect(originsOf(done.model)).toEqual(['Created'])
})

test('an edit link opened on a playlist this browser does not hold is remembered as picked up', () => {
  const opened = through(
    update,
    Message.SucceededFetchSongs({ songs: [a, b, c], goneVideoIds: [] }),
    Message.OpenedPlaylist({
      id: openingId,
      maybeEditToken: Option.some(forgedToken),
    }),
    noSavedQueue,
    Message.SucceededFetchPlaylist({ playlist: playlistOf(a, b) }),
  )
  expect(originsOf(opened.model)).toEqual(['PickedUp'])
})

test('opening the edit link of a playlist this browser created keeps it created', () => {
  const saved = update(submitSave('Queue', 'Rainy day Fio').model, created)
  const reopened = update(
    saved.model,
    Message.PickedUpEditToken({ id: createdId, editToken: token }),
  )
  expect(originsOf(reopened.model)).toEqual(['Created'])
})

test('connecting hands the command the account id and the browser entries', () => {
  const connected = update(
    init(),
    Message.SucceededLoadAccount({
      discordId: '123456789012345678',
      name: 'Fan',
    }),
  )
  expect(argsOf(connected, LoadAccountPlaylists.name)).toMatchObject({
    accountId: '123456789012345678',
  })
})

test('refused claims are remembered, stored, and survive a reload for the same account', () => {
  const held = update(
    init(),
    Message.CompletedLoadMyPlaylists({
      maybeJson: Option.some(
        ownedToJson([
          {
            id: openingId,
            name: 'Road trip',
            editToken: token,
            origin: 'Created',
          },
        ]),
      ),
      maybeAttemptsJson: Option.none(),
      origin: 'https://fio.example',
    }),
  )
  const connected = update(
    held.model,
    Message.SucceededLoadAccount({ discordId: '7', name: 'Fan' }),
  )
  expect(argsOf(connected, LoadAccountPlaylists.name)).toMatchObject({
    attempted: [],
  })
  const answered = update(
    connected.model,
    Message.SucceededLoadAccountPlaylists({
      accountId: '7',
      playlists: [],
      attempted: [openingId],
    }),
  )
  expect(argsOf(answered, SaveClaimAttempts.name)).toEqual({
    accountId: '7',
    ids: [openingId],
  })
  const again = update(
    answered.model,
    Message.SucceededLoadAccount({ discordId: '7', name: 'Fan' }),
  )
  expect(argsOf(again, LoadAccountPlaylists.name)).toMatchObject({
    attempted: [openingId],
  })
  const other = update(
    answered.model,
    Message.SucceededLoadAccount({ discordId: '8', name: 'Other' }),
  )
  expect(argsOf(other, LoadAccountPlaylists.name)).toMatchObject({
    attempted: [],
  })
})

test('claim attempts saved by a past page come back with the stored playlists', async () => {
  await Effect.runPromise(
    SaveClaimAttempts({ accountId: '7', ids: [openingId] }).effect,
  )
  const stored = window.localStorage.getItem('karaoke-claim-attempts')
  window.localStorage.removeItem('karaoke-claim-attempts')
  const loaded = update(
    init(),
    Message.CompletedLoadMyPlaylists({
      maybeJson: Option.none(),
      maybeAttemptsJson: Option.fromNullishOr(stored),
      origin: 'https://fio.example',
    }),
  )
  const connected = update(
    loaded.model,
    Message.SucceededLoadAccount({ discordId: '7', name: 'Fan' }),
  )
  expect(argsOf(connected, LoadAccountPlaylists.name)).toMatchObject({
    attempted: [openingId],
  })
})
