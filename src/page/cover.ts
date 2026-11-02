import { Array, Effect, Option, Random, Result, Schema, Stream } from 'effect'
import { AsyncData, Command, Mount, Submodel, type Update } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { twMerge } from 'tailwind-merge'

import { fetchJson } from '../api'
import { Cover } from '../domain.ts'
import { makeFuzzySearch } from '../fuzzySearch'
import { icon } from '../icons'
import { homeRouter } from '../route'
import { PlayerEvent, playerEvents } from '../youtube'

const PLAYER_HOST_ID = 'cover'

// MODEL

const VideosData = AsyncData.Schema(Schema.Array(Cover), Schema.String)

const PlayerError = Schema.Struct({
  videoId: Schema.String,
  reason: Schema.String,
})

export const Model = Schema.Struct({
  videos: VideosData.schema,
  currentIndex: Schema.Number,
  isAutoplay: Schema.Boolean,
  isShuffle: Schema.Boolean,
  isPlaylistOpen: Schema.Boolean,
  search: Schema.String,
  maybePlayerError: Schema.Option(PlayerError),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededFetchCovers: { videos: Schema.Array(Cover) },
  FailedFetchCovers: { error: Schema.String },
  ClickedRetryFetch: {},
  ClickedNext: {},
  ClickedPrevious: {},
  ClickedToggleAutoplay: {},
  ClickedToggleShuffle: {},
  ClickedTogglePlaylist: {},
  ClickedClosePlaylist: {},
  ClickedVideo: { videoId: Schema.String },
  ClickedBackHome: {},
  UpdatedSearch: { value: Schema.String },
  EndedVideo: {},
  FailedLoadPlayer: { videoId: Schema.String, reason: Schema.String },
  CompletedPickRandomVideo: { index: Schema.Number },
  CompletedPlayFioSound: {},
})
export type Message = typeof Message.Type

// COMMAND

export const FetchCovers = Command.define('FetchCovers', {
  messages: [Message.SucceededFetchCovers, Message.FailedFetchCovers],
  execute: fetchJson('/api/get-cover', Schema.Array(Cover)).pipe(
    Effect.match({
      onFailure: error => Message.FailedFetchCovers({ error }),
      onSuccess: videos => Message.SucceededFetchCovers({ videos }),
    }),
  ),
})

// NOTE: it never picks the current video, because the same video would not start again and autoplay would stop.
export const PickRandomVideo = Command.define('PickRandomVideo', {
  args: { count: Schema.Number, currentIndex: Schema.Number },
  messages: [Message.CompletedPickRandomVideo],
  execute: ({ count, currentIndex }) =>
    Random.nextIntBetween(0, Math.max(count - 1, 1)).pipe(
      Effect.map(index =>
        Message.CompletedPickRandomVideo({
          index: index >= currentIndex && count > 1 ? index + 1 : index,
        }),
      ),
    ),
})

const PlayFioSound = Command.define('PlayFioSound', {
  messages: [Message.CompletedPlayFioSound],
  execute: Effect.tryPromise(() => new Audio('/piosayang.mp3').play()).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedPlayFioSound()),
  ),
})

const playerEventToMessage =
  (videoId: string) =>
  (
    event: PlayerEvent,
  ): Result.Result<
    typeof Message.EndedVideo.Type | typeof Message.FailedLoadPlayer.Type,
    void
  > =>
    PlayerEvent.match(event, {
      Ready: () => Result.failVoid,
      Playing: () => Result.failVoid,
      Paused: () => Result.failVoid,
      Ended: () => Result.succeed(Message.EndedVideo()),
      Failed: ({ reason }) =>
        Result.succeed(Message.FailedLoadPlayer({ videoId, reason })),
    })

const MountPlayer = Mount.defineStream('MountCoverPlayer', {
  args: { videoId: Schema.String },
  messages: [Message.EndedVideo, Message.FailedLoadPlayer],
  execute: ({ element, videoId }) =>
    playerEvents(element, {
      hostId: PLAYER_HOST_ID,
      videoId,
      playerVars: { autoplay: 1, controls: 1, rel: 0, modestbranding: 1 },
    }).pipe(Stream.filterMap(playerEventToMessage(videoId))),
})

