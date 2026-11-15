import { Array, Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import { type Html, type HtmlBuilder, createKeyedLazy } from 'foldkit/html'
import { twMerge } from 'tailwind-merge'

import {
  type PlayableSong,
  type VideoKind,
  formatPublishDate,
  songLabel,
} from '../../domain.ts'
import { hireRouter, songsRouter } from '../../route'
import { type LoadFailure, thumbnailUrl } from '../../youtube'
import type { LoginFailure } from './account.ts'
import { infoButtonView, infoPanelView } from './info.ts'
import {
  CANCEL_CHOICE,
  Message,
  type Model,
  MountPlayer,
  PLAYLIST_PROMPT_ID,
  REPLACE_CHOICE,
  SETLIST_PANE_ID,
  SONG_LIST_ID,
  Toast,
  allSongs,
  nowSingingOf,
  queueHandleId,
  songOnBar,
} from './karaoke'
import {
  barLineOf,
  lyricsColumnView,
  lyricsWindowView,
} from './lyricsView.ts'
import { MOODS, type Mood, MoodPrompt } from './moodPrompt.ts'
import { PlaylistOpen } from './playlistOpen.ts'
import {
  myPlaylistsButtonView,
  openPlaylistBarView,
  playlistDialogView,
  savePlaylistButtonView,
} from './playlistsView.ts'
import {
  type NowPlaying,
  Phase,
  type PlaybackIntent,
  type Repeat,
  type Setlist,
  type Volume,
  intentOf,
  isSilent,
  loadRetryDelaySeconds,
} from './setlist.ts'
import {
  type VideoGroup,
  groupByVideo,
  resolveSelection,
  searchVideos,
} from './videoList.ts'

const lazySongRow = createKeyedLazy()

const KIND_LABELS: Record<VideoKind, string> = {
  karaoke: 'Karaoke',
  cover: 'Cover',
  original: 'Original',
}

const kindLabel = (kind: VideoKind): string => KIND_LABELS[kind]

const songCountText = (count: number): string =>
  `${count} ${count === 1 ? 'song' : 'songs'}`

type Playback = {
  maybeNowPlaying: Option.Option<NowPlaying>
  maybeShownSongId: Option.Option<string>
  isPlaying: boolean
}

const playbackOf = (model: Model): Playback => ({
  maybeNowPlaying: model.setlist.maybeNowPlaying,
  maybeShownSongId: Option.map(
    model.setlist.maybeNowPlaying,
    nowPlaying => songOnBar(model, nowPlaying).id,
  ),
  isPlaying: Option.exists(model.setlist.maybeNowPlaying, ({ phase }) =>
    Option.contains(intentOf(phase), 'Playing'),
  ),
})

const holdsCurrent = (group: VideoGroup, playback: Playback): boolean =>
  Option.exists(
    playback.maybeNowPlaying,
    nowPlaying => nowPlaying.song.video_url === group.videoId,
  )

const emptyStateView = (search: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class(
        'text-center text-gray-200 mt-10 p-4 bg-black/40 rounded-lg backdrop-blur-sm mx-auto max-w-md',
      ),
    ],
    [h.p([h.Class('font-semibold')], [`No songs found for "${search}"`])],
  )

const goneBadgeView = (h: HtmlBuilder<Message>): Html =>
  h.span(
    [
      h.Class(
        'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest whitespace-nowrap bg-[#57182c] text-[#f0a3b4]',
      ),
    ],
    ['Stream gone'],
  )

const equalizerView = (isPlaying: boolean, h: HtmlBuilder<Message>): Html =>
  h.i([
    h.Class(
      twMerge(
        'text-sky-300 text-xs',
        isPlaying ? 'fas fa-chart-bar animate-pulse' : 'fas fa-pause',
      ),
    ),
    h.AriaHidden(true),
  ])

/** Marks the literal query inside a title; a fuzzy match has no literal span, so it shows plain. */
const highlightedView = (
  text: string,
  query: string,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html | string> => {
  const needle = query.trim().toLowerCase()
  const start = needle === '' ? -1 : text.toLowerCase().indexOf(needle)
  if (start < 0) {
    return [text]
  }
  const end = start + needle.length
  return [
    text.slice(0, start),
    h.mark(
      [h.Class('bg-sky-400/25 text-sky-100 rounded px-0.5 -mx-0.5')],
      [text.slice(start, end)],
    ),
    text.slice(end),
  ]
}

const addToQueueButtonView = (
  song: PlayableSong,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.AriaLabel('Add to Queue'),
      h.OnClick(Message.ClickedAddToQueue({ song }), { propagation: 'Stop' }),
      h.Class(
        'flex-shrink-0 flex items-center justify-center gap-2 min-h-10 min-w-10 px-2 sm:px-3 rounded-full transition-all active:scale-95 bg-black/30 border border-white/20 text-white font-bold hover:bg-[#446e92]/30 hover:border-[#446e92]/60',
      ),
    ],
    [
      h.i([h.Class('fas fa-list-ul text-xs'), h.AriaHidden(true)]),
      h.span(
        [
          h.Class(
            'hidden [@container(min-width:32rem)]:inline text-[10px] uppercase tracking-widest whitespace-nowrap',
          ),
          h.AriaHidden(true),
        ],
        ['Add to Queue'],
      ),
    ],
  )

const songRowView = (
  song: PlayableSong,
  isCurrent: boolean,
  isPlaying: boolean,
  isGone: boolean,
  search: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed('li')(
    song.id,
    isGone
      ? [
          h.Class(
            'flex items-center gap-3 min-h-12 px-3 py-1.5 rounded-xl bg-black/30 text-gray-300 cursor-not-allowed',
          ),
          h.AriaDisabled(true),
        ]
      : [
          h.Class(
            twMerge(
              'group flex items-center gap-3 min-h-12 px-3 py-1.5 rounded-xl transition-colors cursor-pointer border [container-type:inline-size]',
              isCurrent
                ? 'bg-[#446e92]/45 border-sky-300/40'
                : 'border-transparent hover:bg-white/10',
            ),
          ),
          h.OnClick(Message.ClickedSong({ song })),
        ],
    [
      h.span(
        [
          h.Class(
            twMerge(
              'flex-shrink-0 w-16 text-xs tabular-nums',
              isCurrent ? 'text-white/90' : 'text-gray-300',
            ),
          ),
        ],
        [song.timestamp],
      ),
      h.span(
        [
          h.Class(
            twMerge(
              'flex-1 min-w-0 truncate text-sm font-medium transition-colors',
              isCurrent ? 'text-white' : 'text-white group-hover:text-sky-100',
            ),
          ),
        ],
        highlightedView(songLabel(song), search, h),
      ),
      isCurrent ? equalizerView(isPlaying, h) : h.empty,
      isGone ? h.empty : addToQueueButtonView(song, h),
    ],
  )

const videoListThumbnailView = (
  group: VideoGroup,
  hasCurrent: boolean,
  isPlaying: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Class(
        'relative w-28 lg:w-32 aspect-video rounded-lg overflow-hidden bg-slate-800 flex-shrink-0 flex items-center justify-center shadow-md',
      ),
    ],
    [
      group.isGone
        ? h.i([h.Class('fas fa-ban text-gray-300'), h.AriaHidden(true)])
        : h.img([
            h.Src(thumbnailUrl(group.videoId, 'mqdefault')),
            h.Alt(''),
            h.Loading('lazy'),
            h.Class('w-full h-full object-cover'),
          ]),
      hasCurrent
        ? h.span(
            [
              h.Role('img'),
              h.AriaLabel('Now playing'),
              h.Class(
                'absolute bottom-1 left-1 flex items-center justify-center w-6 h-6 rounded-full bg-black/70',
              ),
            ],
            [equalizerView(isPlaying, h)],
          )
        : h.empty,
    ],
  )

