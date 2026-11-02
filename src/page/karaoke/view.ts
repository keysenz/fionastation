import { Array, Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import { type Html, type HtmlBuilder, createKeyedLazy } from 'foldkit/html'
import { twMerge } from 'tailwind-merge'

import { type PlayableSong, timestampToSeconds } from '../../domain.ts'
import { makeFuzzySearch } from '../../fuzzySearch'
import { homeRouter } from '../../route'
import { thumbnailUrl } from '../../youtube'
import {
  Message,
  type Model,
  MountPlayer,
  type SkipToast,
  allSongs,
} from './karaoke'
import type { NowPlaying } from './setlist.ts'

const visibleSongs = makeFuzzySearch<PlayableSong>(['song_title', 'title_text'])

const lazySongRow = createKeyedLazy()

const songRowView = (
  song: PlayableSong,
  isCurrent: boolean,
  isPlaying: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed('div')(
    song.id,
    [
      h.Class(
        twMerge(
          'group flex items-center justify-between p-3 rounded-lg transition-all cursor-pointer border border-transparent backdrop-blur-sm',
          'hover:bg-white/10 hover:border-white/5',
          isCurrent
            ? 'bg-sky-900/40 border-sky-500/30 shadow-[0_0_15px_rgba(14,165,233,0.1)]'
            : 'bg-black/20 hover:shadow-lg',
        ),
      ),
      h.OnClick(Message.ClickedSong({ song })),
    ],
    [
      h.div(
        [h.Class('flex items-center space-x-4 flex-1 min-w-0')],
        [
          h.div(
            [
              h.Class(
                'relative w-12 h-12 rounded overflow-hidden bg-slate-800 flex-shrink-0 shadow-md transition-transform group-hover:scale-105',
              ),
            ],
            [
              h.img([
                h.Src(thumbnailUrl(song.video_url)),
                h.Alt('thumb'),
                h.Class(
                  `w-full h-full object-cover transition-opacity ${isCurrent ? 'opacity-40' : 'opacity-80 group-hover:opacity-100'}`,
                ),
              ]),
              h.div(
                [
                  h.Class(
                    `absolute inset-0 flex items-center justify-center ${isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} bg-black/40 transition-opacity`,
                  ),
                ],
                [
                  h.i([
                    h.Class(
                      isCurrent && isPlaying
                        ? 'fas fa-chart-bar animate-pulse text-white drop-shadow-md'
                        : 'fas fa-play text-white drop-shadow-md',
                    ),
                  ]),
                ],
              ),
            ],
          ),
          h.div(
            [h.Class('flex-col min-w-0')],
            [
              h.h4(
                [
                  h.Class(
                    twMerge(
                      'font-medium text-sm truncate drop-shadow-sm transition-colors',
                      isCurrent
                        ? 'text-sky-300'
                        : 'text-white group-hover:text-sky-200',
                    ),
                  ),
                ],
                [song.song_title],
              ),
              h.p(
                [
                  h.Class(
                    'text-xs text-gray-300 truncate opacity-80 group-hover:opacity-100 transition-opacity',
                  ),
                ],
                [song.title_text],
              ),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('flex items-center px-1')],
        [
          h.button(
            [
              h.OnClick(Message.ClickedAddToQueue({ song }), {
                propagation: 'Stop',
              }),
              h.Class(
                'flex items-center space-x-2 px-3 py-2 rounded-full transition-all active:scale-95 bg-white/5 border border-white/10 text-gray-400 font-bold hover:bg-[#446e92]/20 hover:border-[#446e92]/50 hover:text-white opacity-0 group-hover:opacity-100',
              ),
            ],
            [
              h.i([h.Class('fas fa-list-ul text-xs')]),
              h.span(
                [
                  h.Class(
                    'text-[10px] uppercase tracking-widest whitespace-nowrap',
                  ),
                ],
                ['Add to Queue'],
              ),
            ],
          ),
        ],
      ),
    ],
  )

const songListView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const songs = allSongs(model)
  const visible = visibleSongs(songs, model.search)
  const maybeNowPlaying = model.setlist.maybeNowPlaying
  return h.div(
    [h.Class('space-y-1 pb-24')],
    Array.match(visible, {
      onEmpty: () => [
        h.div(
          [
            h.Class(
              'text-center text-gray-200 mt-10 p-4 bg-black/40 rounded-lg backdrop-blur-sm mx-auto max-w-md',
            ),
          ],
          [
            h.p(
              [h.Class('font-semibold')],
              [`No songs found for "${model.search}"`],
            ),
          ],
        ),
      ],
      onNonEmpty: nonEmpty =>
        nonEmpty.map(song => {
          const isCurrent = Option.exists(
            maybeNowPlaying,
            nowPlaying => nowPlaying.song.id === song.id,
          )
          const isPlaying = Option.exists(
            maybeNowPlaying,
            nowPlaying => nowPlaying.status === 'Playing',
          )
          return lazySongRow(song.id, songRowView, [
            song,
            isCurrent,
            isCurrent && isPlaying,
            h,
          ])
        }),
    }),
  )
}

const failureView = (error: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class(
        'text-center text-gray-200 mt-10 p-4 bg-black/40 rounded-lg backdrop-blur-sm mx-auto max-w-md',
      ),
    ],
    [
      h.p([h.Class('font-semibold')], ['Could not load the karaoke archive']),
      h.p([h.Class('text-sm mt-2 opacity-75')], [error]),
      h.button(
        [
          h.OnClick(Message.ClickedRetryFetch()),
          h.Class(
            'mt-4 px-4 py-1.5 rounded-full text-xs font-medium bg-[#446e92] text-white',
          ),
        ],
        ['Try again'],
      ),
    ],
  )

const spinnerView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('flex justify-center items-center h-40')],
    [
      h.div([
        h.Class('animate-spin rounded-full h-8 w-8 border-b-2 border-white'),
      ]),
    ],
  )