// INIT

export const init = (): Model => ({
  videos: VideosData.Idle(),
  currentIndex: 0,
  isAutoplay: false,
  isShuffle: false,
  isPlaylistOpen: false,
  search: '',
  maybePlayerError: Option.none(),
})

export type UpdateReturn = Update.Return<Model, Message>

const fetchIfNeeded = (model: Model): UpdateReturn =>
  Option.match(AsyncData.revalidateOrLoad(model.videos), {
    onNone: () => ({ model }),
    onSome: videos => ({
      model: modifyFields(model, { videos: () => videos }),
      commands: [FetchCovers()],
    }),
  })

/** Each visit starts fresh at the newest video, showing what we have while it refreshes. */
export const entered = (model: Model): UpdateReturn =>
  fetchIfNeeded(modifyFields(init(), { videos: () => model.videos }))

// UPDATE

const allVideos = (model: Model): ReadonlyArray<Cover> =>
  Option.getOrElse(AsyncData.getData(model.videos), () => [])

const moveBy = (model: Model, step: 1 | -1): UpdateReturn => {
  const count = allVideos(model).length
  if (count === 0) {
    return { model }
  }
  if (model.isShuffle) {
    return {
      model,
      commands: [PickRandomVideo({ count, currentIndex: model.currentIndex })],
    }
  }
  return {
    model: modifyFields(model, {
      currentIndex: index => (index + step + count) % count,
    }),
  }
}

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    SucceededFetchCovers: ({ videos }) => ({
      model: modifyFields(model, {
        videos: current => AsyncData.settle(current, Result.succeed(videos)),
      }),
    }),

    FailedFetchCovers: ({ error }) => ({
      model: modifyFields(model, {
        videos: current => AsyncData.settle(current, Result.fail(error)),
      }),
    }),

    ClickedRetryFetch: () => fetchIfNeeded(model),
    ClickedNext: () => moveBy(model, 1),
    ClickedPrevious: () => moveBy(model, -1),
    EndedVideo: () => (model.isAutoplay ? moveBy(model, 1) : { model }),
    FailedLoadPlayer: ({ videoId, reason }) => ({
      model: modifyFields(model, {
        maybePlayerError: () => Option.some({ videoId, reason }),
      }),
    }),

    ClickedToggleAutoplay: () => ({
      model: modifyFields(model, { isAutoplay: isOn => !isOn }),
    }),
    ClickedToggleShuffle: () => ({
      model: modifyFields(model, { isShuffle: isOn => !isOn }),
    }),
    ClickedTogglePlaylist: () => ({
      model: modifyFields(model, { isPlaylistOpen: isOpen => !isOpen }),
    }),
    ClickedClosePlaylist: () => ({
      model: modifyFields(model, { isPlaylistOpen: () => false }),
    }),

    ClickedVideo: ({ videoId }) =>
      Option.match(
        Array.findFirstIndex(allVideos(model), ({ id }) => id === videoId),
        {
          onNone: () => ({ model }),
          onSome: index => ({
            model: modifyFields(model, {
              currentIndex: () => index,
              isPlaylistOpen: () => false,
            }),
          }),
        },
      ),

    ClickedBackHome: () => ({ model, commands: [PlayFioSound()] }),

    UpdatedSearch: ({ value }) => ({
      model: modifyFields(model, { search: () => value }),
    }),

    CompletedPickRandomVideo: ({ index }) => ({
      model: modifyFields(model, { currentIndex: () => index }),
    }),

    CompletedPlayFioSound: () => ({ model }),
  })

// VIEW

const maybeCurrentVideo = (model: Model): Option.Option<Cover> =>
  Array.get(allVideos(model), model.currentIndex)

const searchVideos = makeFuzzySearch<Cover>(['title'])

const visibleVideos = (model: Model): ReadonlyArray<Cover> =>
  searchVideos(allVideos(model), model.search)