const kindPillView = (kind: VideoKind, h: HtmlBuilder<Message>): Html =>
  h.span(
    [
      h.Class(
        'px-2 py-0.5 rounded-full bg-fuchsia-500/30 text-white font-semibold whitespace-nowrap',
      ),
    ],
    [kindLabel(kind)],
  )

const videoListItemView = (
  group: VideoGroup,
  totalSongs: number,
  isSelected: boolean,
  isSearching: boolean,
  playback: Playback,
  h: HtmlBuilder<Message>,
): Html => {
  const hasCurrent = holdsCurrent(group, playback)
  const maybePlayOnTap =
    totalSongs === 1 && !group.isGone
      ? Array.head(group.songs)
      : Option.none<PlayableSong>()
  const rowClass = twMerge(
    'rounded-xl border transition-colors',
    isSelected
      ? 'bg-black/60 border-transparent md:bg-[#2f5675] md:border-sky-300/50 md:shadow-lg'
      : 'bg-black/60 border-transparent hover:bg-black/75',
    hasCurrent && 'border-sky-500/40',
  )
  const rowChildren = [
    videoListThumbnailView(group, hasCurrent, playback.isPlaying, h),
    h.div(
      [h.Class('flex-1 min-w-0')],
      [
        h.p(
          [
            h.Class(
              twMerge(
                'text-sm font-semibold leading-snug line-clamp-2 break-words',
                hasCurrent ? 'text-sky-200' : 'text-white',
                isSelected && hasCurrent && 'md:text-white',
                group.isGone && 'text-gray-200',
              ),
            ),
          ],
          [group.title],
        ),
        h.p(
          [h.Class('mt-1 flex flex-wrap items-center gap-1.5 text-xs')],
          [
            isSearching
              ? h.span(
                  [
                    h.Class(
                      'px-2 py-0.5 rounded-full bg-sky-500/25 text-white font-semibold whitespace-nowrap',
                    ),
                  ],
                  [
                    `${group.songs.length} ${group.songs.length === 1 ? 'match' : 'matches'}`,
                  ],
                )
              : h.empty,
            group.kind === 'karaoke'
              ? h.span(
                  [h.Class('text-gray-200 whitespace-nowrap')],
                  [songCountText(totalSongs)],
                )
              : kindPillView(group.kind, h),
            h.span([h.Class('text-gray-200'), h.AriaHidden(true)], ['·']),
            h.span(
              [h.Class('text-gray-200 whitespace-nowrap')],
              [formatPublishDate(group.publishedAt)],
            ),
            group.isGone ? goneBadgeView(h) : h.empty,
          ],
        ),
      ],
    ),
  ]
  return h.keyed('li')(
    group.videoId,
    Option.isSome(maybePlayOnTap)
      ? [
          h.Class(
            twMerge(
              'flex items-center gap-1 pr-2 [container-type:inline-size]',
              rowClass,
            ),
          ),
        ]
      : [],
    Option.match(maybePlayOnTap, {
      onNone: () => [
        h.button(
          [
            h.Type('button'),
            h.AriaCurrent(isSelected ? 'true' : 'false'),
            h.OnClick(Message.ClickedVideo({ videoId: group.videoId })),
            h.Class(
              twMerge('flex items-center gap-3 w-full p-2 text-left', rowClass),
            ),
          ],
          [
            ...rowChildren,
            h.i([
              h.Class('fas fa-chevron-right md:hidden text-gray-300 text-xs'),
              h.AriaHidden(true),
            ]),
          ],
        ),
      ],
      onSome: song => [
        h.button(
          [
            h.Type('button'),
            h.AriaCurrent(isSelected ? 'true' : 'false'),
            h.OnClick(Message.ClickedSong({ song })),
            h.Class('flex flex-1 min-w-0 items-center gap-3 p-2 text-left'),
          ],
          rowChildren,
        ),
        addToQueueButtonView(song, h),
      ],
    }),
  )
}

const videoListPaneView = (
  shown: ReadonlyArray<VideoGroup>,
  totals: ReadonlyMap<string, number>,
  maybeSelected: Option.Option<VideoGroup>,
  isHiddenOnPhone: boolean,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const isSearching = model.search.trim() !== ''
  const playback = playbackOf(model)
  const caption = isSearching
    ? `${shown.length} ${shown.length === 1 ? 'video has' : 'videos have'} this song`
    : `${shown.length} videos`
  return h.nav(
    [
      h.AriaLabel('Videos'),
      h.Class(
        twMerge(
          'w-full md:w-80 lg:w-96 shrink-0 overflow-y-auto custom-scrollbar px-2 pr-12 md:pr-2 pb-24',
          isHiddenOnPhone ? 'hidden md:block' : 'block',
        ),
      ),
    ],
    [
      h.p(
        [
          h.Id(SONG_LIST_ID),
          h.Class(
            'inline-block mb-2 px-3 py-1 rounded-full bg-black/60 text-[11px] uppercase tracking-widest font-bold text-white',
          ),
        ],
        [caption],
      ),
      h.ul(
        [h.Class('space-y-1.5')],
        shown.map(group =>
          videoListItemView(
            group,
            totals.get(group.videoId) ?? 0,
            Option.exists(
              maybeSelected,
              selected => selected.videoId === group.videoId,
            ),
            isSearching,
            playback,
            h,
          ),
        ),
      ),
    ],
  )
}

const heroThumbnailView = (group: VideoGroup, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class(
        'w-full [@container(min-width:26rem)]:w-36 [@container(min-width:44rem)]:w-60 self-start aspect-video rounded-xl overflow-hidden bg-slate-800 flex-shrink-0 flex flex-col items-center justify-center gap-2 shadow-2xl ring-1 ring-white/10',
      ),
    ],
    group.isGone
      ? [
          h.i([
            h.Class('fas fa-ban text-3xl text-gray-300'),
            h.AriaHidden(true),
          ]),
          goneBadgeView(h),
        ]
      : [
          h.img([
            h.Src(thumbnailUrl(group.videoId, 'hqdefault')),
            h.Alt(''),
            h.Class('w-full h-full object-cover'),
          ]),
        ],
  )