const headerView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('flex-none px-4 pt-4 pb-2 z-20')],
    [
      h.div(
        [h.Class('flex items-center justify-between mb-2')],
        [
          h.div(
            [h.Class('flex items-center space-x-3')],
            [
              h.a(
                [
                  h.Href(homeRouter()),
                  h.Class('text-gray-400 hover:text-white drop-shadow-md'),
                ],
                [h.i([h.Class('fas fa-arrow-left fa-lg')])],
              ),
              h.h1(
                [
                  h.Class(
                    'text-xl font-bold tracking-tight text-[#446e92] uppercase drop-shadow-md',
                  ),
                ],
                ['Karaoke'],
              ),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('mb-2 relative')],
        [
          h.div(
            [
              h.Class(
                'absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400',
              ),
            ],
            [h.i([h.Class('fas fa-search')])],
          ),
          h.input([
            h.Type('text'),
            h.Placeholder('Search songs...'),
            h.Class(
              'w-full bg-black/50 backdrop-blur-md text-white rounded-full py-2 pl-12 pr-4 text-sm border border-white/10 focus:border-[#446e92] focus:outline-none transition-all shadow-lg',
            ),
            h.Value(model.search),
            h.OnInput(value => Message.UpdatedSearch({ value })),
          ]),
        ],
      ),
    ],
  )

const queueDrawerView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { queue, history } = model.setlist
  return h.div(
    [
      h.Class(
        'flex flex-col h-full bg-transparent backdrop-blur-md border-l border-white/10 text-white overflow-hidden',
      ),
    ],
    [
      h.div(
        [h.Class('p-4 border-b border-white/10 bg-white/5')],
        [h.h2([h.Class('text-lg font-bold drop-shadow-md')], ['Up Next'])],
      ),
      h.div(
        [h.Class('flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar')],
        [
          ...Array.match(queue, {
            onEmpty: () => [
              h.div(
                [h.Class('text-center text-gray-300 text-sm py-10 opacity-75')],
                ['Queue is empty'],
              ),
            ],
            onNonEmpty: songs =>
              songs.map((song, index) =>
                h.div(
                  [
                    h.Class(
                      'flex items-center space-x-3 group p-2 rounded hover:bg-white/10 transition-colors',
                    ),
                  ],
                  [
                    h.div(
                      [h.Class('text-gray-400 text-xs w-4')],
                      [`${index + 1}`],
                    ),
                    h.div(
                      [
                        h.Class(
                          'w-10 h-10 bg-slate-800 rounded flex-shrink-0 overflow-hidden shadow-sm',
                        ),
                      ],
                      [
                        h.img([
                          h.Src(thumbnailUrl(song.video_url)),
                          h.Alt('art'),
                          h.Class('w-full h-full object-cover opacity-80'),
                        ]),
                      ],
                    ),
                    h.div(
                      [h.Class('flex-1 min-w-0')],
                      [
                        h.p(
                          [
                            h.Class(
                              'text-sm font-medium truncate group-hover:text-sky-300 cursor-pointer text-white drop-shadow-sm',
                            ),
                          ],
                          [song.song_title],
                        ),
                        h.p(
                          [h.Class('text-xs text-gray-300 truncate')],
                          ['Karaoke'],
                        ),
                      ],
                    ),
                  ],
                ),
              ),
          }),
          ...(Array.isReadonlyArrayNonEmpty(history)
            ? [
                h.div(
                  [h.Class('pt-4 border-t border-white/10 mt-4')],
                  [
                    h.h3(
                      [
                        h.Class(
                          'text-sm font-semibold text-gray-400 mb-2 px-2 uppercase tracking-wider',
                        ),
                      ],
                      ['History'],
                    ),
                  ],
                ),
                ...history.map(song =>
                  h.div(
                    [
                      h.Class(
                        'flex items-center space-x-3 opacity-60 hover:opacity-100 transition-opacity p-2 rounded hover:bg-white/5',
                      ),
                    ],
                    [
                      h.div(
                        [
                          h.Class(
                            'w-8 h-8 bg-slate-800 rounded flex-shrink-0 overflow-hidden',
                          ),
                        ],
                        [
                          h.img([
                            h.Src(thumbnailUrl(song.video_url)),
                            h.Alt('art'),
                            h.Class('w-full h-full object-cover'),
                          ]),
                        ],
                      ),
                      h.div(
                        [h.Class('flex-1 min-w-0')],
                        [
                          h.p(
                            [h.Class('text-sm truncate text-gray-200')],
                            [song.song_title],
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ]
            : []),
        ],
      ),
    ],
  )
}

const queuePanelView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class(
        twMerge(
          'fixed top-0 bottom-0 right-0 z-40 flex items-center transition-transform duration-300 ease-in-out',
          model.isQueueOpen ? 'translate-x-0' : 'translate-x-[20rem]',
        ),
      ),
    ],
    [
      h.button(
        [
          h.OnClick(Message.ClickedQueueHandle()),
          h.Class(
            'w-10 h-40 bg-[#446e92]/90 backdrop-blur-md rounded-l-2xl flex flex-col items-center justify-center shadow-[-4px_0_15px_rgba(0,0,0,0.5)] cursor-pointer hover:bg-[#578bb8] active:bg-[#3a5d7c] transition-all border-l border-t border-b border-white/20 gap-6 group',
          ),
        ],
        [
          h.i([
            h.Class(
              `fas fa-chevron-${model.isQueueOpen ? 'right' : 'left'} text-white/80 group-hover:text-white transition-colors`,
            ),
          ]),
          h.span(
            [
              h.Class(
                'text-[11px] uppercase font-bold tracking-[0.2em] -rotate-90 whitespace-nowrap text-white/90 group-hover:text-white transition-colors',
              ),
            ],
            ['Queue'],
          ),
          Array.isReadonlyArrayNonEmpty(model.setlist.queue)
            ? h.div([
                h.Class(
                  'w-2 h-2 bg-red-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(248,113,113,0.8)]',
                ),
              ])
            : h.empty,
        ],
      ),
      h.div(
        [
          h.Class(
            'w-80 h-full bg-black/80 backdrop-blur-xl border-l border-white/10 shadow-2xl',
          ),
        ],
        [queueDrawerView(model, h)],
      ),
    ],
  )

const playerBarView = (
  nowPlaying: NowPlaying,
  model: Model,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Class(
        'fixed bottom-0 left-0 right-0 bg-black/80 backdrop-blur-xl border-t border-white/10 text-white z-50 h-20 flex items-center px-4 shadow-2xl transition-all duration-300',
      ),
    ],
    [
      h.div(
        [
          h.Class(
            'absolute top-0 left-0 right-0 h-1 bg-white/10 cursor-pointer group',
          ),
        ],
        [
          h.div(
            [
              h.Class(
                'h-full bg-sky-500 w-0 group-hover:bg-sky-400 relative transition-all duration-300',
              ),
            ],
            [
              h.div([
                h.Class(
                  'absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 shadow-lg scale-0 group-hover:scale-100 transition-all',
                ),
              ]),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('flex items-center space-x-4 w-1/3')],
        [
          h.div(
            [
              h.Class('relative group cursor-pointer'),
              h.OnClick(Message.ClickedToggleExpanded()),
            ],
            [
              h.div(
                [
                  h.Class(
                    `transition-all duration-300 ${model.isExpanded ? 'w-0 h-0 opacity-0' : 'w-14 h-14 bg-gray-800 rounded overflow-hidden shadow-lg border border-white/10'}`,
                  ),
                ],
                [
                  h.img([
                    h.Src(thumbnailUrl(nowPlaying.song.video_url)),
                    h.Alt('art'),
                    h.Class('w-full h-full object-cover'),
                  ]),
                  h.div(
                    [
                      h.Class(
                        'absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity',
                      ),
                    ],
                    [
                      h.i([
                        h.Class('fas fa-chevron-up text-white drop-shadow-md'),
                      ]),
                    ],
                  ),
                ],
              ),
            ],
          ),
          h.div(
            [h.Class('min-w-0')],
            [
              h.h3(
                [h.Class('font-bold text-sm truncate drop-shadow-sm')],
                [nowPlaying.song.song_title],
              ),
              h.p(
                [h.Class('text-xs text-gray-400 truncate')],
                [
                  Option.getOrElse(
                    nowPlaying.maybeLoadError,
                    () => 'Karaoke Archive',
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('flex flex-col items-center justify-center w-1/3')],
        [
          h.div(
            [h.Class('flex items-center space-x-6')],
            [
              h.button(
                [
                  h.OnClick(Message.ClickedPrevious()),
                  h.Class(
                    'text-gray-300 hover:text-white transition hover:scale-110 active:scale-95',
                  ),
                ],
                [h.i([h.Class('fas fa-step-backward fa-lg drop-shadow-md')])],
              ),
              h.button(
                [
                  h.OnClick(Message.ClickedPlayPause()),
                  h.Class(
                    'w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-110 active:scale-95 transition shadow-lg hover:shadow-sky-500/20',
                  ),
                ],
                [
                  h.i([
                    h.Class(
                      nowPlaying.status === 'Playing'
                        ? 'fas fa-pause'
                        : 'fas fa-play pl-1',
                    ),
                  ]),
                ],
              ),
              h.button(
                [
                  h.OnClick(Message.ClickedNext()),
                  h.Class(
                    'text-gray-300 hover:text-white transition hover:scale-110 active:scale-95',
                  ),
                ],
                [h.i([h.Class('fas fa-step-forward fa-lg drop-shadow-md')])],
              ),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('flex items-center justify-end space-x-4 w-1/3')],
        [
          h.button(
            [
              h.OnClick(Message.ClickedToggleExpanded()),
              h.Class(
                'text-gray-300 hover:text-white transition hover:rotate-90',
              ),
            ],
            [h.i([h.Class('fas fa-expand drop-shadow-md')])],
          ),
        ],
      ),
    ],
  )

const upNextPreviewView = (
  queue: ReadonlyArray<PlayableSong>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Class(
        'bg-white/5 backdrop-blur-md rounded-xl p-6 border border-white/10',
      ),
    ],
    [
      h.h3(
        [
          h.Class(
            'text-gray-400 mb-4 uppercase text-xs tracking-wider font-bold',
          ),
        ],
        ['Up Next'],
      ),
      Array.match(queue, {
        onEmpty: () =>
          h.p([h.Class('text-gray-500 italic')], ['Queue is empty']),
        onNonEmpty: songs =>
          h.div(
            [h.Class('space-y-3')],
            Array.take(songs, 3).map((song, index) =>
              h.div(
                [h.Class('flex items-center space-x-3 text-sm')],
                [
                  h.span([h.Class('text-gray-500')], [`${index + 1}`]),
                  h.span([h.Class('text-white truncate')], [song.song_title]),
                ],
              ),
            ),
          ),
      }),
    ],
  )

// NOTE: this stays one element at one place in the tree, because expanding must not reload the video.
const playerView = (
  nowPlaying: NowPlaying,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const { isExpanded } = model
  return h.div(
    [
      h.Class(
        `fixed transition-all duration-500 shadow-2xl overflow-hidden z-50 bg-black/95 backdrop-blur-xl flex flex-col ${isExpanded ? 'inset-0' : 'w-1 h-1 opacity-0 pointer-events-none bottom-0 right-0'}`,
      ),
    ],
    [
      h.div(
        [
          h.Class(
            `relative w-full ${isExpanded ? 'h-full flex flex-col' : 'h-1'}`,
          ),
        ],
        [
          h.div(
            [
              h.Class(
                `${isExpanded ? 'flex' : 'hidden'} justify-between p-4 absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/80 to-transparent`,
              ),
            ],
            [
              h.button(
                [
                  h.OnClick(Message.ClickedCollapse()),
                  h.Class('text-white hover:text-[#446e92] p-2'),
                ],
                [h.i([h.Class('fas fa-chevron-down fa-2x')])],
              ),
            ],
          ),
          h.div(
            [
              h.Class(
                `flex items-center justify-center bg-transparent ${isExpanded ? 'flex-1' : ''}`,
              ),
            ],
            [
              h.div(
                [
                  h.Class(
                    isExpanded
                      ? 'w-full max-w-6xl aspect-video shadow-2xl'
                      : 'w-full h-full',
                  ),
                ],
                [
                  h.keyed('div')(`play-${nowPlaying.playId}`, [
                    h.Class('w-full h-full'),
                    h.OnMount(
                      MountPlayer({
                        playId: nowPlaying.playId,
                        videoId: nowPlaying.song.video_url,
                        startSeconds: timestampToSeconds(
                          nowPlaying.song.timestamp,
                        ),
                      }),
                    ),
                  ]),
                ],
              ),
            ],
          ),
          h.div(
            [
              h.Class(
                `${isExpanded ? 'block' : 'hidden'} p-8 pb-32 w-full max-w-4xl mx-auto`,
              ),
            ],
            [
              h.h1(
                [
                  h.Class(
                    'text-2xl md:text-3xl font-bold text-center mb-2 drop-shadow-lg',
                  ),
                ],
                [nowPlaying.song.song_title],
              ),
              h.p(
                [h.Class('text-center text-gray-400 mb-8')],
                [nowPlaying.song.title_text],
              ),
              upNextPreviewView(model.setlist.queue, h),
            ],
          ),
        ],
      ),
    ],
  )
}

const skipToastMessage = ({
  firstSkippedTitle,
  skippedCount,
}: SkipToast): string =>
  skippedCount === 1
    ? `"${firstSkippedTitle}" isn't available on YouTube, so it was skipped.`
    : `"${firstSkippedTitle}" and ${skippedCount - 1} more aren't available on YouTube, so they were skipped.`

const skipToastView = (toast: SkipToast, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Role('status'),
      h.AriaLive('polite'),
      h.Class(
        'fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] w-[calc(100vw-2rem)] max-w-md flex items-start gap-3 bg-black/80 backdrop-blur-xl border border-white/10 text-white rounded-xl shadow-2xl p-3',
      ),
    ],
    [
      h.i([
        h.Class('fas fa-exclamation-triangle text-amber-400 mt-0.5'),
        h.AriaHidden(true),
      ]),
      h.p([h.Class('flex-1 min-w-0 text-sm break-words')], [
        skipToastMessage(toast),
      ]),
      h.button(
        [
          h.Type('button'),
          h.AriaLabel('Dismiss'),
          h.OnClick(Message.ClickedDismissToast()),
          h.Class(
            'shrink-0 text-gray-400 hover:text-white transition-colors',
          ),
        ],
        [h.i([h.Class('fas fa-times')])],
      ),
    ],
  )

export const view = Submodel.defineView<Model, Message>((model, h): Html =>
  h.div(
    [
      h.Class(
        'flex flex-col h-screen text-white overflow-hidden font-sans relative',
      ),
    ],
    [
      headerView(model, h),
      h.div(
        [h.Class('flex flex-1 min-h-0 relative')],
        [
          h.div(
            [h.Class('flex-1 overflow-y-auto custom-scrollbar p-2')],
            [
              AsyncData.matchData(model.songs, {
                onEmpty: () => spinnerView(h),
                onFailure: error => failureView(error, h),
                onData: () => songListView(model, h),
              }),
            ],
          ),
          queuePanelView(model, h),
        ],
      ),
      Option.match(model.setlist.maybeNowPlaying, {
        onNone: () => h.empty,
        onSome: nowPlaying => playerBarView(nowPlaying, model, h),
      }),
      Option.match(model.setlist.maybeNowPlaying, {
        onNone: () => h.empty,
        onSome: nowPlaying => playerView(nowPlaying, model, h),
      }),
      Option.match(model.maybeSkipToast, {
        onNone: () => h.empty,
        onSome: toast => skipToastView(toast, h),
      }),
    ],
  ),
)