const playlistRowView = (
  video: Cover,
  isActive: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed('button')(
    video.id,
    [
      h.OnClick(Message.ClickedVideo({ videoId: video.id })),
      h.Class(
        twMerge(
          'w-full text-left p-3 rounded-lg flex items-center gap-3 transition-all group mb-1',
          isActive
            ? 'bg-blue-600/20 border border-blue-500/30 text-white'
            : 'hover:bg-white/5 text-white/80 hover:text-white border border-transparent',
        ),
      ),
    ],
    [
      h.div(
        [
          h.Class(
            twMerge(
              'w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors',
              isActive
                ? 'bg-blue-500 text-white'
                : 'bg-white/10 group-hover:bg-white/20 text-white/50',
            ),
          ),
        ],
        [
          isActive
            ? icon('playFill', '20', '', h)
            : icon('musicNote', '18', '', h),
        ],
      ),
      h.div(
        [h.Class('flex-1 min-w-0')],
        [
          h.h3(
            [
              h.Class(
                twMerge(
                  'font-medium truncate text-sm',
                  isActive ? 'text-white' : 'text-white/90',
                ),
              ),
            ],
            [video.title],
          ),
        ],
      ),
      isActive
        ? h.div([
            h.Class(
              'w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.6)] animate-pulse',
            ),
          ])
        : h.empty,
    ],
  )

const playlistView = (
  model: Model,
  className: string,
  h: HtmlBuilder<Message>,
): Html => {
  const visible = visibleVideos(model)
  const maybeCurrent = maybeCurrentVideo(model)
  return h.div(
    [
      h.Class(
        twMerge(
          'flex flex-col h-full bg-white/5 backdrop-blur-xl border-l border-white/10 md:w-80 lg:w-96',
          className,
        ),
      ),
    ],
    [
      h.div(
        [h.Class('p-4 border-b border-white/10 bg-black/20')],
        [
          h.div(
            [h.Class('relative')],
            [
              icon(
                'search',
                '1em',
                'absolute left-3 top-1/2 -translate-y-1/2 text-white/40',
                h,
              ),
              h.input([
                h.Type('text'),
                h.Placeholder('Search covers...'),
                h.Value(model.search),
                h.OnInput(value => Message.UpdatedSearch({ value })),
                h.Class(
                  'w-full bg-white/10 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-light',
                ),
              ]),
            ],
          ),
        ],
      ),
      h.div(
        [
          h.Class(
            'flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent p-2',
          ),
        ],
        Array.match(visible, {
          onEmpty: () => [
            h.div(
              [h.Class('p-8 text-center text-white/40 italic')],
              ['No songs found'],
            ),
          ],
          onNonEmpty: videos =>
            videos.map(video =>
              playlistRowView(
                video,
                Option.exists(maybeCurrent, ({ id }) => id === video.id),
                h,
              ),
            ),
        }),
      ),
      h.div(
        [
          h.Class(
            'p-3 text-xs text-white/30 text-center border-t border-white/10',
          ),
        ],
        [`${visible.length} Songs Loaded`],
      ),
    ],
  )
}

const controlButtonClass =
  'p-3 rounded-full hover:bg-white/10 active:scale-95 transition-all text-white'

const playerView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const maybeVideo = maybeCurrentVideo(model)
  return h.div(
    [h.Class('w-full max-w-4xl mx-auto flex flex-col gap-6')],
    [
      h.div(
        [
          h.Class(
            'relative group w-full aspect-video rounded-3xl overflow-hidden shadow-2xl ring-1 ring-white/10 bg-black/40 backdrop-blur-md',
          ),
        ],
        [
          h.div(
            [h.Class('absolute inset-0 z-0')],
            [
              Option.match(maybeVideo, {
                onNone: () => h.empty,
                onSome: video =>
                  h.keyed('div')(video.id, [
                    h.Class('w-full h-full'),
                    h.OnMount(MountPlayer({ videoId: video.video_id })),
                  ]),
              }),
            ],
          ),
        ],
      ),
      h.div(
        [
          h.Class(
            'w-full p-6 rounded-3xl bg-white/10 backdrop-blur-xl border border-white/10 shadow-lg flex flex-col md:flex-row items-center justify-between gap-4 text-white',
          ),
        ],
        [
          h.div(
            [h.Class('flex-1 text-center md:text-left min-w-0')],
            [
              h.h2(
                [
                  h.Class(
                    'text-2xl font-bold truncate tracking-tight text-white mb-1',
                  ),
                ],
                [
                  Option.match(maybeVideo, {
                    onNone: () => 'Select a song',
                    onSome: ({ title }) => title,
                  }),
                ],
              ),
              h.p(
                [
                  h.Class(
                    'text-white/40 text-sm mt-1 italic group-hover:text-blue-400/50 transition-colors',
                  ),
                ],
                [
                  Option.getOrElse(
                    Option.flatMap(maybeVideo, ({ video_id }) =>
                      Option.map(
                        Option.filter(
                          model.maybePlayerError,
                          ({ videoId }) => videoId === video_id,
                        ),
                        ({ reason }) => reason,
                      ),
                    ),
                    () => "You don't have to be alone...",
                  ),
                ],
              ),
              h.p(
                [h.Class('text-sm text-blue-200/80 font-medium')],
                ["Fiona's Cover"],
              ),
            ],
          ),
          h.div(
            [h.Class('flex items-center gap-6')],
            [
              h.button(
                [
                  h.OnClick(Message.ClickedToggleShuffle()),
                  h.Title('Shuffle'),
                  h.Class(
                    twMerge(
                      'p-2 rounded-full transition-all hover:bg-white/10 active:scale-95',
                      model.isShuffle ? 'text-blue-400' : 'text-white/50',
                    ),
                  ),
                ],
                [icon('shuffle', '20', '', h)],
              ),
              h.button(
                [
                  h.OnClick(Message.ClickedPrevious()),
                  h.Title('Previous'),
                  h.Class(controlButtonClass),
                ],
                [icon('skipStart', '28', '', h)],
              ),
              h.button(
                [
                  h.OnClick(Message.ClickedNext()),
                  h.Title('Next'),
                  h.Class(controlButtonClass),
                ],
                [icon('skipEnd', '28', '', h)],
              ),
              h.button(
                [
                  h.OnClick(Message.ClickedToggleAutoplay()),
                  h.Title('Autoplay Next'),
                  h.Class(
                    twMerge(
                      'p-2 rounded-full transition-all hover:bg-white/10 active:scale-95 flex items-center gap-2',
                      model.isAutoplay
                        ? 'text-blue-400 bg-blue-500/10'
                        : 'text-white/50',
                    ),
                  ),
                ],
                [icon('repeat', '20', '', h)],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

const skeletonView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('animate-pulse flex flex-col items-center gap-4')],
    [
      h.div([h.Class('w-full max-w-4xl aspect-video bg-white/5 rounded-3xl')]),
      h.div([h.Class('w-full max-w-4xl h-24 bg-white/5 rounded-3xl')]),
    ],
  )

const failureView = (error: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('text-center text-white/70 p-4')],
    [
      h.p([h.Class('font-semibold')], ['Could not load the covers']),
      h.p([h.Class('text-sm mt-2 opacity-75')], [error]),
      h.button(
        [
          h.OnClick(Message.ClickedRetryFetch()),
          h.Class(
            'mt-4 px-4 py-1.5 rounded-full text-xs font-medium bg-blue-600 text-white',
          ),
        ],
        ['Try again'],
      ),
    ],
  )

export const view = Submodel.defineView<Model, Message>((model, h): Html =>
  h.div(
    [
      h.Class(
        'relative min-h-screen bg-black overflow-hidden font-sans text-slate-200',
      ),
    ],
    [
      h.div([
        h.Class(
          'fixed inset-0 z-0 hidden md:block opacity-30 bg-cover bg-center blur-3xl scale-110 transition-all duration-1000 ease-in-out',
        ),
        h.Style(
          Option.match(maybeCurrentVideo(model), {
            onNone: () => ({}),
            onSome: ({ video_id }) => ({
              'background-image': `url(https://img.youtube.com/vi/${video_id}/maxresdefault.jpg)`,
            }),
          }),
        ),
      ]),
      h.div([
        h.Class(
          'fixed inset-0 z-0 md:hidden bg-gradient-to-b from-slate-900 to-black',
        ),
      ]),
      h.main(
        [h.Class('relative z-10 flex flex-col h-screen')],
        [
          h.header(
            [
              h.Class(
                'flex items-center justify-between px-6 py-4 bg-black/20 backdrop-blur-md border-b border-white/10 shrink-0',
              ),
            ],
            [
              h.a(
                [
                  h.Href(homeRouter()),
                  h.OnClick(Message.ClickedBackHome()),
                  h.Class(
                    'group flex items-center gap-2 text-white/70 hover:text-white transition-colors',
                  ),
                ],
                [
                  h.i([
                    h.Class(
                      'fa-arrow-left text-xl group-hover:-translate-x-1 transition-transform',
                    ),
                  ]),
                  h.span(
                    [h.Class('font-medium hidden sm:inline')],
                    ['Back to Home'],
                  ),
                ],
              ),
              h.h1(
                [
                  h.Class(
                    'text-xl font-bold tracking-widest uppercase text-white/90',
                  ),
                ],
                [
                  'Fiona',
                  h.span([h.Class('text-blue-400')], ["'"]),
                  's Covers',
                ],
              ),
              h.button(
                [
                  h.OnClick(Message.ClickedTogglePlaylist()),
                  h.Class(
                    'p-2 rounded-full hover:bg-white/10 active:scale-95 transition-all text-white md:hidden',
                  ),
                ],
                [icon(model.isPlaylistOpen ? 'close' : 'list', '28', '', h)],
              ),
            ],
          ),
          h.div(
            [h.Class('flex-1 flex overflow-hidden relative')],
            [
              h.div(
                [
                  h.Class(
                    'flex-1 flex flex-col items-center justify-center p-4 md:p-8 overflow-y-auto',
                  ),
                ],
                [
                  AsyncData.matchData(model.videos, {
                    onEmpty: () => skeletonView(h),
                    onFailure: error => failureView(error, h),
                    onData: () => playerView(model, h),
                  }),
                  h.div(
                    [h.Class('mt-8 text-center text-sm text-white/30')],
                    [
                      'Background credits: ',
                      h.a(
                        [
                          h.Href('https://twitter.com/MaroonR19'),
                          h.Target('_blank'),
                          h.Rel('noopener noreferrer'),
                          h.Class(
                            'hover:text-blue-400 underline decoration-blue-400/30',
                          ),
                        ],
                        ['Maroon'],
                      ),
                    ],
                  ),
                ],
              ),
              h.div(
                [
                  h.Class(
                    'hidden md:block h-full border-l border-white/10 w-80 lg:w-96 shrink-0 bg-black/20 backdrop-blur-xl',
                  ),
                ],
                [playlistView(model, '', h)],
              ),
              h.div(
                [
                  h.Class(
                    twMerge(
                      'absolute inset-0 z-20 bg-slate-900/95 backdrop-blur-xl transition-transform duration-300 md:hidden',
                      model.isPlaylistOpen
                        ? 'translate-x-0'
                        : 'translate-x-full',
                    ),
                  ),
                ],
                [
                  h.div(
                    [h.Class('flex flex-col h-full')],
                    [
                      h.div(
                        [
                          h.Class(
                            'flex items-center justify-between p-4 border-b border-white/10',
                          ),
                        ],
                        [
                          h.h2(
                            [h.Class('text-lg font-bold text-white')],
                            ['Playlist'],
                          ),
                          h.button(
                            [
                              h.OnClick(Message.ClickedClosePlaylist()),
                              h.Class('p-2 text-white/70 hover:text-white'),
                            ],
                            [icon('close', '28', '', h)],
                          ),
                        ],
                      ),
                      playlistView(
                        model,
                        'w-full bg-transparent border-none',
                        h,
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  ),
)