const setlistHeaderView = (
  group: VideoGroup,
  totalSongs: number,
  isSearching: boolean,
  playback: Playback,
  h: HtmlBuilder<Message>,
): Html => {
  const hasCurrent = holdsCurrent(group, playback)
  const countText = isSearching
    ? `${group.songs.length} of ${totalSongs} songs match`
    : songCountText(totalSongs)
  const dateText = `${group.kind === 'karaoke' ? 'Streamed' : 'Released'} ${formatPublishDate(group.publishedAt)}`
  return h.header(
    [
      h.Class(
        'relative overflow-hidden rounded-2xl border border-white/15 bg-black/75 [container-type:inline-size]',
      ),
    ],
    [
      group.isGone
        ? h.empty
        : h.img([
            h.Src(thumbnailUrl(group.videoId, 'hqdefault')),
            h.Alt(''),
            h.AriaHidden(true),
            h.Class(
              'absolute inset-0 w-full h-full object-cover scale-125 blur-2xl opacity-40',
            ),
          ]),
      h.div([
        h.Class(
          'absolute inset-0 bg-gradient-to-t from-black/95 via-black/80 to-black/65',
        ),
      ]),
      h.div(
        [
          h.Class(
            'relative flex flex-col [@container(min-width:26rem)]:flex-row gap-4 p-3 [@container(min-width:26rem)]:p-5',
          ),
        ],
        [
          heroThumbnailView(group, h),
          h.div(
            [h.Class('flex-1 min-w-0 flex flex-col justify-end gap-2')],
            [
              hasCurrent
                ? h.p(
                    [
                      h.Class(
                        'flex items-center gap-2 text-[11px] uppercase tracking-widest font-bold text-sky-200',
                      ),
                    ],
                    [equalizerView(playback.isPlaying, h), 'Now playing'],
                  )
                : h.p(
                    [
                      h.Class(
                        'text-[11px] uppercase tracking-widest font-bold text-gray-200',
                      ),
                    ],
                    [kindLabel(group.kind)],
                  ),
              h.h2(
                [
                  h.Class(
                    twMerge(
                      'text-lg [@container(min-width:26rem)]:text-xl [@container(min-width:44rem)]:text-2xl font-bold leading-tight break-words drop-shadow-lg',
                      group.isGone && 'text-gray-200',
                    ),
                  ),
                ],
                [group.title],
              ),
              h.p(
                [h.Class('text-sm text-gray-100')],
                [
                  group.isGone
                    ? `${countText} · ${dateText}. This stream is gone, so its songs cannot be played.`
                    : `${countText} · ${dateText}`,
                ],
              ),
              group.isGone
                ? h.empty
                : Array.match(group.songs, {
                    onEmpty: () => h.empty,
                    onNonEmpty: ([first]) =>
                      h.button(
                        [
                          h.Type('button'),
                          h.OnClick(Message.ClickedSong({ song: first })),
                          h.Class(
                            'self-start mt-1 flex items-center gap-2 min-h-10 px-5 whitespace-nowrap rounded-full bg-white text-black text-sm font-bold shadow-lg hover:scale-105 active:scale-95 transition',
                          ),
                        ],
                        [
                          h.i([
                            h.Class('fas fa-play text-xs'),
                            h.AriaHidden(true),
                          ]),
                          isSearching
                            ? 'Play first match'
                            : 'Play from the top',
                        ],
                      ),
                  }),
            ],
          ),
        ],
      ),
    ],
  )
}

const backBarView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('md:hidden sticky top-0 z-10 -mx-2 px-2 pb-2 bg-transparent')],
    [
      h.button(
        [
          h.Type('button'),
          h.OnClick(Message.ClickedBackToVideos()),
          h.Class(
            'flex items-center gap-2 min-h-10 px-4 rounded-full bg-black/70 backdrop-blur-md border border-white/15 text-sm font-semibold text-white shadow-lg active:scale-95 transition',
          ),
        ],
        [
          h.i([h.Class('fas fa-arrow-left text-xs'), h.AriaHidden(true)]),
          'All videos',
        ],
      ),
    ],
  )

const setlistPaneView = (
  group: VideoGroup,
  totalSongs: number,
  isHiddenOnPhone: boolean,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const isSearching = model.search.trim() !== ''
  const playback = playbackOf(model)
  return h.section(
    [
      h.AriaLabel(`Setlist of ${group.title}`),
      h.Class(
        twMerge(
          'flex-1 min-w-0 overflow-y-auto custom-scrollbar px-2 md:pl-0 pr-12 pb-24',
          isHiddenOnPhone ? 'hidden md:block' : 'block',
        ),
      ),
    ],
    [
      h.div(
        [h.Id(SETLIST_PANE_ID)],
        [
          backBarView(h),
          setlistHeaderView(group, totalSongs, isSearching, playback, h),
          h.ol(
            [
              h.Class(
                'mt-3 space-y-1 rounded-2xl bg-black/60 backdrop-blur-sm p-1.5',
              ),
            ],
            group.songs.map(song => {
              const isCurrent = Option.contains(
                playback.maybeShownSongId,
                song.id,
              )
              return lazySongRow(song.id, songRowView, [
                song,
                isCurrent,
                isCurrent && playback.isPlaying,
                group.isGone,
                model.search,
                h,
              ])
            }),
          ),
        ],
      ),
    ],
  )
}

const songListView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const groups = groupByVideo(allSongs(model), model.goneVideoIds)
  const totals = new Map(
    groups.map(group => [group.videoId, group.songs.length]),
  )
  const shown = searchVideos(groups, model.search)
  const selection = resolveSelection(
    shown,
    model.maybeSelectedVideoId,
    Option.map(model.setlist.maybeNowPlaying, ({ song }) => song.video_url),
  )
  return Option.match(selection.maybeVideo, {
    onNone: () =>
      h.div(
        [h.Id(SONG_LIST_ID), h.Class('h-full overflow-y-auto p-2 pr-12')],
        [emptyStateView(model.search, h)],
      ),
    onSome: selected =>
      h.div(
        [h.Class('flex h-full min-h-0 md:gap-4 md:pl-2')],
        [
          videoListPaneView(
            shown,
            totals,
            selection.maybeVideo,
            selection.isChosen,
            model,
            h,
          ),
          setlistPaneView(
            selected,
            totals.get(selected.videoId) ?? 0,
            !selection.isChosen,
            model,
            h,
          ),
        ],
      ),
  })
}

const failureView = (error: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class(
        'text-center text-gray-200 mt-10 p-4 bg-black/40 rounded-lg backdrop-blur-sm mx-auto max-w-md',
      ),
    ],
    [
      h.p([h.Class('font-semibold')], ['Could not load Fio Radio']),
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
      h.div(
        [
          h.Class(
            'flex items-center gap-3 rounded-full bg-black/60 px-5 py-3 text-sm font-semibold text-white backdrop-blur-md',
          ),
        ],
        [
          h.div([
            h.Class(
              'h-5 w-5 animate-spin rounded-full border-b-2 border-white',
            ),
          ]),
          'Loading songs',
        ],
      ),
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
            [h.Class('flex min-w-0 items-center space-x-3')],
            [
              infoButtonView(model.isInfoOpen, h),
              h.h1(
                [
                  h.Class(
                    'text-lg sm:text-xl font-bold tracking-tight text-[#446e92] uppercase drop-shadow-md whitespace-nowrap',
                  ),
                ],
                ['Fio Radio'],
              ),
            ],
          ),
          h.div(
            [h.Class('flex shrink-0 items-center gap-1.5 sm:gap-2')],
            [
              myPlaylistsButtonView(h),
              savePlaylistButtonView(h),
              h.a(
                [
                  h.Href(hireRouter()),
                  h.Class(
                    'flex shrink-0 items-center gap-2 min-h-10 px-3 sm:px-4 whitespace-nowrap rounded-full border border-white/15 bg-black/40 text-sm font-semibold text-gray-100 hover:bg-black/70 hover:border-white/30 drop-shadow-md transition',
                  ),
                ],
                [
                  h.span(
                    [h.Class('hidden sm:inline')],
                    [h.i([h.Class('fas fa-microphone'), h.AriaHidden(true)])],
                  ),
                  'Hire Fio',
                ],
              ),
              h.a(
                [
                  h.Href(songsRouter()),
                  h.Class(
                    'flex shrink-0 items-center gap-2 min-h-10 px-3 sm:px-4 whitespace-nowrap rounded-full border border-white/15 bg-black/40 text-sm font-semibold text-gray-100 hover:bg-black/70 hover:border-white/30 drop-shadow-md transition',
                  ),
                ],
                [
                  h.span(
                    [h.Class('hidden sm:inline')],
                    [h.i([h.Class('fas fa-music'), h.AriaHidden(true)])],
                  ),
                  'Song list',
                ],
              ),
            ],
          ),
        ],
      ),
      PlaylistOpen.matchOrElse(
        model.playlistOpen,
        { Opened: ({ opened }) => openPlaylistBarView(model, opened, h) },
        () => h.empty,
      ),
      h.div(
        [h.Class('mb-2 relative')],
        [
          h.div(
            [
              h.Class(
                'absolute z-10 left-4 top-1/2 transform -translate-y-1/2 text-gray-300',
              ),
            ],
            [h.i([h.Class('fas fa-search')])],
          ),
          h.input([
            h.Type('text'),
            h.Placeholder('Search songs...'),
            h.Class(
              'w-full bg-black/60 backdrop-blur-md text-white placeholder:text-gray-300 rounded-full py-2 pl-12 pr-4 text-sm border border-white/10 focus:border-[#446e92] focus:outline-none transition-all shadow-lg',
            ),
            h.Value(model.search),
            h.OnInput(value => Message.UpdatedSearch({ value })),
          ]),
        ],
      ),
    ],
  )

const queueRowDragClass = (
  maybeDrag: Model['maybeQueueDrag'],
  index: number,
): string =>
  Option.match(maybeDrag, {
    onNone: () => '',
    onSome: ({ from, over }) =>
      twMerge(
        index === from && 'opacity-40',
        index === over &&
          from !== over &&
          (over > from
            ? 'shadow-[inset_0_-2px_0_0_#38bdf8]'
            : 'shadow-[inset_0_2px_0_0_#38bdf8]'),
      ),
  })

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
        [
          h.Class(
            'flex items-center justify-between p-4 border-b border-white/10 bg-white/5',
          ),
        ],
        [
          h.h2([h.Class('text-lg font-bold drop-shadow-md')], ['Up Next']),
          h.div(
            [h.Class('flex items-center gap-2')],
            [
              autoplaySwitchView(model.isAutoplay, '', h),
              h.button(
                [
                  h.Type('button'),
                  h.AriaLabel('Close queue'),
                  h.OnClick(Message.ClickedQueueHandle()),
                  h.Class(
                    'flex items-center justify-center min-h-10 min-w-10 rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-95 transition',
                  ),
                ],
                [h.i([h.Class('fas fa-times'), h.AriaHidden(true)])],
              ),
            ],
          ),
        ],
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
                      twMerge(
                        'flex items-center space-x-3 group p-2 rounded hover:bg-white/10 transition-colors select-none',
                        queueRowDragClass(model.maybeQueueDrag, index),
                      ),
                    ),
                    h.DataAttribute('queue-index', `${index}`),
                  ],
                  [
                    h.button(
                      [
                        h.Type('button'),
                        h.Id(queueHandleId(index)),
                        h.AriaLabel(`Move "${song.song_title}"`),
                        h.Title('Drag, or press the up and down arrow keys'),
                        h.OnPointerDown((pointerType, button) =>
                          pointerType !== 'mouse' || button === 0
                            ? Option.some(Message.StartedQueueDrag({ index }))
                            : Option.none(),
                        ),
                        h.OnKeyDownPreventDefault(key =>
                          key === 'ArrowUp'
                            ? Option.some(
                                Message.PressedQueueMoveKey({ index, by: -1 }),
                              )
                            : key === 'ArrowDown'
                              ? Option.some(
                                  Message.PressedQueueMoveKey({ index, by: 1 }),
                                )
                              : Option.none(),
                        ),
                        h.Class(
                          'flex items-center justify-center min-h-10 w-6 shrink-0 touch-none text-gray-400 hover:text-white cursor-grab active:cursor-grabbing',
                        ),
                      ],
                      [
                        h.i([
                          h.Class('fas fa-grip-vertical'),
                          h.AriaHidden(true),
                        ]),
                      ],
                    ),
                    h.div(
                      [h.Class('text-gray-300 text-xs w-4')],
                      [`${index + 1}`],
                    ),
                    h.button(
                      [
                        h.Type('button'),
                        h.AriaLabel(`Play "${song.song_title}" now`),
                        h.OnClick(Message.ClickedQueuedSong({ index })),
                        h.Class(
                          'flex flex-1 min-w-0 items-center space-x-3 min-h-10 text-left',
                        ),
                      ],
                      [
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
                                  'text-sm font-medium truncate group-hover:text-sky-300 text-white drop-shadow-sm',
                                ),
                              ],
                              [songLabel(song)],
                            ),
                            h.p(
                              [h.Class('text-xs text-gray-300 truncate')],
                              [kindLabel(song.kind)],
                            ),
                          ],
                        ),
                      ],
                    ),
                    h.button(
                      [
                        h.Type('button'),
                        h.AriaLabel(`Remove "${song.song_title}" from queue`),
                        h.OnClick(Message.ClickedRemoveFromQueue({ index })),
                        h.Class(
                          'flex items-center justify-center min-h-10 min-w-10 shrink-0 rounded-full text-gray-300 hover:text-white hover:bg-white/10 active:scale-95 transition',
                        ),
                      ],
                      [h.i([h.Class('fas fa-times'), h.AriaHidden(true)])],
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
                    h.div(
                      [h.Class('flex items-center justify-between mb-2 px-2')],
                      [
                        h.h3(
                          [
                            h.Class(
                              'text-sm font-semibold text-gray-300 uppercase tracking-wider',
                            ),
                          ],
                          ['History'],
                        ),
                        h.button(
                          [
                            h.Type('button'),
                            h.OnClick(Message.ClickedQueueHistory()),
                            h.Class(
                              'min-h-10 px-3 rounded-full bg-black/30 border border-white/20 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-[#446e92]/30 active:scale-95 transition',
                            ),
                          ],
                          ['Queue all'],
                        ),
                      ],
                    ),
                  ],
                ),
                ...history.map(song =>
                  h.div(
                    [
                      h.Class(
                        'flex items-center gap-2 opacity-80 hover:opacity-100 transition-opacity p-2 rounded hover:bg-white/5',
                      ),
                    ],
                    [
                      h.button(
                        [
                          h.Type('button'),
                          h.AriaLabel(`Play "${song.song_title}" again`),
                          h.OnClick(Message.ClickedSong({ song })),
                          h.Class(
                            'flex flex-1 min-w-0 items-center space-x-3 min-h-10 text-left',
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
                          h.p(
                            [
                              h.Class(
                                'flex-1 min-w-0 text-sm truncate text-gray-200',
                              ),
                            ],
                            [songLabel(song)],
                          ),
                        ],
                      ),
                      addToQueueButtonView(song, h),
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
              `fas ${model.isQueueOpen ? 'fa-chevron-right' : 'fa-chevron-left'} text-white/80 group-hover:text-white transition-colors`,
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

const autoplaySwitchView = (
  isAutoplay: boolean,
  labelClass: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.Role('switch'),
      h.AriaChecked(isAutoplay),
      h.AriaLabel('Autoplay'),
      h.Title(isAutoplay ? 'Autoplay is on' : 'Autoplay is off'),
      h.OnClick(Message.ClickedToggleAutoplay()),
      h.Class(
        'flex items-center gap-2 min-h-10 px-2 text-xs text-gray-300 hover:text-white transition-colors',
      ),
    ],
    [
      h.span(
        [
          h.Class(
            twMerge(
              'relative inline-block w-9 h-3.5 shrink-0 rounded-full transition-colors',
              isAutoplay ? 'bg-sky-400/50' : 'bg-white/30',
            ),
          ),
        ],
        [
          h.span(
            [
              h.Class(
                twMerge(
                  'absolute -top-[3px] left-0 h-5 w-5 rounded-full shadow transition-all flex items-center justify-center',
                  isAutoplay
                    ? 'translate-x-4 bg-white text-black'
                    : 'bg-gray-300 text-gray-700',
                ),
              ),
            ],
            [
              h.i([
                h.Class(
                  twMerge(
                    'fas text-[8px]',
                    isAutoplay ? 'fa-play pl-px' : 'fa-pause',
                  ),
                ),
                h.AriaHidden(true),
              ]),
            ],
          ),
        ],
      ),
      h.span([h.Class(labelClass)], ['Autoplay']),
    ],
  )

const muteButtonView = (volume: Volume, h: HtmlBuilder<Message>): Html => {
  const isSilentNow = isSilent(volume)
  const icon = isSilentNow
    ? 'fa-volume-xmark'
    : volume.level < 50
      ? 'fa-volume-low'
      : 'fa-volume-high'
  return h.button(
    [
      h.Type('button'),
      h.AriaLabel(isSilentNow ? 'Unmute' : 'Mute'),
      h.Title(isSilentNow ? 'Unmute' : 'Mute'),
      h.OnClick(Message.ClickedToggleMute()),
      h.Class(
        'flex items-center justify-center min-h-10 min-w-10 shrink-0 rounded-full text-gray-300 hover:text-white transition active:scale-95',
      ),
    ],
    [h.i([h.Class(`fas ${icon} drop-shadow-md`), h.AriaHidden(true)])],
  )
}

const volumeSliderView = (
  volume: Volume,
  className: string,
  h: HtmlBuilder<Message>,
): Html => {
  const shown = isSilent(volume) ? 0 : volume.level
  return h.input([
    h.Type('range'),
    h.Min('0'),
    h.Max('100'),
    h.Step('1'),
    h.Value(`${shown}`),
    h.AriaLabel('Volume'),
    h.Attribute('aria-valuetext', `${shown} percent`),
    h.OnInput(value => Message.ChangedVolume({ level: Number(value) })),
    h.Class(twMerge('min-h-10 accent-sky-400 cursor-pointer', className)),
  ])
}

const repeatButtonView = (
  repeat: Repeat,
  sizeClass: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.AriaLabel(`Repeat: ${repeat}`),
      h.Title(`Repeat: ${repeat}. Press to change.`),
      h.OnClick(Message.ClickedCycleRepeat()),
      h.Class(
        twMerge(
          'relative flex items-center justify-center min-h-10 min-w-10 shrink-0 rounded-full transition active:scale-95',
          sizeClass,
          repeat === 'Off'
            ? 'text-gray-300 hover:text-white'
            : 'text-sky-300 bg-sky-500/20 hover:text-sky-200',
        ),
      ),
    ],
    [
      h.i([h.Class('fas fa-repeat drop-shadow-md'), h.AriaHidden(true)]),
      repeat === 'One'
        ? h.span(
            [
              h.Class(
                'absolute top-1 right-1 text-[9px] font-bold leading-none',
              ),
              h.AriaHidden(true),
            ],
            ['1'],
          )
        : h.empty,
    ],
  )

const LOAD_FAILURE_TEXT: Record<LoadFailure, string> = {
  PlayerUnavailable: 'YouTube did not load',
  VideoUnplayable: 'This video did not load',
}

/** What the bar says in place of the song's kind while the song cannot sound. */
const troubleOf = ({ phase, attempt }: NowPlaying): Option.Option<string> =>
  Phase.matchOrElse(
    phase,
    {
      MovingOn: () => Option.some('Stream gone. Finding another video'),
      Gone: () => Option.some('This stream is gone'),
      LoadFailed: ({ reason }) =>
        Option.some(
          Option.match(loadRetryDelaySeconds(attempt), {
            onNone: () => `${LOAD_FAILURE_TEXT[reason]} after ${attempt} tries`,
            onSome: delaySeconds =>
              `${LOAD_FAILURE_TEXT[reason]}. Try ${attempt + 1} in ${delaySeconds}s`,
          }),
        ),
    },
    () => Option.none<string>(),
  )

/** The middle button of the bar and of the phone controls. It plays or pauses a
 *  video that can sound, and otherwise shows why it cannot. */
const playControlView = (
  { phase }: NowPlaying,
  shapeClass: string,
  h: HtmlBuilder<Message>,
): Html => {
  const playPauseView = (intent: PlaybackIntent): Html =>
    h.button(
      [
        h.Type('button'),
        h.AriaLabel(intent === 'Playing' ? 'Pause' : 'Play'),
        h.OnClick(Message.ClickedPlayPause()),
        h.Class(shapeClass),
      ],
      [
        h.i([
          h.Class(intent === 'Playing' ? 'fas fa-pause' : 'fas fa-play pl-1'),
          h.AriaHidden(true),
        ]),
      ],
    )
  return Phase.match(phase, {
    Loading: ({ intent }) => playPauseView(intent),
    Playing: () => playPauseView('Playing'),
    Paused: () => playPauseView('Paused'),
    MovingOn: () =>
      h.div(
        [
          h.Role('status'),
          h.AriaLabel('Finding another video'),
          h.Class(twMerge(shapeClass, 'bg-white/20 text-white')),
        ],
        [h.i([h.Class('fas fa-spinner fa-spin'), h.AriaHidden(true)])],
      ),
    Gone: () =>
      h.button(
        [
          h.Type('button'),
          h.Disabled(true),
          h.AriaLabel('Play'),
          h.Class(twMerge(shapeClass, 'opacity-40 cursor-not-allowed')),
        ],
        [h.i([h.Class('fas fa-play pl-1'), h.AriaHidden(true)])],
      ),
    LoadFailed: () =>
      h.button(
        [
          h.Type('button'),
          h.AriaLabel('Retry'),
          h.Title('Retry'),
          h.OnClick(Message.ClickedRetryLoad()),
          h.Class(shapeClass),
        ],
        [h.i([h.Class('fas fa-redo'), h.AriaHidden(true)])],
      ),
  })
}

const playerBarView = (
  nowPlaying: NowPlaying,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  // NOTE: only a loaded video has something to expand, but an open player must always close, whatever became of its video.
  const canToggleExpanded =
    model.isExpanded || Phase.isAnyOf(['Playing', 'Paused'])(nowPlaying.phase)
  const shownSong = songOnBar(model, nowPlaying)
  const maybeLine = Option.flatMap(nowSingingOf(model), barLineOf)
  const maybeTrouble = troubleOf(nowPlaying)
  const subline = Option.getOrElse(maybeTrouble, () =>
    kindLabel(shownSong.kind),
  )
  return h.div(
    [
      h.DataAttribute('player-bar', ''),
      h.Class(
        twMerge(
          'fixed bottom-0 left-0 right-0 bg-black/80 backdrop-blur-xl border-t border-white/10 text-white z-[55] h-20 items-center px-1.5 sm:px-4 shadow-2xl transition-all duration-300',
          model.isExpanded ? 'hidden sm:flex' : 'flex',
        ),
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
        [
          h.Class(
            'relative flex items-center space-x-2 sm:space-x-4 flex-1 min-w-0 sm:flex-none sm:w-1/3',
          ),
        ],
        [
          h.div(
            [
              h.Class(
                twMerge(
                  'relative group',
                  canToggleExpanded ? 'cursor-pointer' : 'cursor-default',
                ),
              ),
              ...(canToggleExpanded
                ? [h.OnClick(Message.ClickedToggleExpanded())]
                : []),
            ],
            [
              h.div(
                [
                  h.Class(
                    `transition-all duration-300 ${model.isExpanded ? 'w-0 h-0 opacity-0' : 'w-10 h-10 sm:w-14 sm:h-14 bg-gray-800 rounded overflow-hidden shadow-lg border border-white/10'}`,
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
            [h.Class('min-w-0 flex-1')],
            [
              h.h3(
                [h.Class('font-bold text-sm truncate drop-shadow-sm')],
                [songLabel(shownSong)],
              ),
              h.p(
                [
                  h.Class('hidden sm:block text-xs text-gray-300 truncate'),
                  h.Title(subline),
                ],
                [subline],
              ),
              h.p(
                [h.Class('sm:hidden text-xs text-gray-300 truncate')],
                [
                  Option.isSome(maybeTrouble)
                    ? subline
                    : Option.getOrElse(maybeLine, () => subline),
                ],
              ),
            ],
          ),
          h.button([
            h.Type('button'),
            h.Disabled(!canToggleExpanded),
            h.AriaLabel(model.isExpanded ? 'Collapse player' : 'Expand player'),
            h.OnClick(Message.ClickedToggleExpanded()),
            h.Class('absolute inset-0 !ml-0 sm:hidden'),
          ]),
        ],
      ),
      h.div(
        [h.Class('flex flex-col items-center justify-center sm:w-1/3')],
        [
          h.div(
            [h.Class('flex items-center sm:space-x-6')],
            [
              h.button(
                [
                  h.OnClick(Message.ClickedPrevious()),
                  h.Class(
                    'hidden sm:flex items-center justify-center min-h-10 min-w-10 text-gray-300 hover:text-white transition hover:scale-110 active:scale-95',
                  ),
                ],
                [h.i([h.Class('fas fa-step-backward fa-lg drop-shadow-md')])],
              ),
              playControlView(
                nowPlaying,
                'w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-110 active:scale-95 transition shadow-lg hover:shadow-sky-500/20',
                h,
              ),
              h.button(
                [
                  h.OnClick(Message.ClickedNext()),
                  h.Class(
                    'flex items-center justify-center min-h-10 min-w-10 text-gray-300 hover:text-white transition hover:scale-110 active:scale-95',
                  ),
                ],
                [h.i([h.Class('fas fa-step-forward fa-lg drop-shadow-md')])],
              ),
            ],
          ),
          model.isExpanded
            ? h.empty
            : Option.match(maybeLine, {
                onNone: () => h.empty,
                onSome: line =>
                  h.p(
                    [
                      h.DataAttribute('bar-lyric', ''),
                      h.Class(
                        'hidden sm:block max-w-full truncate text-xs text-sky-200',
                      ),
                    ],
                    [line],
                  ),
              }),
        ],
      ),
      h.div(
        [
          h.Class(
            'hidden sm:flex sm:flex-row sm:items-center sm:justify-end sm:space-x-2 sm:w-1/3',
          ),
        ],
        [
          h.div(
            [h.Class('flex items-center sm:contents')],
            [
              repeatButtonView(model.repeat, '', h),
              muteButtonView(model.volume, h),
              volumeSliderView(model.volume, 'hidden sm:block w-24', h),
            ],
          ),
          autoplaySwitchView(model.isAutoplay, 'hidden md:inline', h),
          h.button(
            [
              h.Type('button'),
              h.Disabled(!canToggleExpanded),
              h.AriaLabel(
                model.isExpanded ? 'Collapse player' : 'Expand player',
              ),
              h.Title(
                canToggleExpanded
                  ? model.isExpanded
                    ? 'Collapse player'
                    : 'Expand player'
                  : nowPlaying.phase._tag === 'Loading'
                    ? 'Player is loading'
                    : 'This video cannot play',
              ),
              h.OnClick(Message.ClickedToggleExpanded()),
              h.Class(
                'hidden sm:block text-gray-300 hover:text-white transition hover:rotate-90 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-300 disabled:hover:rotate-0',
              ),
            ],
            [
              h.i([
                h.Class(
                  `fas ${model.isExpanded ? 'fa-compress' : 'fa-expand'} drop-shadow-md`,
                ),
              ]),
            ],
          ),
        ],
      ),
    ],
  )
}

const upNextPreviewView = (
  queue: ReadonlyArray<PlayableSong>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Class(
        'hidden sm:block bg-white/5 backdrop-blur-md rounded-xl p-6 border border-white/10',
      ),
    ],
    [
      h.h3(
        [
          h.Class(
            'text-gray-300 mb-4 uppercase text-xs tracking-wider font-bold',
          ),
        ],
        ['Up Next'],
      ),
      Array.match(queue, {
        onEmpty: () =>
          h.p([h.Class('text-gray-300 italic')], ['Queue is empty']),
        onNonEmpty: songs =>
          h.div(
            [h.Class('space-y-3')],
            Array.take(songs, 3).map((song, index) =>
              h.div(
                [h.Class('flex items-center space-x-3 text-sm')],
                [
                  h.span([h.Class('text-gray-300')], [`${index + 1}`]),
                  h.span([h.Class('text-white truncate')], [songLabel(song)]),
                ],
              ),
            ),
          ),
      }),
    ],
  )

const emptyQueueText = (model: Model): string =>
  model.repeat !== 'Off'
    ? 'Queue is empty. Repeat is on, so this song plays again'
    : model.isAutoplay
      ? 'Queue is empty. When this song ends, autoplay continues with the next song in this video, then a random other video'
      : 'Playback stops after this song'

const phoneQueueRowView = (
  song: PlayableSong,
  index: number,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('flex items-center gap-1 rounded hover:bg-white/10')],
    [
      h.button(
        [
          h.Type('button'),
          h.AriaLabel(`Play "${song.song_title}" now`),
          h.OnClick(Message.ClickedQueuedSong({ index })),
          h.Class(
            'flex flex-1 min-w-0 items-center gap-3 min-h-12 p-1 text-left',
          ),
        ],
        [
          h.div(
            [
              h.Class(
                'w-10 h-10 bg-slate-800 rounded flex-shrink-0 overflow-hidden',
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
                [h.Class('text-sm font-medium truncate text-white')],
                [songLabel(song)],
              ),
              h.p(
                [h.Class('text-xs text-gray-300 truncate')],
                [kindLabel(song.kind)],
              ),
            ],
          ),
        ],
      ),
      h.button(
        [
          h.Type('button'),
          h.AriaLabel(`Remove "${song.song_title}" from queue`),
          h.OnClick(Message.ClickedRemoveFromQueue({ index })),
          h.Class(
            'flex items-center justify-center min-h-10 min-w-10 shrink-0 rounded-full text-gray-300 hover:text-white hover:bg-white/10 active:scale-95 transition',
          ),
        ],
        [h.i([h.Class('fas fa-times'), h.AriaHidden(true)])],
      ),
    ],
  )

const phoneUpNextView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('sm:hidden mt-2')],
    [
      h.div(
        [h.Class('flex items-center justify-between mb-2')],
        [
          h.h3([h.Class('text-base font-bold')], ['Up next']),
          autoplaySwitchView(model.isAutoplay, '', h),
        ],
      ),
      Array.match(model.setlist.queue, {
        onEmpty: () =>
          h.p([h.Class('text-sm text-gray-300 py-4')], [emptyQueueText(model)]),
        onNonEmpty: songs =>
          h.div(
            [h.Class('space-y-1')],
            songs.map((song, index) => phoneQueueRowView(song, index, h)),
          ),
      }),
    ],
  )

const phoneControlsView = (
  nowPlaying: NowPlaying,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const sideButtonClass =
    'flex items-center justify-center min-h-12 min-w-12 rounded-full text-gray-200 hover:text-white active:scale-95 transition'
  return h.div(
    [h.Class('sm:hidden flex items-center justify-center gap-4 mb-2')],
    [
      repeatButtonView(model.repeat, 'min-h-12 min-w-12', h),
      h.button(
        [
          h.Type('button'),
          h.AriaLabel('Previous song'),
          h.OnClick(Message.ClickedPrevious()),
          h.Class(sideButtonClass),
        ],
        [h.i([h.Class('fas fa-step-backward fa-lg'), h.AriaHidden(true)])],
      ),
      playControlView(
        nowPlaying,
        'w-16 h-16 rounded-full bg-white text-black flex items-center justify-center text-2xl active:scale-95 transition shadow-lg',
        h,
      ),
      h.button(
        [
          h.Type('button'),
          h.AriaLabel('Next song'),
          h.OnClick(Message.ClickedNext()),
          h.Class(sideButtonClass),
        ],
        [h.i([h.Class('fas fa-step-forward fa-lg'), h.AriaHidden(true)])],
      ),
    ],
  )
}

// NOTE: this stays one element at one place in the tree, because expanding must not reload the video.
const playerView = (
  nowPlaying: NowPlaying,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const { isExpanded } = model
  const maybeSinging = nowSingingOf(model)
  return h.div(
    [
      h.Class(
        `fixed transition-opacity duration-150 ease-out motion-reduce:transition-none shadow-2xl z-50 bg-black/95 flex flex-col ${isExpanded ? 'inset-0 overflow-y-auto' : 'overflow-hidden w-1 h-1 opacity-0 pointer-events-none bottom-0 right-0'}`,
      ),
    ],
    [
      h.div(
        [
          h.Class(
            `relative w-full ${isExpanded ? 'min-h-full sm:h-full flex flex-col' : 'h-1'}`,
          ),
        ],
        [
          h.div(
            [
              h.Class(
                `${isExpanded ? 'flex' : 'hidden'} justify-between p-2 sm:p-4 sm:absolute sm:top-0 sm:left-0 sm:right-0 z-10 sm:bg-gradient-to-b from-black/80 to-transparent`,
              ),
            ],
            [
              h.button(
                [
                  h.Type('button'),
                  h.AriaLabel('Collapse player'),
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
                `flex items-center justify-center bg-transparent ${isExpanded ? 'sm:flex-1 sm:gap-6 sm:px-6' : ''}`,
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
                [h.div([h.Class('w-full h-full'), h.OnMount(MountPlayer())])],
              ),
              isExpanded
                ? Option.match(maybeSinging, {
                    onNone: () => h.empty,
                    onSome: singing =>
                      lyricsColumnView(singing, nowPlaying.song.id, h),
                  })
                : h.empty,
            ],
          ),
          h.div(
            [
              h.Class(
                `${isExpanded ? 'block' : 'hidden'} p-4 pb-6 sm:p-8 sm:pb-32 w-full max-w-4xl mx-auto`,
              ),
            ],
            [
              h.h1(
                [
                  h.Class(
                    'text-xl sm:text-2xl md:text-3xl font-bold text-center mb-1 sm:mb-2 drop-shadow-lg',
                  ),
                ],
                [songLabel(songOnBar(model, nowPlaying))],
              ),
              h.p(
                [h.Class('text-center text-gray-400 mb-4')],
                [nowPlaying.song.title_text],
              ),
              isExpanded
                ? Option.match(maybeSinging, {
                    onNone: () => h.empty,
                    onSome: singing =>
                      lyricsWindowView(singing, nowPlaying.song.id, h),
                  })
                : h.empty,
              isExpanded ? phoneControlsView(nowPlaying, model, h) : h.empty,
              h.div(
                [
                  h.Class(
                    'flex items-center justify-center gap-2 mb-4 sm:mb-8',
                  ),
                ],
                [
                  muteButtonView(model.volume, h),
                  volumeSliderView(model.volume, 'w-full max-w-xs', h),
                ],
              ),
              upNextPreviewView(model.setlist.queue, h),
              isExpanded ? phoneUpNextView(model, h) : h.empty,
            ],
          ),
        ],
      ),
    ],
  )
}

const loginFailureText: Record<LoginFailure, string> = {
  state:
    'That Discord login did not start in this browser. Press Connect Discord to try again.',
  limit: 'Too many login attempts. Wait a few minutes, then try again.',
  refused:
    'Discord did not complete the login. Press Connect Discord to try again.',
}

const toastMessage = (toast: Toast): string =>
  Toast.match<string>(toast, {
    SkippedSongs: ({ firstSkippedTitle, skippedCount }) =>
      skippedCount === 1
        ? `"${firstSkippedTitle}" was skipped because its stream is gone.`
        : `"${firstSkippedTitle}" and ${skippedCount - 1} more were skipped because their streams are gone.`,
    PlaylistDeleted: () => 'This playlist was deleted.',
    PlaylistNotFound: () => 'That playlist link does not lead anywhere.',
    PlaylistUnreachable: () =>
      'Could not load the playlist. Reload to try again.',
    PlaylistConflict: () =>
      'Someone else changed this playlist first. It was reloaded, so look it over and try again.',
    PlaylistUpdated: () => 'Playlist saved.',
    LoginFailed: ({ reason }) => loginFailureText[reason],
    DisconnectFailed: () =>
      'Could not disconnect Discord. Check your connection and try again.',
    PlaylistSongsUnavailable: ({ count }) =>
      `${songCountText(count)} from the playlist ${count === 1 ? 'is' : 'are'} not available and ${count === 1 ? 'was' : 'were'} skipped.`,
  })

const toastView = (toast: Toast, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Role('status'),
      h.AriaLive('polite'),
      h.DataAttribute('toast', toast._tag),
      ...(toast._tag === 'LoginFailed'
        ? [h.DataAttribute('toast-reason', toast.reason)]
        : []),
      h.Class(
        'fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] w-[calc(100vw-2rem)] max-w-md flex items-start gap-3 bg-black/80 backdrop-blur-xl border border-white/10 text-white rounded-xl shadow-2xl p-3',
      ),
    ],
    [
      h.i([
        h.Class('fas fa-exclamation-triangle text-amber-400 mt-0.5'),
        h.AriaHidden(true),
      ]),
      h.p(
        [h.Class('flex-1 min-w-0 text-sm break-words')],
        [toastMessage(toast)],
      ),
      h.button(
        [
          h.Type('button'),
          h.AriaLabel('Dismiss'),
          h.OnClick(Message.ClickedDismissToast()),
          h.Class('shrink-0 text-gray-300 hover:text-white transition-colors'),
        ],
        [h.i([h.Class('fas fa-times')])],
      ),
    ],
  )

const moodPromptView = (
  asking: { songId: string; picked: ReadonlyArray<Mood> },
  songTitle: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Role('region'),
      h.AriaLabel('Song mood'),
      h.DataAttribute('mood-prompt', 'Asking'),
      h.Class(
        'fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] w-[calc(100vw-2rem)] max-w-md bg-black/80 backdrop-blur-xl border border-white/10 text-white rounded-xl shadow-2xl p-3 space-y-3',
      ),
    ],
    [
      h.div(
        [h.Class('flex items-start gap-3')],
        [
          h.p(
            [h.Class('flex-1 min-w-0 text-sm break-words')],
            [`How does ${songTitle} feel? Tap up to 2.`],
          ),
          h.button(
            [
              h.Type('button'),
              h.AriaLabel('Close'),
              h.OnClick(Message.DismissedMoodPrompt()),
              h.Class(
                'shrink-0 text-gray-300 hover:text-white transition-colors',
              ),
            ],
            [h.i([h.Class('fas fa-times'), h.AriaHidden(true)])],
          ),
        ],
      ),
      h.div(
        [h.Class('flex flex-wrap gap-2')],
        MOODS.map(mood => {
          const isPicked = Array.contains(asking.picked, mood)
          return h.button(
            [
              h.Type('button'),
              h.AriaPressed(isPicked ? 'true' : 'false'),
              h.OnClick(Message.ToggledMood({ mood })),
              h.Class(
                twMerge(
                  'min-h-9 px-3 rounded-full border text-sm font-semibold capitalize transition',
                  isPicked
                    ? 'bg-[#446e92] border-transparent'
                    : 'border-white/15 hover:bg-white/10',
                ),
              ),
            ],
            [mood],
          )
        }),
      ),
      h.button(
        [
          h.Type('button'),
          h.Disabled(!Array.isReadonlyArrayNonEmpty(asking.picked)),
          h.OnClick(Message.SubmittedMoods()),
          h.Class(
            twMerge(
              promptButtonClass,
              'w-full bg-[#446e92] hover:bg-[#54809f] disabled:opacity-50 disabled:pointer-events-none',
            ),
          ),
        ],
        ['Send'],
      ),
    ],
  )

const promptButtonClass =
  'flex items-center justify-center gap-2 min-h-11 px-4 rounded-full border border-white/15 text-sm font-semibold transition'

const playlistContextOf = (setlist: Setlist) => {
  const isPlaying = Option.isSome(setlist.maybeNowPlaying)
  const isQueued = setlist.queue.length > 0
  return isPlaying && isQueued
    ? {
        tag: 'PlayingAndQueued',
        text: 'A song is playing and your queue has songs in it.',
      }
    : isPlaying
      ? { tag: 'Playing', text: 'A song is already playing.' }
      : { tag: 'Queued', text: 'Your queue already has songs in it.' }
}

const playlistPromptView = (
  asking: Extract<PlaylistOpen, { _tag: 'Asking' }>,
  setlist: Setlist,
  h: HtmlBuilder<Message>,
): Html => {
  const context = playlistContextOf(setlist)
  const wrapFocus = (focusSelector: string) =>
    Option.some({
      focusSelector,
      message: Message.CompletedFocusPlaylistPrompt(),
    })
  return h.div(
    [
      h.Class('fixed inset-0 z-[70] flex items-center justify-center p-4'),
      h.OnKeyDownPreventDefault(key =>
        key === 'Escape'
          ? Option.some(Message.ClickedCancelPlaylist())
          : Option.none(),
      ),
    ],
    [
      h.div([
        h.Class('absolute inset-0 bg-black/60'),
        h.AriaHidden(true),
        h.OnClick(Message.ClickedCancelPlaylist()),
      ]),
      h.div(
        [
          h.Id(PLAYLIST_PROMPT_ID),
          h.Role('dialog'),
          h.AriaModal(true),
          h.AriaLabelledBy(`${PLAYLIST_PROMPT_ID}-title`),
          h.Class(
            'relative w-full max-w-md rounded-xl border border-white/10 bg-black/80 backdrop-blur-xl text-white shadow-2xl outline-none p-5 space-y-4',
          ),
        ],
        [
          h.h1(
            [
              h.Id(`${PLAYLIST_PROMPT_ID}-title`),
              h.Class('text-lg font-bold break-words'),
            ],
            [asking.opened.name],
          ),
          h.p(
            [
              h.Class('text-sm text-gray-300'),
              h.DataAttribute('playlist-context', context.tag),
            ],
            [`${songCountText(asking.songs.length)} to play. ${context.text}`],
          ),
          h.div(
            [h.Class('flex flex-col gap-2')],
            [
              h.button(
                [
                  h.Type('button'),
                  h.DataAttribute('playlist-choice', 'Replace'),
                  h.OnKeyDownFocus((key, { shiftKey }) =>
                    key === 'Tab' && shiftKey
                      ? wrapFocus(CANCEL_CHOICE)
                      : Option.none(),
                  ),
                  h.OnClick(Message.ClickedReplaceQueueWithPlaylist()),
                  h.Class(
                    twMerge(
                      promptButtonClass,
                      'bg-[#446e92] hover:bg-[#54809f]',
                    ),
                  ),
                ],
                ['Replace queue'],
              ),
              h.button(
                [
                  h.Type('button'),
                  h.DataAttribute('playlist-choice', 'Append'),
                  h.OnClick(Message.ClickedAddPlaylistToQueue()),
                  h.Class(
                    twMerge(promptButtonClass, 'bg-white/10 hover:bg-white/20'),
                  ),
                ],
                ['Add to queue'],
              ),
              h.button(
                [
                  h.Type('button'),
                  h.DataAttribute('playlist-choice', 'Cancel'),
                  h.OnKeyDownFocus((key, { shiftKey }) =>
                    key === 'Tab' && !shiftKey
                      ? wrapFocus(REPLACE_CHOICE)
                      : Option.none(),
                  ),
                  h.OnClick(Message.ClickedCancelPlaylist()),
                  h.Class(
                    twMerge(
                      promptButtonClass,
                      'text-gray-300 hover:bg-white/10',
                    ),
                  ),
                ],
                ['Cancel'],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

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
            [
              h.Class(
                twMerge(
                  'flex-1 min-w-0 min-h-0 transition-[padding] duration-300 ease-in-out',
                  model.isQueueOpen && 'md:pr-[22.5rem]',
                ),
              ),
            ],
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
        onSome: toast => toastView(toast, h),
      }),
      Option.isNone(model.maybeSkipToast) &&
      !model.isExpanded &&
      !PlaylistOpen.guards.Asking(model.playlistOpen)
        ? MoodPrompt.matchOrElse(
            model.moodPrompt,
            {
              Asking: asking =>
                Option.match(model.setlist.maybeNowPlaying, {
                  onNone: () => h.empty,
                  onSome: nowPlaying =>
                    moodPromptView(
                      asking,
                      songOnBar(model, nowPlaying).song_title,
                      h,
                    ),
                }),
            },
            () => h.empty,
          )
        : h.empty,
      PlaylistOpen.matchOrElse(
        model.playlistOpen,
        { Asking: asking => playlistPromptView(asking, model.setlist, h) },
        () => h.empty,
      ),
      playlistDialogView(model, h),
      model.isInfoOpen ? infoPanelView(h) : h.empty,
    ],
  ),
)
